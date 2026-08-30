/**
 * §6 — traffic signals.
 *
 * Two signals, deliberately separate, because they move in OPPOSITE directions
 * and demand opposite responses:
 *
 *   collision_risk  ∝ current_speed        fast traffic kills animals
 *   disruption_risk ∝ (1 - speed_ratio)    slow dense traffic causes the jams
 *
 * A free-flowing highway at 3am is the deadliest case. A jammed highway at 9am
 * is the traffic-disruption case. Collapsing them into one "traffic" number
 * loses exactly the distinction that decides what to tell the farmer.
 */

import { clamp } from './geo.ts';
import { localHour } from './time.ts';

/** Speed at which we treat collision energy as maximal, km/h. */
const COLLISION_REFERENCE_KMH = 100;

/** Assumed baseline exposure when we have no live data at all. */
const FALLBACK_BASE = 0.4;

export interface TrafficSignals {
  collision_risk: number; // 0..1
  disruption_risk: number; // 0..1
  /** True when these came from the clock, not TomTom. Surfaced in the UI (§13.4). */
  fallback: boolean;
}

/**
 * Time-of-day multiplier. Serves two jobs: the fallback when TomTom is absent,
 * and an independent factor layered on top when it is present.
 */
export function timeOfDayMultiplier(d: Date, tz?: string): number {
  // Local to the FARM, not to the host. The Edge runtime is UTC; using its
  // clock shifted every band by 5.5 hours for an Indian deployment.
  const h = localHour(d, tz);
  if ((h >= 6 && h < 9) || (h >= 17 && h < 21)) return 1.5; // peak volume
  if (h >= 9 && h < 17) return 1.0;
  return 1.3; // 21:00–06:00 — fewer vehicles, faster, animal invisible
}

export function trafficSignals(
  currentSpeedKmh: number | null,
  freeFlowKmh: number | null,
  now: Date,
  tz?: string,
): TrafficSignals {
  const tod = timeOfDayMultiplier(now, tz);

  // No usable sample → fall back to the clock. Never block an alert on a
  // traffic API being down (§6.4).
  if (
    currentSpeedKmh === null || freeFlowKmh === null ||
    !Number.isFinite(currentSpeedKmh) || !Number.isFinite(freeFlowKmh) ||
    freeFlowKmh <= 0
  ) {
    return {
      collision_risk: clamp(FALLBACK_BASE * tod, 0, 1),
      disruption_risk: 0,
      fallback: true,
    };
  }

  const speed_ratio = clamp(currentSpeedKmh / freeFlowKmh, 0, 1);

  return {
    // Fast traffic kills animals. Scale by the clock too: the same 90 km/h is
    // worse at 2am when the driver cannot see her.
    collision_risk: clamp((currentSpeedKmh / COLLISION_REFERENCE_KMH) * tod, 0, 1),
    // Slow dense traffic is the jam/disruption case, not the fatality case.
    disruption_risk: clamp(1 - speed_ratio, 0, 1),
    fallback: false,
  };
}
