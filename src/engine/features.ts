/**
 * §7.3–7.5 — derived features.
 *
 * The closing-speed correction in here is the single most important formula in
 * the system. Everything else is tuning; this one decides whether the product
 * is usable at all.
 */

import { angularDifference, clamp, kmhToMps } from './geo.ts';
import { isNightHour, localHour } from './time.ts';
import type { DerivedFeatures, EnrichedContext, RiskStateRow, TelemetryInput } from './types.ts';

/** §7.4 — within this distance the animal is on the road, not near it. */
export const ON_ROAD_M = 15;
/** §7.4 — below this speed she is not moving off it. */
export const STATIONARY_KMH = 0.3;
/** §7.4 — stillness must be sustained, not instantaneous. */
export const STATIONARY_SUSTAIN_MS = 60 * 1000;
/** §7.3 — below this, motion toward the road is indistinguishable from GPS jitter. */
export const CLOSING_EPSILON_MPS = 0.1;

/**
 * Night window (§6). Resolved in the FARM's timezone, not the host's — the
 * Edge runtime is UTC, and reading 02:00 IST as 20:30 UTC turned the most
 * dangerous window in the product into the safest. See time.ts.
 */
export function isNight(d: Date, tz?: string): boolean {
  return isNightHour(localHour(d, tz));
}

export interface FeatureResult {
  features: DerivedFeatures;
  /** Timestamps to persist back onto risk_state so "sustained" can be judged. */
  stationary_since: string | null;
  on_road_since: string | null;
}

export function deriveFeatures(
  input: TelemetryInput,
  ctx: EnrichedContext,
  prior: Pick<RiskStateRow, 'stationary_since' | 'on_road_since'> | null,
  now: Date,
  tz?: string,
): FeatureResult {
  const speed_mps = kmhToMps(input.speed_kmh);
  const dist = ctx.distance_to_road;

  // ---- §7.3 closing-speed correction -------------------------------------
  // A cow walking PARALLEL to a highway at 1.5 m/s, 180 m away, will show
  // "reaches road in 2 minutes" forever and never arrive. Computed with raw
  // speed this engine alerts on every animal grazing along a roadside — which
  // is most of them — until the farmer silences it and the product is dead.
  let theta_deg: number | null = null;
  let closing_speed = 0;
  let ttr_seconds: number | null = null;

  if (ctx.bearing_to_road !== null && dist !== null) {
    theta_deg = angularDifference(input.heading_deg, ctx.bearing_to_road);
    closing_speed = speed_mps * Math.cos((theta_deg * Math.PI) / 180);

    if (closing_speed > CLOSING_EPSILON_MPS) {
      ttr_seconds = Math.round(dist / closing_speed);
    }
    // else: ttr stays NULL. Not approaching — proximity alone must not alert.
  }

  // ---- §7.4 on-road states -----------------------------------------------
  // Every "approaching" parameter fails for an animal that has already
  // arrived: distance 0, closing speed 0, TTR undefined. A proximity-and-
  // approach engine scores the deadliest state in the problem domain at zero.
  const on_road = dist !== null && dist < ON_ROAD_M;
  const isStill = input.speed_kmh < STATIONARY_KMH;

  let on_road_since = prior?.on_road_since ?? null;
  on_road_since = on_road ? (on_road_since ?? now.toISOString()) : null;

  let stationary_since = prior?.stationary_since ?? null;
  stationary_since = on_road && isStill ? (stationary_since ?? now.toISOString()) : null;

  const stationary_on_road =
    on_road &&
    isStill &&
    stationary_since !== null &&
    now.getTime() - new Date(stationary_since).getTime() >= STATIONARY_SUSTAIN_MS;

  // ---- §7.5 herd context -------------------------------------------------
  // Cattle are herd animals. Separation from the group is very likely the best
  // single predictor of straying that exists, and every position is already in
  // the database, so it costs nothing.
  const is_isolated =
    ctx.distance_from_centroid !== null &&
    ctx.herd_median_dist !== null &&
    ctx.herd_median_dist > 0 &&
    ctx.distance_from_centroid > 2 * ctx.herd_median_dist;

  // ---- Zone --------------------------------------------------------------
  // The buffer alerts this far INSIDE the edge, so warning time exists before
  // she is actually out. GPS drifts 3–5 m; waiting for a true crossing is late.
  const outside_zone =
    !ctx.inside_zone ||
    (ctx.distance_to_zone_edge !== null &&
      ctx.inside_zone &&
      ctx.distance_to_zone_edge < ctx.zone_buffer_m);

  return {
    features: {
      distance_to_road: dist,
      bearing_to_road: ctx.bearing_to_road,
      theta_deg,
      closing_speed,
      ttr_seconds,
      on_road,
      stationary_on_road,
      is_isolated,
      separation_rate: ctx.separation_rate,
      outside_zone,
      is_night: isNight(now, tz),
    },
    stationary_since,
    on_road_since,
  };
}

/** clamp helper re-exported so score.ts reads cleanly. */
export { clamp };
