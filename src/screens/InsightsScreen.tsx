/**
 * Insights — the patterns behind the alerts.
 *
 * A single alert tells the farmer to go now. This screen answers the slower
 * question: which road keeps catching us, which animal keeps wandering, and
 * what time of day it happens — so he can move a gate or watch one animal
 * instead of reacting forever.
 *
 * Everything here is counted from his own alert history. Where there is no
 * history yet the screen says so plainly rather than drawing an empty chart
 * that looks like data.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';
import { batteryWords } from '../lib/format.ts';

interface AlertRow {
  id: string; animal_id: string; kind: string; severity: string;
  road_name: string | null; created_at: string;
}
interface DeviceRow {
  id: string; device_key: string; animal_id: string | null;
  battery_pct: number | null; last_seen_at: string | null; is_enabled: boolean | null;
}

const DAY_MS = 86_400_000;

export function InsightsScreen() {
  const { t } = useTranslation();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const since = new Date(Date.now() - 7 * DAY_MS).toISOString();
      const [a, an, d] = await Promise.all([
        supabase.from('alerts')
          .select('id, animal_id, kind, severity, road_name, created_at')
          .gte('created_at', since).order('created_at', { ascending: false }),
        supabase.from('animals').select('id, name'),
        supabase.from('devices').select('id, device_key, animal_id, battery_pct, last_seen_at, is_enabled'),
      ]);
      setAlerts((a.data ?? []) as AlertRow[]);
      setNames(Object.fromEntries((an.data ?? []).map((x) => [x.id, x.name as string])));
      setDevices((d.data ?? []) as DeviceRow[]);
      setLoading(false);
    })();
  }, []);

  /** Seven days, oldest first, so the chart reads left to right like a week. */
  const week = useMemo(() => {
    const days: { label: string; n: number; danger: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toDateString();
      const hits = alerts.filter((x) => new Date(x.created_at).toDateString() === key);
      days.push({
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        n: hits.length,
        danger: hits.filter((x) => x.severity === 'critical' || x.severity === 'high').length,
      });
    }
    return days;
  }, [alerts]);

  const byRoad = useMemo(() => rank(alerts.filter((a) => a.road_name).map((a) => a.road_name!)), [alerts]);
  const byAnimal = useMemo(
    () => rank(alerts.map((a) => names[a.animal_id]).filter(Boolean) as string[]),
    [alerts, names],
  );

  /** Night is 21:00–06:00 — when a driver cannot see her. */
  const nightShare = useMemo(() => {
    if (!alerts.length) return null;
    const night = alerts.filter((a) => {
      const h = new Date(a.created_at).getHours();
      return h >= 21 || h < 6;
    }).length;
    return Math.round((night / alerts.length) * 100);
  }, [alerts]);

  const needCharge = devices.filter((d) => (d.battery_pct ?? 100) < 30);
  const offCollars = devices.filter((d) => d.is_enabled === false);
  const peak = Math.max(1, ...week.map((d) => d.n));

  if (loading) return <div className="p-6 t-body">…</div>;

  return (
    <div className="h-full overflow-y-auto" style={{ background: 'var(--bg)' }}>
      <header className="px-4 pt-5 pb-3">
        <p className="t-label">Insights</p>
        <h1 className="d-lg mt-1">Last 7 days</h1>
        <p className="t-meta mt-1.5">
          {alerts.length === 0
            ? 'No alerts this week.'
            : `${alerts.length} alert${alerts.length === 1 ? '' : 's'} across your herd.`}
        </p>
      </header>

      <div className="grid gap-3 px-4 pb-8">
        {/* ---- the week ---- */}
        <section className="card">
          <p className="t-label">Alerts each day</p>
          {/* No fixed height here. It used to be 96px, but each column is a
              72px bar box plus a count and a weekday letter — about 112px — so
              the columns overflowed upward and printed straight over the
              "Alerts each day" heading. The inner bar box is the only thing
              that needs a fixed height. */}
          <div className="mt-3 flex items-end gap-2">
            {week.map((d, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-col justify-end" style={{ height: 72 }}>
                  {d.n > 0 ? (
                    <div
                      className="w-full rounded-t-md"
                      style={{
                        height: `${Math.max(8, (d.n / peak) * 72)}px`,
                        background: d.danger > 0 ? 'var(--red)' : 'var(--green)',
                      }}
                      title={`${d.n} alerts`}
                    />
                  ) : (
                    <div className="w-full rounded-t-md"
                         style={{ height: 3, background: 'var(--line)' }} />
                  )}
                </div>
                <span className="t-meta tnum" style={{ fontSize: '.72rem' }}>{d.n || ''}</span>
                <span className="t-label" style={{ fontSize: '.66rem' }}>{d.label}</span>
              </div>
            ))}
          </div>
          {nightShare !== null && (
            <p className="t-meta mt-3" style={{ borderTop: '1.5px solid var(--line)', paddingTop: '.7rem' }}>
              <b style={{ color: 'var(--text)' }}>{nightShare}%</b> happened at night,
              between 9pm and 6am — when a driver cannot see her.
            </p>
          )}
        </section>

        {/* ---- worst road ---- */}
        <section className="card">
          <p className="t-label">Roads that keep catching you</p>
          {byRoad.length === 0
            ? <p className="t-meta mt-2">No road alerts yet.</p>
            : (
              <ul className="mt-2.5 grid gap-2">
                {byRoad.slice(0, 3).map(([road, n]) => (
                  <li key={road} className="flex items-center gap-3">
                    <span className="t-body flex-1 truncate" style={{ fontWeight: 700 }}>{road}</span>
                    <span className="rounded-full px-2.5 py-1 tnum"
                          style={{ background: 'var(--red-soft)', color: 'var(--red)',
                                   fontWeight: 800, fontSize: '.82rem' }}>
                      {n}
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {/* ---- animals that wander ---- */}
        <section className="card">
          <p className="t-label">Animals to watch</p>
          {byAnimal.length === 0
            ? <p className="t-meta mt-2">Nobody has strayed this week.</p>
            : (
              <ul className="mt-2.5 grid gap-2">
                {byAnimal.slice(0, 3).map(([name, n]) => (
                  <li key={name} className="flex items-center gap-3">
                    <span className="t-body flex-1 truncate" style={{ fontWeight: 700 }}>{name}</span>
                    <span className="t-meta tnum">{n} alert{n === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
            )}
        </section>

        {/* ---- collars needing a hand ---- */}
        <section className="card">
          <p className="t-label">Collars</p>
          <div className="mt-2.5 grid gap-2">
            <Row label="Total" value={String(devices.length)} />
            <Row label="Need charging" value={String(needCharge.length)}
                 tone={needCharge.length ? 'warn' : undefined} />
            <Row label="Switched off" value={String(offCollars.length)}
                 tone={offCollars.length ? 'warn' : undefined} />
          </div>
          {needCharge.length > 0 && (
            <ul className="mt-3 grid gap-1.5"
                style={{ borderTop: '1.5px solid var(--line)', paddingTop: '.7rem' }}>
              {needCharge.slice(0, 4).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3">
                  <Link to={d.animal_id ? `/animal/${d.animal_id}` : '/herd'}
                        className="t-body truncate" style={{ fontWeight: 700 }}>
                    {d.animal_id ? (names[d.animal_id] ?? d.device_key) : d.device_key}
                  </Link>
                  <span className="t-meta shrink-0">{batteryWords(d.battery_pct, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="t-body" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className="tnum" style={{
        fontWeight: 800, fontSize: '1.05rem',
        color: tone === 'warn' ? 'var(--amber)' : 'var(--text)',
      }}>{value}</span>
    </div>
  );
}

/** Count occurrences and return most-frequent first. */
function rank(xs: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
