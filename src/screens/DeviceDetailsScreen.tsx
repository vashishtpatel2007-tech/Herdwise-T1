/**
 * §9.6 — Device details. Every engineering readout lives here and NOWHERE else.
 *
 * Signal, packet counts, HDOP, raw coordinates, the `components` jsonb. This is
 * the page you open when a judge asks "why did it fire?" — §7.6 stores the
 * component breakdown on every evaluation precisely so that question has an
 * answer you can point at rather than argue about.
 *
 * Keeping it off every other screen is the point. A farmer must never have to
 * scroll past a dilution-of-precision figure to find out whether his cow is
 * safe.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase.ts';
import { ageLabel } from '../lib/format.ts';
import { useTranslation } from 'react-i18next';
import { WEIGHTS } from '../engine/score.ts';

export function DeviceDetailsScreen() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const [risk, setRisk] = useState<Record<string, unknown> | null>(null);
  const [fix, setFix] = useState<Record<string, unknown> | null>(null);
  const [device, setDevice] = useState<Record<string, unknown> | null>(null);
  const [counts, setCounts] = useState<{ total: number; poor: number } | null>(null);

  useEffect(() => {
    void (async () => {
      const [r, f, d, c] = await Promise.all([
        supabase.from('risk_state').select('*').eq('animal_id', id).maybeSingle(),
        supabase.from('latest_positions').select('*').eq('animal_id', id).maybeSingle(),
        supabase.from('devices').select('*').eq('animal_id', id).maybeSingle(),
        supabase.rpc('packet_counts', { p_animal_id: id }),
      ]);
      setRisk(r.data as Record<string, unknown> | null);
      setFix(f.data as Record<string, unknown> | null);
      setDevice(d.data as Record<string, unknown> | null);
      setCounts(c.data as { total: number; poor: number } | null);
    })();
  }, [id]);

  const components = (risk?.components ?? {}) as Record<string, number | boolean | string>;

  return (
    <div className="h-full overflow-y-auto bg-card2 p-4">
      <h1 className="d-lg">Device details</h1>

      <Section title="Fix quality">
        <Row k="fix_quality" v={fix?.fix_quality} />
        <Row k="hdop" v={fix?.hdop} />
        <Row k="satellites" v={fix?.sats} />
        <Row k="latitude" v={fix?.lat} />
        <Row k="longitude" v={fix?.lon} />
        <Row k="heading" v={fix?.heading_deg} />
        <Row k="speed_kmh" v={fix?.speed_kmh} />
        <Row k="recorded_at" v={ageLabel(fix?.recorded_at as string, t)} />
      </Section>

      <Section title="Packets">
        <Row k="total" v={counts?.total} />
        {/* Poor fixes are stored but never scored (§7.2). A rising ratio here
            is the evidence behind a gps_fault alert. */}
        <Row k="rejected by GPS veto" v={counts?.poor} />
        <Row k="firmware" v={device?.firmware} />
        <Row k="battery_pct" v={device?.battery_pct} />
        <Row k="last_seen" v={ageLabel(device?.last_seen_at as string, t)} />
      </Section>

      <Section title="Risk state">
        <Row k="state" v={risk?.state} />
        <Row k="situation" v={risk?.situation} />
        <Row k="road_risk" v={risk?.road_risk} />
        <Row k="geofence_risk" v={risk?.geofence_risk} />
        <Row k="p_reaches_road_5min" v={risk?.p_reaches_road_5min} />
        <Row k="updated" v={ageLabel(risk?.updated_at as string, t)} />
      </Section>

      {/* The whole point of storing components: this table IS the explanation. */}
      <Section title="Why it scored that">
        {Object.entries(WEIGHTS).map(([k, w]) => {
          const raw = Number(components[k] ?? 0);
          return (
            <div key={k} className="border-b border-line py-2 last:border-0">
              <div className="flex justify-between text-[15px]">
                <span className="font-semibold">{k}</span>
                <span className="tnum font-bold">
                  {raw.toFixed(2)} × {w} = {(raw * w).toFixed(3)}
                </span>
              </div>
              <div className="mt-1 h-2 rounded bg-ink/10">
                <div className="h-2 rounded bg-green"
                     style={{ width: `${Math.min(100, raw * 100)}%` }} />
              </div>
            </div>
          );
        })}
        {components.override && (
          <p className="mt-3 rounded-lg bg-red/10 p-3 text-[15px] font-bold text-red">
            Score overridden by §7.4: {String(components.override)}
          </p>
        )}
        {components.traffic_fallback === true && (
          <p className="mt-2 text-[14px] font-semibold opacity-70">
            Traffic from time-of-day fallback, not live TomTom data.
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card mt-4">
      <h2 className="mb-2 text-[14px] font-extrabold uppercase tracking-wide opacity-60">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: unknown }) {
  return (
    <div className="flex justify-between border-b border-line py-1.5 text-[15px] last:border-0">
      <span className="font-semibold opacity-70">{k}</span>
      <span className="tnum font-bold">{v === null || v === undefined ? '—' : String(v)}</span>
    </div>
  );
}
