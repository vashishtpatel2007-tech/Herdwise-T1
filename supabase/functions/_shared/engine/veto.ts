/**
 * §7.2 — GPS quality is a VETO, not an input.
 *
 * This runs before any risk math, in both engines. A bad fix can place an
 * animal 50 m across a road she is nowhere near. That false alarm costs more
 * farmer trust than a missed one does, so a poor fix does not get a vote — it
 * gets the evaluation cancelled.
 *
 * The telemetry row is still stored (flagged), because a run of poor fixes is
 * itself the evidence for a DEVICE alert.
 */

import type { TelemetryInput } from './types.ts';

export const FIX_QUALITY_MIN = 2;
export const HDOP_MAX = 5;
export const SATS_MIN = 5;

/** How long poor fixes must persist before we bother the farmer about it. */
export const POOR_FIX_ALERT_AFTER_MS = 15 * 60 * 1000;

export interface VetoResult {
  vetoed: boolean;
  reason: string | null;
}

export function gpsVeto(t: Pick<TelemetryInput, 'fix_quality' | 'hdop' | 'sats'>): VetoResult {
  const failures: string[] = [];
  if (t.fix_quality < FIX_QUALITY_MIN) failures.push(`fix_quality=${t.fix_quality}`);
  if (t.hdop > HDOP_MAX) failures.push(`hdop=${t.hdop}`);
  if (t.sats < SATS_MIN) failures.push(`sats=${t.sats}`);

  return failures.length > 0
    ? { vetoed: true, reason: failures.join(', ') }
    : { vetoed: false, reason: null };
}

/**
 * Decide whether a sustained run of poor fixes has earned a DEVICE alert.
 *
 * Note the alert kind: `gps_fault`, never an animal alert. The correct message
 * is "the collar cannot see the sky", not a guess about where the animal is
 * (§13.5). Claiming to know her state here would be a lie.
 */
export function shouldRaiseGpsFault(
  poorFixSince: string | null,
  lastAlertAt: string | null,
  now: Date,
): boolean {
  if (!poorFixSince) return false;
  const elapsed = now.getTime() - new Date(poorFixSince).getTime();
  if (elapsed < POOR_FIX_ALERT_AFTER_MS) return false;

  // Do not re-raise while one is already outstanding for this fault window.
  if (lastAlertAt && new Date(lastAlertAt).getTime() > new Date(poorFixSince).getTime()) {
    return false;
  }
  return true;
}
