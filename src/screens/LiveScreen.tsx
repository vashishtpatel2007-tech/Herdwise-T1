/**
 * Live Map — FARMO style.
 *
 * Full-bleed map with cow-head markers (NOT colored dots).
 * Only shows animals at their real positions — never at random fallback locations.
 * Floating status card at bottom with proper counts.
 */

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Polygon, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { LatLngExpression } from 'leaflet';

import { useHerd, type HerdMember } from '../lib/useHerd.tsx';
import { supabase } from '../lib/supabase.ts';
import { CowMarker } from '../components/CowMarker.tsx';
import {
  BaseLayers, RoadLines, MeMarker, useMyLocation, type RoadFeature,
} from '../components/MapLayers.tsx';
import { RiskCone } from '../components/RiskCone.tsx';
import { AnimalSheet } from '../components/AnimalSheet.tsx';
import { ageLabel, freshness } from '../lib/format.ts';
import { toneOf } from './AnimalsScreen.tsx';
import { IconLayers } from '../components/Icons.tsx';

interface ZoneFeature { id: string; name: string; ring: Array<[number, number]> }

function FitHerd({ points, meAt }: { points: Array<[number, number]>; meAt?: [number, number] | null }) {
  const map = useMap();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    const all = [...points];
    if (meAt) all.push(meAt);
    if (all.length === 0) return;
    if (all.length === 1) map.setView(all[0], 16);
    else map.fitBounds(all, { padding: [56, 56], maxZoom: 17 });
    setDone(true);
  }, [points, meAt, map, done]);
  return null;
}

export function LiveScreen() {
  const { t } = useTranslation();
  const { herd, counts, online, lastSyncAt, refresh } = useHerd();
  const [satellite, setSatellite] = useState(true);
  const [selected, setSelected] = useState<HerdMember | null>(null);
  const [roads, setRoads] = useState<RoadFeature[]>([]);
  const [zones, setZones] = useState<ZoneFeature[]>([]);
  const [cone, setCone] = useState<{ pts: Array<[number, number]>; p: number } | null>(null);
  const [, tickNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tickNow((n) => n + 1), 20_000);
    return () => clearInterval(id);
  }, []);

  const me = useMyLocation();

  useEffect(() => {
    void (async () => {
      const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
      if (!farmer) return;
      const [r, z] = await Promise.all([
        supabase.rpc('roads_near_zones', { p_farmer_id: farmer.id }),
        supabase.rpc('zones_geojson', { p_farmer_id: farmer.id }),
      ]);
      if (Array.isArray(r.data)) setRoads(r.data as RoadFeature[]);
      if (Array.isArray(z.data)) setZones(z.data as ZoneFeature[]);
    })();
  }, []);

  // Only animals with actual positions (ignore 0,0 Null Island before GPS lock)
  const animalsWithPos = useMemo(
    () => herd.filter((m) => m.position != null && (m.position!.lat !== 0 || m.position!.lon !== 0)),
    [herd],
  );

  const points = useMemo(
    () => animalsWithPos.map((m) => [m.position!.lat, m.position!.lon] as [number, number]),
    [animalsWithPos],
  );

  const worst = useMemo(
    () => herd
      .filter((m) => (m.risk?.road_risk ?? 0) >= 40 && m.risk?.p_reaches_road_5min != null)
      .sort((a, b) => b.risk!.road_risk - a.risk!.road_risk)[0] ?? null,
    [herd],
  );

  useEffect(() => {
    if (!worst?.position) { setCone(null); return; }
    void (async () => {
      const { data } = await supabase.rpc('cone_for_animal', { p_animal_id: worst.animal.id });
      setCone(Array.isArray(data) && data.length > 2
        ? { pts: data as Array<[number, number]>, p: worst.risk!.p_reaches_road_5min ?? 0 }
        : null);
    })();
  }, [worst?.animal.id, worst?.risk?.road_risk]);

  // Use user location as fallback, or Bangalore if no position data at all
  const centre: LatLngExpression = points[0] ?? me?.at ?? [13.0827, 77.5877];
  const needsYou = counts.danger + counts.out;

  return (
    <div className="relative h-full w-full">
      <MapContainer center={centre} zoom={16} zoomControl={false}
                    className="absolute inset-0 h-full w-full">
        <BaseLayers satellite={satellite} />
        <FitHerd points={points} meAt={me?.at ?? null} />

        <RoadLines roads={roads} />

        {zones.map((z) => (
          <Polygon key={z.id} positions={z.ring}
            pathOptions={{ color: '#2D6A4F', weight: 3, fillColor: '#52B788', fillOpacity: .12 }} />
        ))}

        {cone && <RiskCone endpoints={cone.pts} probability={cone.p} />}

        {/* Cow markers — only for animals with real positions.
            Tone comes from the SAME toneOf() every other screen uses, which
            reads situation as well as state -- this used to check state
            alone, so an animal flagged outside_zone (a real, active geofence
            breach) still showed as a plain green pin on the one screen most
            likely to be open while she is actually out. */}
        {animalsWithPos.map((m) => {
          const stale = freshness(m.position!.recorded_at) === 'stale';
          const tone = toneOf(m.risk?.state ?? 'safe', m.risk?.situation);
          return (
            <CowMarker
              key={m.animal.id}
              position={[m.position!.lat, m.position!.lon]}
              tone={tone as 'safe' | 'warn' | 'danger'}
              stale={stale}
              selected={selected?.animal.id === m.animal.id}
              label={m.animal.name}
              onClick={() => setSelected(m)}
            />
          );
        })}

        {/* The farmer himself — a blue dot with its accuracy ring, NOT a cow
            pin. Rendering him as an animal put a seventh cow in a herd of
            six and made the counts on the card disagree with the map. */}
        {me && <MeMarker at={me.at} accuracy={me.accuracy} />}
      </MapContainer>

      {!online && (
        <div className="absolute left-0 right-0 top-0 z-[1000] px-4 py-3 text-center"
             style={{ background: 'var(--text)', color: 'var(--bg)', fontWeight: 700 }}>
          {t('map.offline')}
        </div>
      )}

      {/* One icon, not three chips -- satellite/plain is the only thing on
          this row that changes what kind of MAP you're looking at. Fields
          and roads are context that should just always be there. */}
      <button onClick={() => setSatellite((sat) => !sat)}
              aria-label={satellite ? t('map.plain') : t('map.satellite')}
              aria-pressed={satellite}
              className="absolute left-3 top-3 z-[1000] grid place-items-center"
              style={{ width: 44, height: 44, minHeight: 0, borderRadius: 14,
                       background: '#fff', color: '#17301F',
                       boxShadow: '0 2px 10px rgba(12,32,18,.28)' }}>
        <IconLayers size={21} />
      </button>

      {/* Status card */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] p-3">
        <div className="card" style={{ padding: '0.85rem 0.95rem' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="d-sm">
                {needsYou === 0 ? 'All animals safe' : `${needsYou} need${needsYou === 1 ? 's' : ''} you`}
              </p>
              <p className="t-meta mt-0.5">
                {lastSyncAt ? ageLabel(new Date(lastSyncAt).toISOString(), t) : t('age.never')}
              </p>
            </div>
            <button onClick={() => void refresh()} className="btn btn-primary shrink-0"
                    style={{ minHeight: 42, paddingInline: '1rem', fontSize: '.88rem' }}>
              Refresh
            </button>
          </div>

          <div className="mt-2.5 flex gap-2">
            <CountBadge n={counts.safe} label="Safe" tone="safe" />
            <CountBadge n={counts.out} label="Watch" tone="warn" />
            <CountBadge n={counts.danger} label="Danger" tone="danger" />
          </div>

          {needsYou > 0 && (
            <Link to="/animals" className="btn btn-ghost mt-2.5 w-full"
                  style={{ minHeight: 42, fontSize: '.88rem' }}>
              See who needs you
            </Link>
          )}
        </div>
      </div>

      {selected && <AnimalSheet member={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function CountBadge({ n, label, tone }: { n: number; label: string; tone: 'safe' | 'warn' | 'danger' }) {
  const colors = {
    safe: { bg: 'var(--green-soft)', color: 'var(--green)' },
    warn: { bg: 'var(--amber-soft)', color: 'var(--amber)' },
    danger: { bg: 'var(--red-soft)', color: 'var(--red)' },
  };
  const c = colors[tone];
  return (
    <div className="flex-1 flex items-center gap-2 px-3 py-2"
         style={{ borderRadius: 12, background: n > 0 ? c.bg : 'var(--card-2)' }}>
      <b className="tnum" style={{ color: n > 0 ? c.color : 'var(--text-faint)', fontSize: '1rem' }}>{n}</b>
      <span style={{ fontSize: '.76rem', color: 'var(--text-dim)' }}>{label}</span>
    </div>
  );
}

