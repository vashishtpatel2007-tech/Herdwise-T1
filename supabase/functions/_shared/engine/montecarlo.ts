/**
 * §7.7 — Stage 1 Monte Carlo trajectory cone. The headline feature.
 *
 * Cattle do not walk in straight lines, so straight-line extrapolation is
 * simply wrong. Sampling the animal's OWN recent turn and speed distribution
 * reproduces how she actually moves, needs zero training data, is defensible
 * in front of any examiner, and generates the map visual for free.
 *
 * This produces the one number in the system that is a real probability.
 * Everything else is a 0–100 score. Do not blur that line (§7.7).
 */

import {
  bearing, destination, haversine, makeRng, mean, normalSample, pointToLineMeters, stddev,
} from './geo.ts';

export const SIM_COUNT = 500;
export const HORIZON_S = 300; // 5 minutes
export const STEP_S = 10;
export const ROAD_BUFFER_M = 50;
/** Below this the animal is effectively parked; sampling her turn rate is noise. */
const MIN_SPEED_MPS = 0.05;
/** Cattle top out well below this; clamp keeps a fat tail from teleporting her. */
const MAX_SPEED_MPS = 8;

export interface Fix { lat: number; lon: number; recorded_at: string }

export interface ConeResult {
  p_reaches_road_5min: number;
  /** 500 endpoints for the map fan. */
  endpoints: Array<[number, number]>;
  /** False when there was not enough history to sample a distribution. */
  computed: boolean;
}

/**
 * @param fixes    last ~10 good fixes, oldest first
 * @param roadLine the nearest road as a polyline [[lat,lon], ...]
 * @param seed     fixed seed keeps the cone stable across reloads and tests
 */
export function trajectoryCone(
  fixes: Fix[],
  roadLine: Array<[number, number]>,
  seed = 1337,
): ConeResult {
  // Two fixes give one heading and no variance — not a distribution.
  if (fixes.length < 3 || roadLine.length < 2) {
    return { p_reaches_road_5min: 0, endpoints: [], computed: false };
  }

  // ---- 2. Per-step turn angles and speeds --------------------------------
  const headings: number[] = [];
  const speeds: number[] = [];

  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1], b = fixes[i];
    const dt = (new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()) / 1000;
    if (dt <= 0) continue;
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    speeds.push(d / dt);
    headings.push(bearing(a.lat, a.lon, b.lat, b.lon));
  }

  if (headings.length < 2) {
    return { p_reaches_road_5min: 0, endpoints: [], computed: false };
  }

  // Turn = signed change between consecutive headings, wrapped to [-180, 180].
  const turns: number[] = [];
  for (let i = 1; i < headings.length; i++) {
    let t = headings[i] - headings[i - 1];
    while (t > 180) t -= 360;
    while (t < -180) t += 360;
    turns.push(t);
  }

  const turn_mean = mean(turns);
  // Floors stop a briefly-straight walker from producing a zero-width cone,
  // which would read as false certainty about where she is going.
  const turn_sd = Math.max(stddev(turns), 5);
  const speed_mean = Math.max(mean(speeds), MIN_SPEED_MPS);
  const speed_sd = Math.max(stddev(speeds), 0.05);

  const start = fixes[fixes.length - 1];
  const startHeading = headings[headings.length - 1];

  // ---- 3–5. Simulate 500 futures ----------------------------------------
  const rng = makeRng(seed);
  const steps = Math.floor(HORIZON_S / STEP_S);
  const endpoints: Array<[number, number]> = [];
  let crossings = 0;

  for (let s = 0; s < SIM_COUNT; s++) {
    let lat = start.lat, lon = start.lon, heading = startHeading;
    let crossed = false;

    for (let step = 0; step < steps; step++) {
      heading = (heading + normalSample(rng, turn_mean, turn_sd) + 360) % 360;
      const speed = Math.min(Math.max(normalSample(rng, speed_mean, speed_sd), 0), MAX_SPEED_MPS);
      [lat, lon] = destination(lat, lon, heading, speed * STEP_S);

      // Test every step, not just the endpoint: a path that clips the road and
      // wanders back off still reached the road.
      if (!crossed && pointToLineMeters(lat, lon, roadLine) < ROAD_BUFFER_M) {
        crossed = true;
      }
    }

    if (crossed) crossings++;
    endpoints.push([lat, lon]);
  }

  return {
    p_reaches_road_5min: crossings / SIM_COUNT,
    endpoints,
    computed: true,
  };
}

/**
 * Plain-language rendering (§9.3): the danger screen shows a sentence, never a
 * raw decimal. A farmer does not act on "0.34".
 */
export function probabilityPhrase(p: number): 'unlikely' | 'possible' | 'likely' | 'very_likely' {
  if (p < 0.15) return 'unlikely';
  if (p < 0.4) return 'possible';
  if (p < 0.7) return 'likely';
  return 'very_likely';
}
