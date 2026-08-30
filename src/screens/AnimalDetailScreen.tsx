/**
 * Animal Detail — FARMO style.
 *
 * Matches the reference: large circular photo, name + tag number,
 * clean reading rows (Speed, Temperature, Live Location, Distance),
 * tab switch for Now/History/Collar.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { AnimalQR } from '../components/AnimalQR.tsx';
import { CollarControl } from '../components/CollarControl.tsx';
import { CowMarker } from '../components/CowMarker.tsx';
import { ageLabel, freshness } from '../lib/format.ts';
import { toneOf } from './AnimalsScreen.tsx';
import { haversine } from '../engine/geo.ts';
import { MeMarker, useMyLocation } from '../components/MapLayers.tsx';
import {
  IconChevron, IconSpeed, IconBattery, IconPin, IconCollar, IconShield,
  IconCow, IconThermo, IconRoute,
} from '../components/Icons.tsx';

const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

interface Track { lat: number; lon: number; recorded_at: string }

export function AnimalDetailScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation();
  const me = useMyLocation();

  const [animal, setAnimal] = useState<Record<string, unknown> | null>(null);
  const [risk, setRisk] = useState<Record<string, unknown> | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [track, setTrack] = useState<Track[]>([]);
  const [alerts, setAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [tab, setTab] = useState<'now' | 'history' | 'collar'>('now');
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, r, tr, al, pos] = await Promise.all([
        supabase.from('animals').select('*').eq('id', id).maybeSingle(),
        supabase.from('risk_state').select('*').eq('animal_id', id).maybeSingle(),
        supabase.rpc('animal_track_today', { p_animal_id: id }),
        supabase.from('alerts').select('*').eq('animal_id', id)
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('latest_positions').select('*').eq('animal_id', id).maybeSingle(),
      ]);
      setAnimal(a.data as Record<string, unknown> | null);
      setRisk(r.data as Record<string, unknown> | null);
      setTrack(Array.isArray(tr.data) ? (tr.data as Track[]).filter(p => p.lat !== 0 || p.lon !== 0) : []);
      setAlerts((al.data ?? []) as Array<Record<string, unknown>>);
      setLive(pos.data as Record<string, unknown> | null);
    })();
  }, [id]);

  const cleanTrack = useMemo(() => {
    if (track.length <= 1) return track;
    const res: Track[] = [track[0]];
    for (let i = 1; i < track.length; i++) {
      const d = haversine(track[i - 1].lat, track[i - 1].lon, track[i].lat, track[i].lon);
      if (d < 600) {
        res.push(track[i]);
      } else {
        res.length = 0;
        res.push(track[i]);
      }
    }
    return res;
  }, [track]);

  const line = useMemo(() => cleanTrack.map((p) => [p.lat, p.lon] as [number, number]), [cleanTrack]);
  const state = (risk?.state as string) ?? 'safe';
  const k = toneOf(state, risk?.situation as string | undefined);
  const stale = freshness(live?.recorded_at as string | undefined) === 'stale';

  if (!animal) {
    return (
      <div className="h-full p-5" style={{ background: 'var(--bg)' }}>
        <div className="skeleton" style={{ height: 180, borderRadius: 22 }} />
      </div>
    );
  }

  const bat = (live?.battery_pct as number | null) ?? null;
  const speed = live?.speed_kmh as number | null;
  const temp = live?.temperature_c as number | null;
  const hr = live?.heart_rate_bpm as number | null;
  const lat = live?.lat as number | null;
  const lon = live?.lon as number | null;

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ background: 'var(--bg)' }}>
      {/* ---- app bar ---- */}
      <div className="appbar sticky top-0 z-20">
        <button onClick={() => nav(-1)} aria-label="Back" className="icon-btn">
          <span style={{ transform: 'rotate(180deg)', display: 'block' }}>
            <IconChevron size={18} />
          </span>
        </button>
        <p className="d-md flex-1 text-center">Animal Detail</p>
        <Link to={`/device/${id}`} aria-label="Device details" className="icon-btn">
          <IconCollar size={18} />
        </Link>
      </div>

      {/* ---- identity card ---- */}
      <section className="rise card mx-4 mt-4 flex items-center gap-3.5">
        <span className="grid place-items-center shrink-0 overflow-hidden"
          style={{
            width: '4.5rem', height: '4.5rem', borderRadius: 999,
            background: 'var(--green-soft)', border: '3px solid var(--green)'
          }}>
          {animal.photo_url
            ? <img src={String(animal.photo_url)} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <IconCow size={28} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="d-lg truncate">{String(animal.name)}</h1>
            <span className={`pill pill-${k}`}>{t(`status.${state}`)}</span>
          </div>
          <p className="t-meta mt-0.5">
            {animal.pashu_aadhaar_tag ? `#${String(animal.pashu_aadhaar_tag).slice(-4)} · ` : ''}
            {String(animal.breed ?? '')}
          </p>
          <p className="t-meta mt-0.5" style={stale ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
            {ageLabel(live?.recorded_at as string | undefined, t)}
          </p>
        </div>
      </section>

      {/* ---- tabs ---- */}
      <div className="mt-3 flex gap-2 px-4">
        {(['now', 'history', 'collar'] as const).map((x) => (
          <button key={x} onClick={() => setTab(x)} aria-pressed={tab === x}
            className="flex-1 px-3"
            style={{
              minHeight: 36, borderRadius: 999, fontSize: '.82rem', fontWeight: 700,
              background: tab === x ? 'var(--green)' : 'var(--card)',
              color: tab === x ? '#fff' : 'var(--text-dim)',
              border: '1px solid ' + (tab === x ? 'var(--green)' : 'var(--line-soft)'),
              boxShadow: tab === x ? 'none' : 'var(--sh)',
            }}>
            {x === 'now' ? 'Now' : x === 'history' ? 'History' : 'Collar'}
          </button>
        ))}
      </div>

      {tab === 'now' && (
        <div className="mt-3 grid gap-3 px-4">
          {/* readings */}
          <section className="rise card">
            <p className="t-label" style={{ marginBottom: '.4rem' }}>Current Readings</p>
            <div>
              <Reading icon={<IconSpeed size={16} />} label="Speed"
                value={speed == null ? '—' : `${speed.toFixed(1)} km/h`} />
              <Reading icon={<IconThermo size={16} />} label="Temperature"
                value={temp == null ? '—' : `${temp.toFixed(1)} °C`}
                hint={temp == null ? 'No sensor' : undefined} />
              <Reading icon={<IconPin size={16} />} label="Live Location (Km)"
                value={lat != null && lon != null
                  ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '—'} />
              <Reading icon={<IconRoute size={16} />} label="Distance to Road"
                value={alerts[0]?.distance_m != null
                  ? `${alerts[0].distance_m} m` : '—'} />
              <Reading icon={<IconBattery size={16} />} label="Battery"
                value={bat == null ? '—' : `${bat}%`}
                bar={bat} alert={bat != null && bat < 20} />
              <Reading icon={<IconShield size={16} />} label="Heart Rate"
                value={hr == null ? '—' : `${hr} bpm`}
                hint={hr == null ? 'No sensor' : undefined} last />
            </div>
          </section>

          {/* live tracking link */}
          <Link to={`/live/${id}`} className="rise card card-lit flex items-center gap-3.5">
            <span className="grid shrink-0 place-items-center"
              style={{
                width: 46, height: 46, borderRadius: 15,
                background: 'var(--green-soft)', color: 'var(--green)'
              }}>
              <IconPin size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="d-sm block">Start Live Tracking</span>
              <span className="t-meta block">Follow her at 5-second updates</span>
            </span>
            <IconChevron size={18} />
          </Link>

          <button onClick={() => setShowQR((s) => !s)} className="btn btn-ghost w-full">
            {showQR ? 'Hide tag' : 'Printable ear tag'}
          </button>
          {showQR && (
            <AnimalQR slug={String(animal.public_slug)} animalName={String(animal.name)}
              tagNumber={(animal.pashu_aadhaar_tag as string) ?? null} />
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="mt-3 grid gap-3 px-4">
          <section className="rise card" style={{ padding: '.75rem' }}>
            <p className="t-label px-1.5">Today's Track</p>
            <div className="mt-2" style={{ height: 200, borderRadius: 14, overflow: 'hidden' }}>
              {line.length > 1 ? (
                <MapContainer center={line[line.length - 1]} zoom={16} zoomControl={false}
                  attributionControl={false} style={{ height: '100%', width: '100%' }}>
                  <TileLayer url={ESRI} maxZoom={19} maxNativeZoom={17} />
                  <Polyline positions={line} pathOptions={{ color: '#2D6A4F', weight: 4 }} />
                  <CowMarker position={line[line.length - 1]} tone="safe" selected
                    label={String(animal.name)} />
                  {me && <MeMarker at={me.at} accuracy={me.accuracy} />}
                </MapContainer>
              ) : (
                <div className="grid h-full place-items-center tile">
                  <div className="text-center">
                    <IconCow size={28} />
                    <p className="t-meta mt-2">Not enough movement today to draw a track.</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="rise card">
            <p className="t-label">Recent Alerts</p>
            <ul className="mt-2 grid gap-2">
              {alerts.map((a) => (
                <li key={String(a.id)} className="tile" style={{ padding: '.7rem .8rem' }}>
                  <p className="t-body" style={{ fontWeight: 600 }}>
                    {a.message
                      ? t(String(a.message), {
                        name: String(animal.name),
                        road: (a.road_name as string) ?? t('road.generic'),
                      })
                      : String(a.kind)}
                  </p>
                  <p className="t-meta mt-0.5">{ageLabel(String(a.created_at), t)}</p>
                </li>
              ))}
              {alerts.length === 0 && (
                <li className="t-meta py-3 text-center">Nothing has gone wrong yet.</li>
              )}
            </ul>
          </section>
        </div>
      )}

      {tab === 'collar' && (
        <div className="mt-3 px-4">
          <CollarControl animalId={id} />
        </div>
      )}
    </div>
  );
}

function Reading({ icon, label, value, bar, alert, hint, last }: {
  icon: React.ReactNode; label: string; value: string;
  bar?: number | null; alert?: boolean; hint?: string; last?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5"
      style={{ borderBottom: last ? 'none' : '1px solid var(--line-soft)' }}>
      <span className="grid shrink-0 place-items-center"
        style={{
          width: 34, height: 34, borderRadius: 10,
          background: 'var(--green-soft)', color: 'var(--green)'
        }}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-body block" style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>{label}</span>
        {hint && <span className="t-meta block" style={{ fontSize: '.72rem' }}>{hint}</span>}
      </span>
      <span className="shrink-0 text-right">
        <span className="d-sm tnum block" style={alert ? { color: 'var(--amber)' } : undefined}>
          {value}
        </span>
        {bar != null && (
          <span className="mt-1 block" style={{
            width: 58, height: 5, borderRadius: 999,
            background: 'var(--card-2)'
          }}>
            <span style={{
              display: 'block', height: '100%', width: `${Math.max(3, bar)}%`,
              borderRadius: 999,
              background: bar < 20 ? 'var(--amber)' : 'var(--green)',
            }} />
          </span>
        )}
      </span>
    </div>
  );
}
