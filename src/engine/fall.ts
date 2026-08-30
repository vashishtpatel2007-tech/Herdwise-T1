/**
 * §7.8 — fall detection. ORDER is the discriminator.
 *
 * Cattle lie down 8–12 hours a day. "Orientation change then stillness"
 * describes ruminating exactly as well as it describes a fall. What separates
 * them is the IMPACT SPIKE, ARRIVING FIRST. A deliberate lie-down is a slow
 * controlled rotation that typically peaks under 1.5 g.
 *
 * This runs on the collar (Engine A) — raw IMU never leaves the device. It
 * lives here so the firmware team has an executable reference (docs/collar-
 * contract.md) and so the simulator and tests exercise the identical logic.
 */

export interface ImuSample {
  t_ms: number;
  /** Acceleration magnitude in g, including the 1 g of gravity. */
  a_g: number;
  /** Device orientation in degrees; absolute frame, wrap-safe differences. */
  orientation_deg: number;
}

export const SPIKE_G_DAY = 2.5;
export const SPIKE_G_NIGHT = 3.5; // raised 21:00–05:00
export const SPIKE_WINDOW_MS = 200;
export const ORIENTATION_DELTA_DEG = 60;
export const ORIENTATION_WINDOW_MS = 3_000;
export const STILLNESS_BAND_G = 0.15;
export const STILLNESS_MS = 90_000;

import { localHour } from './time.ts';

export type FallVerdict =
  | { fall: false; failed_gate: 1 | 2 | 3; detail: string }
  | { fall: true; spike_g: number; spike_t_ms: number };

function nightSpikeThreshold(now: Date, tz?: string): number {
  // Farm-local hour. On the collar this is the device's own RTC (already
  // local); in the cloud it must be resolved explicitly — see time.ts.
  const h = localHour(now, tz);
  return h >= 21 || h < 5 ? SPIKE_G_NIGHT : SPIKE_G_DAY;
}

/** Smallest absolute angle between two orientations, 0..180. */
function angDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function detectFall(samples: ImuSample[], now: Date, tz?: string): FallVerdict {
  if (samples.length === 0) {
    return { fall: false, failed_gate: 1, detail: 'no samples' };
  }
  const threshold = nightSpikeThreshold(now, tz);

  // ---- GATE 1 (hard gate): impact spike ----------------------------------
  // If this is not met we EXIT. No fall, regardless of anything that follows.
  // This gate is the entire reason the detector is usable rather than a
  // nuisance that fires every time a cow lies down to chew.
  let spikeIdx = -1;
  let spikePeak = 0;

  for (let i = 0; i < samples.length; i++) {
    const t0 = samples[i].t_ms;
    let peak = 0;
    for (let j = i; j < samples.length && samples[j].t_ms - t0 <= SPIKE_WINDOW_MS; j++) {
      if (samples[j].a_g > peak) peak = samples[j].a_g;
    }
    if (peak > threshold && peak > spikePeak) {
      spikePeak = peak;
      spikeIdx = i;
    }
  }

  if (spikeIdx === -1) {
    const observed = Math.max(...samples.map((s) => s.a_g));
    return {
      fall: false,
      failed_gate: 1,
      detail: `peak ${observed.toFixed(2)}g did not exceed ${threshold}g`,
    };
  }

  const spikeT = samples[spikeIdx].t_ms;

  // ---- GATE 2: orientation change > 60° within 3 s OF the spike ----------
  const beforeSpike =
    samples.filter((s) => s.t_ms <= spikeT).slice(-1)[0] ?? samples[spikeIdx];
  const within3s = samples.filter(
    (s) => s.t_ms > spikeT && s.t_ms - spikeT <= ORIENTATION_WINDOW_MS,
  );

  const maxRotation = within3s.reduce(
    (m, s) => Math.max(m, angDiff(s.orientation_deg, beforeSpike.orientation_deg)),
    0,
  );

  if (maxRotation <= ORIENTATION_DELTA_DEG) {
    return {
      fall: false,
      failed_gate: 2,
      detail: `rotation ${maxRotation.toFixed(0)}° within 3s did not exceed ${ORIENTATION_DELTA_DEG}°`,
    };
  }

  // ---- GATE 3: stillness sustained 90 s ----------------------------------
  const after = samples.filter((s) => s.t_ms > spikeT);
  let stillStart: number | null = null;
  let stillFor = 0;

  for (const s of after) {
    if (Math.abs(s.a_g - 1) < STILLNESS_BAND_G) {
      stillStart ??= s.t_ms;
      stillFor = s.t_ms - stillStart;
    } else {
      stillStart = null;
      stillFor = 0;
    }
  }

  if (stillFor < STILLNESS_MS) {
    return {
      fall: false,
      failed_gate: 3,
      detail: `stillness ${(stillFor / 1000).toFixed(0)}s short of ${STILLNESS_MS / 1000}s`,
    };
  }

  return { fall: true, spike_g: spikePeak, spike_t_ms: spikeT };
}
