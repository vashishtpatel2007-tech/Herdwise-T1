/**
 * Live Tracking — FARMO style.
 *
 * Full-bleed map with cow-head markers. Works gracefully even without
 * backend data — uses user's geolocation as center, shows proper empty state.
 * "LIVE" badge, "Stop Live" / "Start Live" buttons matching FARMO design.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { requestLive } from '../lib/collar.ts';
import { ageLabel } from '../lib/format.ts';
import { haversine } from '../engine/geo.ts';
import { CowMarker } from '../components/CowMarker.tsx';
import { useHerd } from '../lib/useHerd.tsx';
import { toneOf } from './AnimalsScreen.tsx';
import { IconChevron, IconCow } from '../components/Icons.tsx';
import { MeMarker, useMyLocation } from '../components/MapLayers.tsx';

const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const SESSION_S = 600;
const POLL_MS = 5000;

interface Fix { lat: number; lon: number; recorded_at: string }

/**
 * Frame the walk, then follow her.
 */
function Follow({ at, trail, meAt }: { at: [number, number] | null; trail: Array<[number, number]>; meAt: [number, number] | null }) {
  const map = useMap();
  const framed = useRef(false);

  useEffect(() => {
    if (!framed.current) {
      const allPts: Array<[number, number]> = [...trail];
      if (meAt) allPts.push(meAt);
      if (allPts.length > 1) {
        map.fitBounds(allPts, { padding: [60, 90], maxZoom: 17 });
        framed.current = true;
        return;
      }
      if (at) {
        map.setView(at, 16);
        framed.current = true;
        return;
      }
    }
    // Only chase her once she has actually left the view.
    if (at && framed.current && !map.getBounds().pad(-0.18).contains(at)) {
      map.panTo(at, { animate: true, duration: .6 });
    }
  }, [at, trail, meAt, map]);

  return null;
}

export function LiveTrackingScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { t } = useTranslation();

  const [animal, setAnimal] = useState<{ name: string; photo_url: string | null } | null>(null);
  const [trail, setTrail] = useState<Fix[]>([]);
  const [left, setLeft] = useState(SESSION_S);
  const [live, setLive] = useState(true);
  const deviceId = useRef<string | null>(null);
  const me = useMyLocation();

  // Same risk state the dashboard reads, so one animal cannot be green here
  // and red two screens away.
  const { herd } = useHerd();
  const liveTone = useMemo(() => {
    const m = herd.find((x) => x.animal.id === id);
    return toneOf(m?.risk?.state ?? 'safe', m?.risk?.situation);
  }, [herd, id]);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.rpc('recent_track', { p_animal_id: id, p_minutes: 30 });
      if (Array.isArray(data)) setTrail((data as Fix[]).filter(f => f.lat !== 0 || f.lon !== 0));
    } catch {
      // Graceful fallback — no track data available
    }
  }, [id]);

  useEffect(() => {
    void (async () => {
      const [a, d] = await Promise.all([
        supabase.from('animals').select('name, photo_url').eq('id', id).maybeSingle(),
        supabase.from('devices').select('id').eq('animal_id', id).maybeSingle(),
      ]);
      setAnimal(a.data as typeof animal);
      deviceId.current = (d.data?.id as string) ?? null;
      if (deviceId.current) {
        try {
          await requestLive(deviceId.current, Math.round(SESSION_S / 60));
        } catch {
          // Collar request may fail — that's ok
        }
      }
      await load();
    })();
  }, [id, load]);

  useEffect(() => {
    if (!live) return;
    const poll = setInterval(() => void load(), POLL_MS);
    const tick = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { setLive(false); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [live, load]);

  // Filter trail: keep contiguous points (reject sudden GPS jumps > 600m from different simulation runs)
  const cleanTrail = useMemo(() => {
    if (trail.length <= 1) return trail;
    const res: Fix[] = [trail[0]];
    for (let i = 1; i < trail.length; i++) {
      const d = haversine(trail[i - 1].lat, trail[i - 1].lon, trail[i].lat, trail[i].lon);
      if (d < 600) {
        res.push(trail[i]);
      } else {
        // If there's a big jump (e.g. from previous test coordinates), keep only the newer contiguous leg
        res.length = 0;
        res.push(trail[i]);
      }
    }
    return res;
  }, [trail]);

  const line = useMemo(() => cleanTrail.map((f) => [f.lat, f.lon] as [number, number]), [cleanTrail]);
  const head = line.length ? line[line.length - 1] : null;
  const last = cleanTrail[cleanTrail.length - 1];

  const walked = useMemo(
    () => cleanTrail.reduce((s, f, i) => i === 0 ? 0
      : s + haversine(cleanTrail[i - 1].lat, cleanTrail[i - 1].lon, f.lat, f.lon), 0),
    [cleanTrail],
  );

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  // Map center: prioritize cow head, then farmer location, then Bangalore default
  const mapCenter: [number, number] = head ?? me?.at ?? [13.0827, 77.5877];

  return (
    <div className="relative h-full" style={{ background: 'var(--bg)' }}>
      <MapContainer center={mapCenter} zoom={head ? 17 : 14} zoomControl={false}
                    className="absolute inset-0 h-full w-full">
        <TileLayer url={ESRI} maxZoom={19} maxNativeZoom={17}
                   attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics" />
        <Follow at={live ? head : null} trail={line} meAt={me?.at ?? null} />

        {/* Trail line */}
        {line.length > 1 && (
          <>
            <Polyline positions={line}
                      pathOptions={{ color: '#1B4332', weight: 8, opacity: .4 }} />
            <Polyline positions={line}
                      pathOptions={{ color: '#52B788', weight: 4, opacity: .95 }} />
          </>
        )}

        {/* Breadcrumbs are small dots, NOT cow pins. */}
        {line.slice(0, -1).map((p, i) => (
          <CircleMarker key={i} center={p} radius={3.5}
            pathOptions={{ color: '#FFFFFF', weight: 1.5,
                           fillColor: '#2D6A4F', fillOpacity: .9 }} />
        ))}

        {/* Where the farmer is standing (Live Blue Dot + Accuracy ring) */}
        {me && <MeMarker at={me.at} accuracy={me.accuracy} />}

        {/* Current cow position — large cow marker */}
        {head && (
          <CowMarker position={head} tone={liveTone} selected label={animal?.name} />
        )}
      </MapContainer>

      {/* ---- top bar ---- */}
      <div className="absolute inset-x-0 top-0 z-[1000] flex items-center gap-2 p-3">
        <button onClick={() => nav(-1)} aria-label="Back"
                className="grid place-items-center shrink-0"
                style={{ width: 40, height: 40, borderRadius: 12,
                         background: 'rgba(255,255,255,.95)', boxShadow: 'var(--sh)',
                         color: 'var(--text)' }}>
          <span style={{ transform: 'rotate(180deg)', display: 'block' }}>
            <IconChevron size={18} />
          </span>
        </button>

        <span className="flex items-center gap-2 px-3.5"
              style={{ height: 38, borderRadius: 999,
                       background: live ? 'var(--red)' : 'rgba(255,255,255,.95)',
                       color: live ? '#fff' : 'var(--text-dim)',
                       boxShadow: 'var(--sh)', fontWeight: 800, fontSize: '.8rem' }}>
          <span className={live ? 'live-dot' : ''}
                style={{ width: 7, height: 7, borderRadius: 999,
                         background: live ? '#fff' : 'var(--text-faint)' }} />
          {live ? 'LIVE' : 'ENDED'}
          <span className="tnum" style={{ opacity: .85 }}>{mm}:{ss}</span>
        </span>

        <span className="d-sm flex-1 text-center truncate"
              style={{ color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,.5)' }}>
          Live Tracking
        </span>
      </div>

      {/* ---- bottom card ---- */}
      <div className="absolute inset-x-0 bottom-0 z-[1000] p-3">
        <div className="card rise" style={{ padding: '.85rem' }}>
          <div className="flex items-center gap-3">
            <span className="avatar" style={{ width: '3rem', height: '3rem' }}>
              {animal?.photo_url ? <img src={animal.photo_url} alt="" />
                                 : <IconCow size={22} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="d-md truncate">{animal?.name ?? '…'}</p>
              <p className="t-meta">
                {live
                  ? 'Updating every 5 seconds'
                  : `Live ended · ${last ? ageLabel(last.recorded_at, t) : 'No data'}`}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="tile" style={{ padding: '.6rem .7rem' }}>
              <p className="t-label" style={{ fontSize: '.58rem' }}>Walked</p>
              <p className="d-md tnum mt-0.5">
                {walked >= 1000 ? `${(walked / 1000).toFixed(2)} km` : `${Math.round(walked)} m`}
              </p>
            </div>
            <div className="tile" style={{ padding: '.6rem .7rem' }}>
              <p className="t-label" style={{ fontSize: '.58rem' }}>Points</p>
              <p className="d-md tnum mt-0.5">{trail.length}</p>
            </div>
          </div>

          {live ? (
            <button onClick={() => setLive(false)} className="btn w-full mt-2.5"
                    style={{ background: 'var(--red)', color: '#fff',
                             boxShadow: '0 4px 12px -3px rgba(214,40,40,.4)' }}>
              Stop Live
            </button>
          ) : (
            <button onClick={() => { setLeft(SESSION_S); setLive(true); }}
                    className="btn btn-primary mt-2.5 w-full">
              Start Live Tracking
            </button>
          )}

          <p className="t-meta mt-2 text-center" style={{ fontSize: '.72rem' }}>
            Live tracking uses more collar battery.
          </p>
        </div>
      </div>
    </div>
  );
}
