/**
 * Local-time helpers.
 *
 * BUG THIS FIXES: every time-of-day decision in the system — the §6 traffic
 * multiplier, the §7.4 night escalation, the §7.8 raised night spike threshold
 * — was calling `Date.getHours()`, which returns the HOST's local hour. The
 * Supabase Edge runtime runs in UTC, so a cow standing on a highway at 02:00
 * IST was evaluated as 20:30 UTC: daytime. The single most dangerous window in
 * the product was being read as the safest.
 *
 * Everything now resolves the hour in the FARM's timezone, explicitly.
 */

/** Where the animals are. India has one civil timezone, so this is a safe default. */
export const DEFAULT_TZ = 'Asia/Kolkata';

/**
 * Hour 0–23 in the given IANA timezone.
 *
 * Uses Intl rather than a fixed +5:30 offset so the same code is correct if
 * this is ever deployed outside India, and so it cannot silently drift.
 */
export function localHour(d: Date, timeZone: string = DEFAULT_TZ): number {
  try {
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', hour12: false,
    }).format(d);
    const h = Number.parseInt(s, 10);
    // Intl renders midnight as "24" in some locales/engines.
    return Number.isFinite(h) ? h % 24 : d.getUTCHours();
  } catch {
    // An invalid timezone must not take the risk engine down with it.
    return d.getUTCHours();
  }
}

/** §6/§7.4 — 21:00–06:00 local. Fewer vehicles, faster, animal invisible. */
export function isNightHour(hour: number): boolean {
  return hour >= 21 || hour < 6;
}
