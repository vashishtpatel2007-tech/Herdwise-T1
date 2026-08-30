/**
 * §7.6 — Stage 0 weighted risk score.
 *
 * Builds first, needs no training data, and is fully explainable: every
 * evaluation stores its `components` so "why did it fire?" is answered by
 * opening the row rather than by shrugging at a model.
 *
 * Scale discipline (§7.6): 0–100 integers for risk, 0–1 floats only for
 * genuine probabilities. Mixing `road_risk: 87` with `confidence: 0.91`
 * invites the question you cannot answer.
 */

import { clamp } from './geo.ts';
import type { DerivedFeatures, ScoreComponents, Situation } from './types.ts';
import type { TrafficSignals } from './traffic.ts';

/** Distance at which a road stops contributing proximity risk at all. */
const PROXIMITY_HORIZON_M = 300;
/** ≈ brisk walk. Closing faster than this saturates the term. */
const CLOSING_REFERENCE_MPS = 1.5;
/** Separation rate that saturates the isolation term, m/min. */
const ISOLATION_REFERENCE = 20;

export const WEIGHTS = {
  proximity: 0.28,
  closing: 0.26,
  road_factor: 0.16,
  traffic_f: 0.12,
  isolation: 0.10,
  outside_zone: 0.08,
} as const;

export interface ScoreResult {
  road_risk: number;
  geofence_risk: number;
  components: ScoreComponents;
  situation: Situation;
}

export function scoreRoadRisk(
  f: DerivedFeatures,
  baseRisk: number,
  traffic: TrafficSignals,
  insideZone: boolean,
): ScoreResult {
  const proximity =
    f.distance_to_road === null
      ? 0
      : clamp(1 - f.distance_to_road / PROXIMITY_HORIZON_M, 0, 1);

  // Negative closing speed (walking away) floors at 0 — never negative credit.
  const closing = clamp(f.closing_speed / CLOSING_REFERENCE_MPS, 0, 1);
  const road_factor = clamp(baseRisk / 5, 0, 1);
  const traffic_f = clamp(traffic.collision_risk, 0, 1);
  const isolation = clamp(f.separation_rate / ISOLATION_REFERENCE, 0, 1);
  const outside_zone = f.outside_zone ? 1 : 0;

  const components: ScoreComponents = {
    proximity, closing, road_factor, traffic_f, isolation, outside_zone,
    traffic_fallback: traffic.fallback,
  };

  const raw =
    WEIGHTS.proximity * proximity +
    WEIGHTS.closing * closing +
    WEIGHTS.road_factor * road_factor +
    WEIGHTS.traffic_f * traffic_f +
    WEIGHTS.isolation * isolation +
    WEIGHTS.outside_zone * outside_zone;

  let road_risk = Math.round(100 * raw);
  let situation: Situation = 'normal';

  // ---- §7.4 overrides. These replace the score entirely. -----------------
  // Cattle sitting still on a highway at night is the deadliest state in the
  // problem domain, and it is precisely the state a proximity-and-approach
  // model scores near zero. The override is not a tweak; it is the fix.
  if (f.stationary_on_road) {
    road_risk = 100;
    situation = 'stationary_on_road';
    components.override = 'stationary_on_road';
  } else if (f.on_road) {
    road_risk = 95;
    situation = 'on_road';
    components.override = 'on_road';
  } else if (f.ttr_seconds !== null && road_risk >= 40) {
    situation = 'approaching_road';
  } else if (f.outside_zone) {
    situation = 'outside_zone';
  }

  // Geofence risk is tracked separately so a zone breach far from any road
  // still surfaces, and so the two never mask each other.
  let geofence_risk = 0;
  if (!insideZone) geofence_risk = 70;
  else if (f.outside_zone) geofence_risk = 40; // inside the buffer margin

  return { road_risk: clamp(road_risk, 0, 100), geofence_risk, components, situation };
}
