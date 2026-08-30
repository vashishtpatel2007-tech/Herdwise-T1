/**
 * §13 honesty rules, rendered.
 *
 * Rule 1: never display a stale position without its age.
 * Rule 3: never display a probability that has no definition behind it.
 *
 * These are product requirements, not style notes. Breaking one is a defect,
 * so the formatting lives in one place where it can be enforced and tested.
 */

import type { TFunction } from 'i18next';

/** How old a fix may be before we stop calling it live. */
export const FRESH_MS = 90_000;
/** Beyond this the dot is drawn hollow: we genuinely do not know where she is. */
export const STALE_MS = 15 * 60_000;

export type Freshness = 'live' | 'recent' | 'stale' | 'unknown';

export function freshness(recordedAt: string | null | undefined, now = Date.now()): Freshness {
  if (!recordedAt) return 'unknown';
  const age = now - new Date(recordedAt).getTime();
  if (age < FRESH_MS) return 'live';
  if (age < STALE_MS) return 'recent';
  return 'stale';
}

/**
 * "Updated 40 sec ago". Never returns an empty string — a position with no
 * age attached is exactly what rule 1 forbids.
 */
export function ageLabel(
  recordedAt: string | null | undefined,
  t: TFunction,
  now = Date.now(),
): string {
  if (!recordedAt) return t('age.never');
  const s = Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
  if (s < 10) return t('age.just_now');
  if (s < 60) return t('age.seconds', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('age.minutes', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('age.hours', { n: h });
  return t('age.days', { n: Math.round(h / 24) });
}

/**
 * §9.4 — collar charge AS WORDS, not a percentage. "51%" asks the farmer to
 * decide what 51% means; "Collar needs charging" tells him what to do.
 */
export function batteryWords(pct: number | null | undefined, t: TFunction): string {
  if (pct === null || pct === undefined) return t('battery.unknown');
  if (pct >= 60) return t('battery.good');
  if (pct >= 30) return t('battery.ok');
  if (pct >= 15) return t('battery.low');
  return t('battery.critical');
}

export function batteryTone(pct: number | null | undefined): 'safe' | 'warn' | 'danger' | 'muted' {
  if (pct === null || pct === undefined) return 'muted';
  if (pct >= 60) return 'safe';
  if (pct >= 30) return 'safe';
  if (pct >= 15) return 'warn';
  return 'danger';
}

/** Distance a farmer can act on. No decimals below a kilometre. */
export function distanceWords(m: number | null | undefined, t: TFunction): string {
  if (m === null || m === undefined) return '—';
  if (m < 1000) return t('distance.m', { n: Math.round(m) });
  return t('distance.km', { n: (m / 1000).toFixed(1) });
}

/** §9.3 — time to reach the road, as a sentence fragment, never raw seconds. */
export function ttrWords(seconds: number | null | undefined, t: TFunction): string {
  if (seconds === null || seconds === undefined) return t('ttr.not_approaching');
  if (seconds < 60) return t('ttr.under_a_minute');
  const m = Math.round(seconds / 60);
  return t('ttr.minutes', { n: m });
}

/**
 * §9.3 — "Likely to reach the highway within 5 minutes", never a raw decimal.
 * Returns null when no simulation ran, so the caller shows nothing rather than
 * inventing a number (§13.3).
 */
export function probabilitySentence(
  p: number | null | undefined,
  roadName: string | null,
  t: TFunction,
): string | null {
  if (p === null || p === undefined) return null;
  const road = roadName ?? t('road.generic');
  if (p < 0.15) return t('probability.unlikely', { road });
  if (p < 0.4) return t('probability.possible', { road });
  if (p < 0.7) return t('probability.likely', { road });
  return t('probability.very_likely', { road });
}

export const STATE_COLOR: Record<string, string> = {
  safe: 'var(--safe)',
  watch: 'var(--warn)',
  warning: 'var(--warn)',
  high: 'var(--danger)',
  critical: 'var(--danger)',
};
