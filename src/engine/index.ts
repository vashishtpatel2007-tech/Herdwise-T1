/**
 * Engine B — cloud risk evaluation. The orchestrator.
 *
 * Stage order is not arbitrary and must not be reordered:
 *   §7.2 GPS veto → §7.3 closing speed → §7.4 on-road overrides
 *   → §7.5 herd → §7.6 score → §7.7 Monte Carlo → §7.9 state machine
 *
 * Pure and synchronous. All I/O happens in the caller (the Edge Function), so
 * this whole file is unit-testable without a database, a network, or a clock.
 */

import { gpsVeto } from './veto.ts';
import { deriveFeatures } from './features.ts';
import { trafficSignals } from './traffic.ts';
import { scoreRoadRisk } from './score.ts';
import { trajectoryCone } from './montecarlo.ts';
import { decideAlert } from './stateMachine.ts';
import { computeSteering } from './steering.ts';
import type {
  EnrichedContext, EngineOutput, RiskStateRow, TelemetryInput,
} from './types.ts';

export * from './types.ts';
export { gpsVeto, shouldRaiseGpsFault } from './veto.ts';
export { deriveFeatures, isNight } from './features.ts';
export { trafficSignals, timeOfDayMultiplier } from './traffic.ts';
export { scoreRoadRisk, WEIGHTS } from './score.ts';
export { trajectoryCone, probabilityPhrase } from './montecarlo.ts';
export { decideAlert, nextState, THRESHOLDS, COOLDOWN_S } from './stateMachine.ts';
export { detectFall } from './fall.ts';
export { computeSteering, cueSideFor, signedTurn } from './steering.ts';
export type { SteeringCue, CuePattern } from './steering.ts';
export { localHour, isNightHour, DEFAULT_TZ } from './time.ts';
export * from './geo.ts';

/** Monte Carlo is expensive; only run it once the score says it might matter. */
export const MONTE_CARLO_THRESHOLD = 40;

export interface EvaluateOptions {
  /** Fixed seed keeps the cone reproducible across reloads and test runs. */
  seed?: number;
  now?: Date;
  /** Farm-local IANA timezone. Defaults to Asia/Kolkata. Never the host's. */
  tz?: string;
  /**
   * Collar state, from the devices row. Steering is suppressed when the
   * farmer has switched the collar off (moving the herd between fields), or
   * muted it, or turned steering off while leaving tracking on.
   */
  steeringEnabled?: boolean;
}

export function evaluate(
  input: TelemetryInput,
  ctx: EnrichedContext,
  prior: RiskStateRow | null,
  opts: EvaluateOptions = {},
): EngineOutput {
  const now = opts.now ?? new Date();

  // ---- §7.2 GPS veto. Runs FIRST, before any risk math. ------------------
  // A bad fix does not get a vote; it gets the evaluation cancelled. Note we
  // return the PRIOR state untouched — a poor fix must never silently downgrade
  // an animal who was in real trouble a moment ago.
  const veto = gpsVeto(input);
  if (veto.vetoed) {
    return {
      road_risk: prior?.road_risk ?? 0,
      geofence_risk: prior?.geofence_risk ?? 0,
      injury_risk: prior?.injury_risk ?? 0,
      situation: 'device_fault',
      state: prior?.state ?? 'safe',
      p_reaches_road_5min: null,
      nearest_road_name: ctx.road_name,
      distance_m: null,
      ttr_seconds: null,
      components: {
        proximity: 0, closing: 0, road_factor: 0, traffic_f: 0,
        isolation: 0, outside_zone: 0, traffic_fallback: true,
      },
      action: 'none',
      alert: null,
      vetoed: true,
      veto_reason: veto.reason,
      cone: [],
      // Never steer on a bad fix. Cueing an animal to turn based on a position
      // that may be 50 m wrong could push her INTO the road (§7.2).
      cue: {
        active: false, side: null, pattern: 'none', intensity: 0,
        reason: null, target_bearing: null, detail: 'gps veto — no steering',
      },
      // Preserve the sustain clocks across a poor fix: a cow lying on a road
      // does not stop lying there because one packet had bad HDOP.
      stationary_since: prior?.stationary_since ?? null,
      on_road_since: prior?.on_road_since ?? null,
    };
  }

  // ---- §7.3–7.5 derived features -----------------------------------------
  const { features, stationary_since, on_road_since } =
    deriveFeatures(input, ctx, prior, now, opts.tz);

  // ---- §6 traffic --------------------------------------------------------
  const traffic = trafficSignals(
    ctx.current_traffic_speed, ctx.free_flow_speed, now, opts.tz,
  );

  // ---- §7.6 Stage 0 score ------------------------------------------------
  const scored = scoreRoadRisk(features, ctx.base_risk, traffic, ctx.inside_zone);

  // ---- §7.7 Stage 1 Monte Carlo ------------------------------------------
  let p: number | null = null;
  let cone: Array<[number, number]> = [];

  if (scored.road_risk >= MONTE_CARLO_THRESHOLD && ctx.road_line.length >= 2) {
    const result = trajectoryCone(ctx.recent_fixes, ctx.road_line, opts.seed ?? 1337);
    if (result.computed) {
      p = result.p_reaches_road_5min;
      cone = result.endpoints;
    }
  }

  // ---- §7.9 alert state machine ------------------------------------------
  const decision = decideAlert({
    prior,
    roadRisk: scored.road_risk,
    situation: scored.situation,
    components: scored.components,
    roadName: ctx.road_name,
    distanceM: features.distance_to_road === null ? null : Math.round(features.distance_to_road),
    ttrSeconds: features.ttr_seconds,
    pReachesRoad: p,
    isNight: features.is_night,
    now,
  });

  return {
    road_risk: scored.road_risk,
    geofence_risk: scored.geofence_risk,
    injury_risk: prior?.injury_risk ?? 0,
    situation: scored.situation,
    state: decision.state,
    p_reaches_road_5min: p,
    nearest_road_name: ctx.road_name,
    distance_m: features.distance_to_road === null ? null : Math.round(features.distance_to_road),
    ttr_seconds: features.ttr_seconds,
    components: scored.components,
    action: decision.action,
    alert: decision.alert,
    vetoed: false,
    veto_reason: null,
    cone,
    // MUST be persisted by the caller onto risk_state, or the 60 s sustain
    // clock resets on every packet and stationary_on_road never latches.
    stationary_since,
    on_road_since,
    cue: computeSteering({
      features,
      ctx,
      headingDeg: input.heading_deg,
      lat: input.lat,
      lon: input.lon,
      steeringEnabled: opts.steeringEnabled ?? true,
      zoneActive: ctx.zone_active,
    }),
  };
}
