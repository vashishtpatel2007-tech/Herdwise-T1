/**
 * Fields — draw a grazing area, and see what it actually gives the herd.
 *
 * Two ways to draw, because a farmer's relationship to his own land is not
 * a map-reading exercise:
 *   Corners — tap each corner, undo the last
 *   Walk    — hold the phone and walk the edge; the boundary draws itself
 *
 * Circle mode was removed: a radius around a tap is a guess about land the
 * farmer already knows the real shape of, and it produced 40-vertex rings
 * that no collar can hold.
 *
 * Walk mode is the one that matters. It removes map literacy from the most
 * important setup step, and it produces a boundary that is correct rather
 * than guessed at on a satellite photo.
 *
 * The numbers underneath answer the question drawing a shape raises: is this
 * enough ground for the animals I have?
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMapEvents } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { ZoneSchedules } from '../components/ZoneSchedules.tsx';
import { haversine } from '../engine/geo.ts';
import { useHerd } from '../lib/useHerd.tsx';
import { CowMarker } from '../components/CowMarker.tsx';
import { freshness } from '../lib/format.ts';
import { toneOf } from './AnimalsScreen.tsx';
import { IconUndo, IconRedo, IconWalk, IconPlus } from '../components/Icons.tsx';
import { MeMarker, useMyLocation } from '../components/MapLayers.tsx';

type Mode = 'polygon' | 'walk';

const ESRI =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

const CLOSE_WITHIN_M = 20;
const DEFAULT_BUFFER_M = 30;
const M2_PER_ACRE = 4046.86;
const R_EARTH = 6_371_008.8;

/** Shoelace area of a lat/lon ring, in square metres. */
function ringAreaM2(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const latRef = (ring.reduce((s, p) => s + p[0], 0) / ring.length) * (Math.PI / 180);
  const xy = ring.map(([lat, lon]) => [
    (lon * Math.PI / 180) * Math.cos(latRef) * R_EARTH,
    (lat * Math.PI / 180) * R_EARTH,
  ]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2);
}

function Clicks({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export function FieldsScreen() {
  const { t } = useTranslation();
  const { herd } = useHerd();
  const me = useMyLocation();
  const [mode, setMode] = useState<Mode>('polygon');
  const [tab, setTab] = useState<'draw' | 'hours'>('draw');
  const [centre, setCentre] = useState<[number, number] | null>(null);
    const [corners, setCorners] = useState<Array<[number, number]>>([]);
  const [redoStack, setRedoStack] = useState<Array<[number, number]>>([]);
  const [track, setTrack] = useState<Array<[number, number]>>([]);
  const [walking, setWalking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (me) {
      setCentre(me.at);
    } else {
      const fallback: [number, number] = herd.find(m => m.position)?.position 
        ? [herd.find(m => m.position)!.position!.lat, herd.find(m => m.position)!.position!.lon]
        : [13.0827, 77.5877];

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => setCentre([p.coords.latitude, p.coords.longitude]),
          () => setCentre(fallback),
          { timeout: 5000 }
        );
      } else {
        setCentre(fallback);
      }
    }
  }, [me, herd]);

  // ---- walk mode ---------------------------------------------------------
  useEffect(() => {
    if (!walking) {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      return;
    }
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pt: [number, number] = [p.coords.latitude, p.coords.longitude];
        setTrack((prev) => {
          const last = prev[prev.length - 1];
          // Drop jitter: only record real movement.
          if (last && haversine(last[0], last[1], pt[0], pt[1]) < 4) return prev;
          const next = [...prev, pt];
          // Auto-close when he walks back to where he started.
          if (next.length > 12 && haversine(next[0][0], next[0][1], pt[0], pt[1]) < CLOSE_WITHIN_M) {
            setWalking(false);
          }
          return next;
        });
      },
      () => setWalking(false),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10_000 },
    );
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
  }, [walking]);

  const walkedM = useMemo(
    () => track.reduce((s, p, i) => i === 0 ? 0 : s + haversine(track[i-1][0], track[i-1][1], p[0], p[1]), 0),
    [track],
  );

  const ring = useMemo<Array<[number, number]>>(() => {
    if (mode === 'polygon') {
      if (corners.length < 3) return corners;
      let cx = 0, cy = 0;
      for (const [lat, lon] of corners) { cx += lat; cy += lon; }
      cx /= corners.length;
      cy /= corners.length;
      return [...corners].sort((a, b) => {
        return Math.atan2(b[1] - cy, b[0] - cx) - Math.atan2(a[1] - cy, a[0] - cx);
      });
    }
    if (mode === 'walk') return track;
    return [];
  }, [mode, corners, track]);

  const areaM2 = useMemo(() => ringAreaM2(ring), [ring]);
  const acres = areaM2 / M2_PER_ACRE;
  const nAnimals = Math.max(1, herd.length);
  const perAnimal = areaM2 / nAnimals;

  async function save() {
    if (ring.length < 3) return;
    setSaving(true);
    try {
      const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
      if (!farmer) { setSaved('Sign in first — no farm profile found.'); return; }
      
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % ring.length];
        sum += (p2[1] - p1[1]) * (p2[0] + p1[0]);
      }
      const isCw = sum > 0;
      let finalRing = [...ring];
      if (isCw) finalRing.reverse();

      const closed = [...finalRing, finalRing[0]];
      const wkt = `SRID=4326;POLYGON((${closed.map(([la, lo]) => `${lo} ${la}`).join(',')}))`;
      const { error } = await supabase.from('grazing_zones').insert({
        farmer_id: farmer.id, name: fieldName.trim() || 'Grazing area', boundary: wkt,
        buffer_m: DEFAULT_BUFFER_M, drawn_by: mode,
      });

      // Push active geofence to physical collars over GSM downlink
      if (!error) {
        const { data: devices } = await supabase.from('devices')
          .select('id, animal_id, animals!inner(farmer_id)')
          .eq('animals.farmer_id', farmer.id);
        
        if (devices && devices.length > 0) {
          // Downsample the ring to a maximum of 8 points for the ESP32 collar
          const maxPoints = 8;
          let simplifiedRing = [...finalRing];
          if (simplifiedRing.length > maxPoints) {
            const step = simplifiedRing.length / maxPoints;
            const newRing = [];
            for (let i = 0; i < maxPoints; i++) {
              newRing.push(simplifiedRing[Math.floor(i * step)]);
            }
            simplifiedRing = newRing;
          }

          for (const d of devices) {
            await supabase.from('device_commands').insert({
              device_id: d.id,
              command: 'set_boundary',
              payload: { points: simplifiedRing },
              issued_by: farmer.id,
            });
          }
        }
        setSaved('GPS coordinates sent to collars. Geofencing is ON.');
      } else {
        setSaved(error.message);
      }
      if (!error) { setCorners([]); setTrack([]); }
    } finally { setSaving(false); }
  }

  function undo() {
    if (mode !== 'polygon' || corners.length === 0) return;
    setRedoStack((r) => [...r, corners[corners.length - 1]]);
    setCorners((c) => c.slice(0, -1));
  }
  function redo() {
    if (mode !== 'polygon' || redoStack.length === 0) return;
    setCorners((c) => [...c, redoStack[redoStack.length - 1]]);
    setRedoStack((r) => r.slice(0, -1));
  }

  return (
    <div className="relative h-full">
      {centre && (
        <MapContainer center={centre} zoom={17} zoomControl={false} className="absolute inset-0">
          <TileLayer url={ESRI} attribution={ESRI_ATTR} maxZoom={19} maxNativeZoom={17} />
          {tab === 'draw' && mode === 'polygon' &&
            <Clicks onClick={(lat, lon) => { setCorners((c) => [...c, [lat, lon]]); setRedoStack([]); }} />}


          {mode === 'polygon' && corners.length > 2 && (
            <Polygon positions={ring}
                     pathOptions={{ color: '#43A047', weight: 3, fillOpacity: .16 }} />
          )}
          {mode === 'polygon' && corners.map((c, i) => (
            <CircleMarker key={i} center={c} radius={8}
              pathOptions={{ color: '#FFFFFF', weight: 3, fillColor: '#43A047', fillOpacity: 1 }} />
          ))}
          {mode === 'walk' && track.length > 1 && (
            <Polyline positions={track} pathOptions={{ color: '#43A047', weight: 5 }} />
          )}

          {/* Every animal with a real fix, so the fence gets drawn around
              where she actually is -- not guessed at on a satellite photo. */}
          {herd.filter((m) => m.position).map((m) => (
            <CowMarker
              key={m.animal.id}
              position={[m.position!.lat, m.position!.lon]}
              tone={toneOf(m.risk?.state ?? 'safe', m.risk?.situation) as 'safe' | 'warn' | 'danger'}
              stale={freshness(m.position!.recorded_at) === 'stale'}
              label={m.animal.name}
            />
          ))}

          {/* Where the farmer is standing (Live Blue Dot + Accuracy ring) */}
          {me && <MeMarker at={me.at} accuracy={me.accuracy} />}
        </MapContainer>
      )}

      {/* Live area badge, over the shape it measures. */}
      {tab === 'draw' && ring.length > 2 && (
        <div className="pointer-events-none absolute left-0 right-0 z-[1000] flex justify-center"
             style={{ top: '4.6rem' }}>
          <span className="tnum px-3.5"
                style={{ minHeight: 34, display: 'grid', placeItems: 'center',
                         borderRadius: 999, background: 'var(--green)', color: '#fff',
                         fontWeight: 800, fontSize: '.82rem',
                         boxShadow: '0 4px 14px -4px rgba(67,160,71,.6)' }}>
            Area: {acres < 10 ? acres.toFixed(2) : acres.toFixed(1)} acres
          </span>
        </div>
      )}

      {/* Draw / Hours */}
      <div className="absolute left-3 right-3 top-3 z-[1000] flex gap-2">
        {(['draw', 'hours'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k}
            className="flex-1 rounded-full px-3"
            style={{
              minHeight: 44, fontSize: '.86rem', fontWeight: 800,
              background: tab === k ? 'var(--text)' : 'rgba(251,249,244,.94)',
              color: tab === k ? 'var(--bg)' : 'var(--text)',
              border: '1.5px solid ' + (tab === k ? 'var(--text)' : 'var(--line)'),
              boxShadow: '0 1px 4px rgba(14,31,22,.14)',
            }}>
            {k === 'draw' ? 'Draw a field' : 'Grazing hours'}
          </button>
        ))}
      </div>

      {tab === 'hours' ? (
        <div className="absolute inset-x-0 bottom-0 top-[4.5rem] z-[1000] overflow-y-auto p-3"
             style={{ background: 'var(--bg)' }}>
          <ZoneSchedules />
        </div>
      ) : (
        <>
          {/* Tools and the readout share one bottom-anchored stack, so the
              tools sit ABOVE the card whatever height the card grows to.
              Absolutely positioning them at a fixed offset hid them behind it. */}
          <div className="absolute bottom-0 left-0 right-0 z-[1000] flex flex-col gap-2.5 p-3">
            <div className="flex items-center justify-center gap-2.5">
              <Tool label="Undo" onClick={undo} disabled={mode !== 'polygon' || !corners.length}>
                <IconUndo size={21} />
              </Tool>
              <Tool label="Redo" onClick={redo} disabled={mode !== 'polygon' || !redoStack.length}>
                <IconRedo size={21} />
              </Tool>
              <Tool label={walking ? 'Stop walking' : 'Walk the edge'} big
                    active={walking}
                    onClick={() => { setMode('walk'); setWalking((w) => { if (!w) setTrack([]); return !w; }); }}>
                {walking ? <IconPlus size={24} /> : <IconWalk size={24} />}
              </Tool>
              <Tool label="Corners" active={mode === 'polygon'} onClick={() => setMode('polygon')}>
                <IconPlus size={21} />
              </Tool>
            </div>

            {/* What the shape actually gives the herd. */}
            <div className="card" style={{ padding: '0.9rem' }}>

              {mode === 'walk' && walking && (
                <p className="t-body mb-2" style={{ fontWeight: 700 }}>
                  {t('zone.distance_walked', { n: Math.round(walkedM) })} · walk back to the start to finish
                </p>
              )}

              <div className="flex gap-2" >
                <Stat label="Area" value={acres < 10 ? acres.toFixed(2) : acres.toFixed(1)} unit="acres" />
                {/* Dividing by an empty herd produced a confident, meaningless
                    number. With no animals there is no answer, so say so. */}
                <Stat
                  label="Per animal"
                  value={herd.length > 0 ? Math.round(perAnimal).toLocaleString() : '—'}
                  unit={herd.length > 0 ? 'm² each' : 'no animals yet'}
                />
                <Stat label="Herd" value={String(herd.length)} unit="animals" />
              </div>

              {saved && <p className="t-meta mt-2.5">{saved}</p>}

              <label className="mt-2.5 block">
                <span className="t-label">Save area as</span>
                <input value={fieldName} onChange={(e) => setFieldName(e.target.value)}
                       placeholder="Field 1"
                       className="mt-1 w-full px-3.5"
                       style={{ minHeight: 46, borderRadius: 12, fontSize: '.95rem',
                                background: 'var(--card-2)', border: '1px solid var(--line)',
                                color: 'var(--text)' }} />
              </label>

              <button onClick={() => void save()} disabled={ring.length < 3 || saving}
                      className="btn btn-primary mt-2.5 w-full"
                      style={{ opacity: ring.length < 3 || saving ? .4 : 1 }}>
                {saving ? 'Saving…' : t('zone.save')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Tool({ children, label, onClick, disabled, active, big }: {
  children: React.ReactNode; label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; big?: boolean;
}) {
  const s = big ? 60 : 48;
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className="grid place-items-center rounded-full"
      style={{
        width: s, height: s, minWidth: s, minHeight: s,
        background: active ? 'var(--green)' : 'var(--card)',
        color: 'var(--text)',
        border: '1.5px solid ' + (active ? 'var(--green-deep)' : 'var(--line)'),
        boxShadow: '0 2px 8px rgba(14,31,22,.2)',
        opacity: disabled ? .35 : 1,
      }}>
      {children}
    </button>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex-1 rounded-2xl px-3 py-2" style={{ background: 'var(--card-2)', minWidth: 0 }}>
      <p className="t-label" style={{ fontSize: '.62rem' }}>{label}</p>
      <p className="tnum" style={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</p>
      <p className="t-meta" style={{ fontSize: '.7rem' }}>{unit}</p>
    </div>
  );
}
