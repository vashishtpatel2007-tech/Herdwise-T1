/**
 * Farm health, and the weather over the field.
 *
 * The score is NOT a vibe. It is computed from four things the app actually
 * knows, each capped so no single factor can dominate, and the breakdown is
 * returned alongside it so the farmer can be told *why* it dropped rather than
 * being handed a number to trust blindly.
 */

import type { HerdMember } from './useHerd.tsx';

export interface FarmHealth {
  score: number;                 // 0..100
  label: 'Excellent' | 'Good' | 'Watch' | 'Needs you';
  tone: 'safe' | 'warn' | 'danger';
  /** Plain-language reasons, worst first. Empty when everything is fine. */
  reasons: string[];
}

export function farmHealth(herd: HerdMember[]): FarmHealth {
  if (herd.length === 0) {
    return { score: 0, label: 'Watch', tone: 'warn', reasons: ['No animals added yet'] };
  }

  const n = herd.length;
  const danger = herd.filter((m) => ['high', 'critical'].includes(m.risk?.state ?? 'safe')).length;
  const watch  = herd.filter((m) => ['warning', 'watch'].includes(m.risk?.state ?? 'safe')).length;
  const stale  = herd.filter((m) => {
    const t = m.position?.recorded_at;
    return !t || Date.now() - new Date(t).getTime() > 15 * 60_000;
  }).length;
  const lowBat = herd.filter((m) => (m.position?.battery_pct ?? 100) < 20).length;

  // Each term is a penalty out of 100, weighted by how much it should matter.
  const pDanger = (danger / n) * 55;   // an animal in real danger dominates
  const pWatch  = (watch  / n) * 18;
  const pStale  = (stale  / n) * 20;   // not knowing is nearly as bad as bad news
  const pBat    = (lowBat / n) * 12;

  const score = Math.max(0, Math.round(100 - pDanger - pWatch - pStale - pBat));

  const reasons: string[] = [];
  if (danger) reasons.push(`${danger} near a road`);
  if (watch)  reasons.push(`${watch} to keep an eye on`);
  if (stale)  reasons.push(`${stale} not reporting`);
  if (lowBat) reasons.push(`${lowBat} collar${lowBat > 1 ? 's' : ''} nearly flat`);

  // Word and colour must agree. Deriving them independently produced a card
  // that said "Good" in red — the same contradiction the danger screen had.
  // An animal near a road IS the headline, whatever the average says.
  let tone: FarmHealth['tone'];
  let label: FarmHealth['label'];

  if (danger > 0 || score < 55) {
    tone = 'danger';
    label = 'Needs you';
  } else if (score < 90) {
    tone = 'warn';
    label = score >= 75 ? 'Good' : 'Watch';
  } else {
    tone = 'safe';
    label = 'Excellent';
  }

  return { score, label, tone, reasons };
}

/* ------------------------------------------------------------------------ */

export interface Weather {
  tempC: number;
  humidity: number;
  rainChance: number;
  code: number;
  summary: string;
}

/** WMO weather codes -> words a farmer would use. */
function describe(code: number): string {
  if (code === 0) return 'Clear skies';
  if (code <= 2) return 'Mostly clear';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

/**
 * Open-Meteo: free, no key, no account. Chosen deliberately — a weather card
 * is not worth putting a billable API key in a student project, and this one
 * degrades to null rather than showing a made-up temperature.
 */
export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,relative_humidity_2m,weather_code`
      + `&daily=precipitation_probability_max&timezone=auto&forecast_days=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json() as {
      current?: { temperature_2m: number; relative_humidity_2m: number; weather_code: number };
      daily?: { precipitation_probability_max: number[] };
    };
    if (!j.current) return null;
    return {
      tempC: Math.round(j.current.temperature_2m),
      humidity: Math.round(j.current.relative_humidity_2m),
      rainChance: Math.round(j.daily?.precipitation_probability_max?.[0] ?? 0),
      code: j.current.weather_code,
      summary: describe(j.current.weather_code),
    };
  } catch {
    // No weather is fine. A wrong temperature is not.
    return null;
  }
}

/** Greeting by farm-local hour. */
export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}
