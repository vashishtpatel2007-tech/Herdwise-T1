/**
 * Home — the FARMO dashboard.
 *
 * Laid out to match the reference top to bottom:
 *   1. hamburger · "Good Morning, / Ramesh 👋" · bell with unread badge
 *   2. Farm Health card — ring with "/100", verdict, leaf illustration
 *   3. four stat tiles — Total Animals · Safe · Alerts · Avg. Battery
 *   4. "Live Farm Map" — Live pill, geofence with vertex handles, cow pins,
 *      the road, a warning marker, locate/layers controls, and the alert
 *      strip tucked INSIDE the same card under the map
 *   5. "Today Overview" — Movements · Distance Covered · Alerts Triggered
 *
 * Every number is real. Nothing is placed at an invented position: an animal
 * with no fix is simply not drawn.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, Polygon, CircleMarker, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';

import { useHerd } from '../lib/useHerd.tsx';
import { useAuth } from '../lib/auth.tsx';
import { supabase } from '../lib/supabase.ts';
import { farmHealth, greeting } from '../lib/farm.ts';
import { HealthRing } from '../components/HealthRing.tsx';
import { CowMarker } from '../components/CowMarker.tsx';
import { SideDrawer } from '../components/SideDrawer.tsx';
import {
  BaseLayers, RoadLines, MeMarker, useMyLocation, type RoadFeature,
} from '../components/MapLayers.tsx';
import { toneOf } from './AnimalsScreen.tsx';
import { freshness } from '../lib/format.ts';
import {
  IconBell, IconMenu, IconLocate, IconLayers,
  IconCowSolid, IconShieldSolid, IconWarningSolid, IconBatterySolid,
} from '../components/Icons.tsx';

interface ZoneFeature { id: string; ring: Array<[number, number]> }

/** Upper bound on the scroll distance over which the storm dims. */
const PHOTO_FADE_PX = 460;
/** How much of the backdrop survives at the bottom of the page. */
const PHOTO_FLOOR = 0.55;

export function HomeScreen() {
  const { herd, counts } = useHerd();
  const { farmer } = useAuth();
  const [zones, setZones] = useState<ZoneFeature[]>([]);
  const [roads, setRoads] = useState<RoadFeature[]>([]);
  const [openAlerts, setOpenAlerts] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [satellite, setSatellite] = useState(true);
  const [recentre, setRecentre] = useState(0);
  const me = useMyLocation();
  const [today, setToday] = useState<{
    movements: number; movements_prev: number;
    metres: number; metres_prev: number;
    alerts: number; alerts_prev: number;
  } | null>(null);

  const health = useMemo(() => farmHealth(herd), [herd]);

  /** Mean collar charge across animals that have actually reported one. */
  const avgBattery = useMemo(() => {
    const b = herd.map((m) => m.position?.battery_pct).filter((x): x is number => x != null);
    return b.length ? Math.round(b.reduce((s, x) => s + x, 0) / b.length) : null;
  }, [herd]);

  const withPos = useMemo(() => herd.filter((m) => m.position != null), [herd]);

  const points = useMemo(
    () => withPos.map((m) => [m.position!.lat, m.position!.lon] as [number, number]),
    [withPos],
  );

  /**
   * The fences worth drawing on a 250px card: near this herd, and each shape
   * only once. Two zone rows with byte-identical geometry stacked their
   * outlines and doubled every corner handle.
   */
  const nearZones = useMemo(() => {
    if (points.length === 0) return zones;
    const anchor = points[0];
    const seen = new Set<string>();
    return zones.filter((z) => {
      if (!z.ring.some((p) => metresBetween(anchor, p) <= NEARBY_M)) return false;
      const key = z.ring.map(([a, b]) => `${a.toFixed(6)},${b.toFixed(6)}`).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [zones, points]);

  useEffect(() => {
    void (async () => {
      const [f, a] = await Promise.all([
        supabase.from('farmers').select('id').maybeSingle(),
        supabase.from('alerts').select('id', { count: 'exact', head: true }).is('resolved_at', null),
      ]);
      setOpenAlerts(a.count ?? 0);
      if (!f.data) return;
      const [z, o, r] = await Promise.all([
        supabase.rpc('zones_geojson', { p_farmer_id: f.data.id }),
        supabase.rpc('today_overview', { p_farmer_id: f.data.id }),
        supabase.rpc('roads_near_zones', { p_farmer_id: f.data.id }),
      ]);
      if (Array.isArray(z.data)) setZones(z.data as ZoneFeature[]);
      if (Array.isArray(r.data)) setRoads(r.data as RoadFeature[]);
      if (o.data) setToday(o.data as typeof today);
    })();
  }, []);

  // The bell badge must not need a re-visit to this screen to notice a new
  // alert -- a boundary crossing while the farmer is looking at Home has to
  // show up here live, the same way the map pin already does.
  useEffect(() => {
    const ch = supabase
      .channel('home-alerts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        void supabase.from('alerts').select('id', { count: 'exact', head: true })
          .is('resolved_at', null)
          .then(({ count }) => setOpenAlerts(count ?? 0));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  /** Whoever is in the most trouble right now — drives the strip under the map. */
  const worst = useMemo(() => {
    const rank: Record<string, number> = { critical: 4, high: 3, warning: 2, watch: 1, safe: 0 };
    return [...herd].sort(
      (a, b) => (rank[b.risk?.state ?? 'safe'] ?? 0) - (rank[a.risk?.state ?? 'safe'] ?? 0),
    )[0] ?? null;
  }, [herd]);

  const worstState = worst?.risk?.state ?? 'safe';
  const showStrip = worstState !== 'safe';

  /**
   * The red pin on the road. Placed at the real road vertex nearest the animal
   * in trouble — not at a decorative spot. No trouble, no pin.
   */
  const hazard = useMemo<[number, number] | null>(() => {
    if (!showStrip || !worst?.position || roads.length === 0) return null;
    const { lat, lon } = worst.position;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const r of roads) {
      for (const [x, y] of r.geom.coordinates) {
        const d = (y - lat) ** 2 + ((x - lon) * Math.cos((lat * Math.PI) / 180)) ** 2;
        if (d < bestD) { bestD = d; best = [y, x]; }
      }
    }
    return best;
  }, [showStrip, worst?.position?.lat, worst?.position?.lon, roads]);

  /*
   * The sea-storm backdrop fades out as the dashboard scrolls up over it.
   *
   * The progress is written straight onto the element as a CSS custom
   * property rather than held in React state: this fires on every scroll
   * frame, and re-rendering a screen that owns a Leaflet map sixty times a
   * second is how you get a dashboard that stutters when you flick it.
   */
  const root = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  /*
   * Fade the backdrop over whatever scroll distance this page actually has.
   *
   * A flat 460px was wrong: the dashboard is only about 1040px tall, so on a
   * 812px screen there are ~230px of travel in total and the storm was still
   * at half strength when you hit the bottom — it never finished merging into
   * the page. Content height also changes with the herd and with whether the
   * alert strip is showing, so the distance cannot be a constant. Fade across
   * 80% of the real range, capped so a very long page does not drag it out.
   */
  const applyPhoto = (el: HTMLDivElement | null) => {
    if (!el) return;
    const travel = Math.max(1, el.scrollHeight - el.clientHeight);
    const span = Math.max(140, Math.min(PHOTO_FADE_PX, travel * 0.9));
    /*
     * A MILD fade, not a fade-out.
     *
     * Taking it to zero meant the bottom of the page was flat near-black —
     * the photograph simply ended partway through the scroll. It now settles
     * at PHOTO_FLOOR, so the storm is behind the dashboard the whole way
     * down; scrolling dims it enough to let the lower cards read, and no
     * further.
     */
    const t = Math.min(el.scrollTop / span, 1);
    const p = 1 - (1 - PHOTO_FLOOR) * t;
    root.current?.style.setProperty('--photo', p.toFixed(3));
  };

  /*
   * A NATIVE listener, not React's onScroll.
   *
   * `scroll` does not bubble, and React's delegated handling of it did not
   * fire here at all — the backdrop simply never faded. Attaching to the
   * element directly is also the faster option: it is passive, so it never
   * blocks the scroll, and it mutates one CSS property instead of going
   * through a React render.
   *
   * The same call seeds --photo on mount, which matters after a reload that
   * restores a scroll offset: the property starts at 1, so without this the
   * storm sat at full strength behind content already halfway down the page.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => applyPhoto(el);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const firstName = (farmer?.name ?? '').split(' ')[0] || 'Farmer';

  /*
   * The headline half that actually says something.
   *
   * Ordered by what would make the farmer put the phone down and walk: an
   * animal near a road outranks a flat battery, which outranks silence.
   */
  const staleCount = useMemo(
    () => herd.filter((m) => !m.position || freshness(m.position.recorded_at) === 'stale').length,
    [herd],
  );

  // The mini-map's "Live" pill claimed to be live unconditionally -- it said
  // so even with the exact same stale data that made the headline below say
  // "out of touch". One screen cannot call the same silence both things.
  const mapIsLive = herd.length > 0 && staleCount < herd.length;

  const herdMood = useMemo<{ words: string; tone: 'safe' | 'warn' | 'danger' }>(() => {
    const needsYou = counts.danger;

    if (needsYou > 0) return { words: 'not where it should be', tone: 'danger' };
    if (counts.out > 0) return { words: 'worth a look', tone: 'warn' };
    if (staleCount > 0 && staleCount === herd.length) return { words: 'out of touch', tone: 'warn' };
    if (staleCount > 0) return { words: 'mostly settled', tone: 'warn' };
    if (herd.length === 0) return { words: 'not set up yet', tone: 'warn' };
    return { words: 'all settled', tone: 'safe' };
  }, [herd, counts, staleCount]);

  return (
    /* The drawer is a sibling of the scroller, not a child of it. Nested
       inside, it scrolled up and off the screen with the dashboard. */
    <div ref={root} className="home-photo relative h-full"
         style={{ background: 'var(--bg)' }}>

      {/* The backdrop. Fixed behind the dashboard, fading as it scrolls by. */}
      <div className="home-photo-layer" aria-hidden>
        <img src="/media/sea-storm.jpg" alt="" />
        <span className="home-photo-scrim" />
      </div>

    <div ref={scroller} className="home-photo-scroll h-full overflow-y-auto pb-4">

      {/* ---- 1. header --------------------------------------------------
          Controls first, then the sentence. The greeting is an eyebrow and
          the headline reports the herd's state, so the first thing read on
          opening the app is an answer rather than a label. */}
      <header className="home-head px-5 pt-6 pb-5">
        <div className="flex items-center justify-between">
          <button onClick={() => setDrawer(true)} aria-label="Menu" className="glass-btn">
            <IconMenu size={22} />
          </button>
          <Link to="/alerts" className="glass-btn relative"
                aria-label={`Alerts${openAlerts ? `, ${openAlerts} unread` : ''}`}>
            <IconBell size={21} />
            {openAlerts > 0 && (
              <span aria-hidden className="absolute"
                    style={{ top: 9, right: 9, width: 8, height: 8, borderRadius: 999,
                             background: 'rgb(var(--red-rgb))',
                             boxShadow: '0 0 0 2px rgb(26 22 19 / .9)' }} />
            )}
          </Link>
        </div>

        <p className="home-eyebrow mt-5">{greeting()}</p>
        <h1 className="home-line mt-1.5">
          {firstName}, the herd is{' '}
          <span className="home-state" data-tone={herdMood.tone}>{herdMood.words}</span>
        </h1>
      </header>

      <div className="grid gap-3 px-5">

        {/* ---- 2. farm health ------------------------------------------ */}
        <section className="rise card card-lit relative overflow-hidden">
          <p className="d-sm" style={{ fontSize: '1.05rem', marginBottom: '.5rem' }}>
            Farm Health
          </p>
          <div className="relative flex items-center gap-4" style={{ zIndex: 1 }}>
            <HealthRing score={health.score} tone={health.tone} size={104} showDenominator />
            {/* Right padding keeps the sentence clear of the sprig, and the
                clamp stops a farm with four problems from wrapping four lines
                across it. The full list is on the animals screen. */}
            <div className="min-w-0 flex-1" style={{ paddingRight: '2.4rem' }}>
              <p className={`d-md txt-${health.tone}`} style={{ fontSize: '1.35rem' }}>
                {health.label}
              </p>
              <p className="clamp-2 mt-0.5"
                 style={{ fontSize: '.85rem', color: 'var(--text-dim)', lineHeight: 1.35 }}>
                {health.reasons.length === 0
                  ? 'Your farm is doing great!'
                  : health.reasons.slice(0, 2).join(' · ')}
              </p>
            </div>
          </div>
          <Leaves />
        </section>

        {/* ---- 3. four stat tiles -------------------------------------- */}
        <div className="rise rise-2 grid grid-cols-4 gap-2">
          <StatCard to="/animals" value={herd.length} label="Total Animals"
                    icon={<IconCowSolid size={28} />} color="var(--green-deep)" />
          <StatCard to="/animals" value={counts.safe} label="Safe"
                    icon={<IconShieldSolid size={26} />} color="var(--green-deep)" />
          <StatCard to="/alerts" value={counts.danger + counts.out} label="Alerts"
                    icon={<IconWarningSolid size={26} />}
                    color={counts.danger ? 'var(--red)' : 'var(--amber)'} />
          {/* Battery, not health — the ring directly above already IS the
              health score, and showing it twice wastes the one tile that
              could warn him a collar is about to die. */}
          <StatCard to="/animals"
                    value={avgBattery === null ? '—' : `${avgBattery}%`}
                    label="Avg. Battery"
                    icon={<IconBatterySolid size={28} />}
                    color={avgBattery !== null && avgBattery < 30 ? 'var(--amber)' : 'var(--green)'} />
        </div>

        {/* ---- 4. live farm map ---------------------------------------- */}
        <h2 className="d-sm mt-1" style={{ fontSize: '1.05rem' }}>Live Farm Map</h2>

        <section className="rise rise-3 overflow-hidden"
                 style={{ background: 'var(--card)', borderRadius: 'var(--r)',
                          border: '1px solid var(--line-soft)', boxShadow: 'var(--sh)' }}>
          <div className="relative" style={{ height: 250 }}>
            {/*
              Tap anywhere on the card map to open the full one.
              The mini-map has dragging and zoom disabled so the page can still
              be scrolled past it, which left it looking interactive but doing
              nothing. This overlay gives the whole thing one job instead.
              It sits UNDER the Live pill and the two controls (z-index 500),
              so those keep their own behaviour.
            */}
            {points.length > 0 ? (
              <>
                <MapContainer center={points[0]} zoom={16} zoomControl={false}
                              dragging={false} scrollWheelZoom={false} doubleClickZoom={false}
                              attributionControl={false} touchZoom={false} keyboard={false}
                              style={{ height: '100%', width: '100%' }}>
                  <BaseLayers satellite={satellite} />
                  <FrameHerd points={points} zones={nearZones} roads={roads} nonce={recentre} meAt={me?.at ?? null} />


                  {/* Geofence, with a white handle on every corner so it reads
                      as a boundary he drew rather than a shaded blob. */}
                  {nearZones.map((z) => (
                    <Polygon key={z.id} positions={z.ring}
                      pathOptions={{ color: '#8CD46A', weight: 2.5,
                                     fillColor: '#63B84A', fillOpacity: .38 }} />
                  ))}
                  {nearZones.flatMap((z) => handlesOf(z.ring).map((p, i) => (
                    <CircleMarker key={`${z.id}-${i}`} center={p} radius={5}
                      pathOptions={{ color: '#8CD46A', weight: 2.5,
                                     fillColor: '#FFFFFF', fillOpacity: 1 }} />
                  )))}

                  {/* Roads LAST so they sit on top.
                      SVG paints in document order, and the field polygon is a
                      38%-opaque green wash — drawn over the highway it turned
                      SH-9 from orange into a grey smudge, tinting the one
                      feature on this map that represents danger. */}
                  <RoadLines roads={roads} />

                  {/* Cow pins. No name labels at this size — six of them
                      overlapped into an unreadable pile. Names belong on the
                      full map, where there is room to read them. */}
                  {withPos.map((m) => (
                    <CowMarker
                      key={m.animal.id}
                      position={[m.position!.lat, m.position!.lon]}
                      tone={toneOf(m.risk?.state ?? 'safe', m.risk?.situation) as 'safe' | 'warn' | 'danger'}
                      stale={freshness(m.position!.recorded_at) === 'stale'}
                    />
                  ))}

                  {hazard && <Marker position={hazard} icon={hazardIcon} />}

                  {/* Where he is standing, so he can tell how far he has to walk. */}
                  {me && <MeMarker at={me.at} accuracy={me.accuracy} />}
                </MapContainer>

                <Link to="/map" aria-label="Open the full map"
                      className="absolute inset-0" style={{ zIndex: 450 }} />

                {/* Live pill — only says Live when the herd's position data
                    actually is fresh. Claiming Live over stale data is the
                    exact contradiction the "out of touch" headline exists
                    to warn about. */}
                <span className="absolute flex items-center gap-1.5 px-3"
                      style={{ top: 12, left: 12, zIndex: 500, height: 30, borderRadius: 999,
                               background: mapIsLive ? 'var(--green)' : 'var(--text-faint)',
                               color: '#fff',
                               fontSize: '.78rem', fontWeight: 700,
                               boxShadow: '0 2px 8px rgba(12,32,18,.35)' }}>
                  {mapIsLive && <span className="live-dot" />}
                  {mapIsLive ? 'Live' : 'No signal'}
                </span>

                {/* Locate / layers, stacked as one control.
                    BOTTOM-right, not top-right: the animal in trouble is by
                    definition the one furthest out, so she lands in a corner —
                    and in the top-right corner she sat underneath these two
                    buttons, which is the one pin that must never be hidden. */}
                <div className="absolute overflow-hidden"
                     style={{ bottom: 12, right: 12, zIndex: 500, borderRadius: 14,
                              background: '#fff', boxShadow: '0 2px 10px rgba(12,32,18,.28)' }}>
                  {/* Hardcoded dark ink, not var(--text) -- this pill stays
                      solid white on purpose (a floating control over a photo
                      needs a fixed, reliable background), but var(--text) now
                      means "light cream" everywhere else since the app went
                      dark. Light icon on a white pill was functionally
                      invisible; this button was never broken, just unseeable. */}
                  <button onClick={() => setRecentre((n) => n + 1)} aria-label="Recentre on herd"
                          className="grid place-items-center"
                          style={{ width: 44, height: 44, minHeight: 0, color: '#17301F' }}>
                    <IconLocate size={21} />
                  </button>
                  <span className="block" style={{ height: 1, background: '#E5E9E2' }} />
                  <button onClick={() => setSatellite((s) => !s)}
                          aria-label={satellite ? 'Switch to plain map' : 'Switch to satellite'}
                          aria-pressed={satellite}
                          className="grid place-items-center"
                          style={{ width: 44, height: 44, minHeight: 0, color: '#17301F' }}>
                    <IconLayers size={21} />
                  </button>
                </div>
              </>
            ) : (
              <div className="grid h-full w-full place-items-center"
                   style={{ background: 'var(--card-2)' }}>
                <div className="text-center px-6">
                  <span style={{ color: 'var(--text-faint)' }}><IconCowSolid size={34} /></span>
                  <p className="t-meta mt-2">No collar has reported a position yet</p>
                </div>
              </div>
            )}
          </div>

          {/* Alert strip — inside the map card, under the map. */}
          {showStrip && worst && (
            <Link to={`/animal/${worst.animal.id}`}
                  className="flex items-center gap-3 px-4 py-3.5">
              <span className="shrink-0"
                    style={{ color: worstState === 'critical' || worstState === 'high'
                      ? 'var(--red)' : 'var(--amber)' }}>
                <IconWarningSolid size={30} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="d-sm block" style={{ fontSize: '.95rem', lineHeight: 1.3 }}>
                  {worst.animal.name} {situationLine(worst.risk?.situation)}
                </span>
                <span className="t-meta block mt-0.5">{detailLine(worst)}</span>
              </span>
              <span className="btn btn-primary shrink-0 px-4"
                    style={{ minHeight: 40, borderRadius: 999, fontSize: '.85rem' }}>
                View Now
              </span>
            </Link>
          )}
        </section>

        {/* ---- 5. today overview --------------------------------------- */}
        <h2 className="d-sm mt-1" style={{ fontSize: '1.05rem' }}>Today Overview</h2>
        <div className="rise rise-4 grid grid-cols-3 gap-2.5">
          <TrendCard label="Movements" value={String(today?.movements ?? 0)}
                     now={today?.movements ?? 0} prev={today?.movements_prev ?? 0} />
          <TrendCard label="Distance Covered"
                     value={today ? (today.metres >= 1000
                       ? `${(today.metres / 1000).toFixed(1)} km` : `${today.metres} m`)
                       : '—'}
                     unit={today && today.metres >= 1000 ? 'km' : 'm'}
                     now={today?.metres ?? 0} prev={today?.metres_prev ?? 0} />
          <TrendCard label="Alerts Triggered" value={String(today?.alerts ?? openAlerts)}
                     now={today?.alerts ?? openAlerts} prev={today?.alerts_prev ?? 0}
                     lowerIsBetter />
        </div>
      </div>
    </div>

      <SideDrawer open={drawer} onClose={() => setDrawer(false)} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Map helpers
 * ---------------------------------------------------------------------- */

/** Rough metres between two WGS84 points. Good enough to reject a stray zone. */
function metresBetween(a: [number, number], b: [number, number]) {
  const dLat = (b[0] - a[0]) * 111_320;
  const dLon = (b[1] - a[1]) * 111_320 * Math.cos((a[0] * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Fence vertices further than this from the herd are not this herd's field. */
const NEARBY_M = 4_000;

/**
 * Corner handles to draw on a fence.
 *
 * A boundary walked with a phone, or drawn as a circle, comes back with 30-odd
 * vertices. Putting a handle on every one turned the field into a bead
 * necklace and hid the animals inside it. Ten evenly spaced handles say
 * "this is a shape you drew" just as well.
 */
const MAX_HANDLES = 10;

function handlesOf(ring: Array<[number, number]>) {
  if (ring.length <= MAX_HANDLES) return ring;
  const step = ring.length / MAX_HANDLES;
  return Array.from({ length: MAX_HANDLES }, (_, i) => ring[Math.floor(i * step)]);
}

/**
 * Frame the herd, then widen to include the fence around them.
 *
 * The herd anchors the view — NOT the union of everything on screen. A zone
 * left behind at an old farm 18 km away dragged fitBounds down to zoom 10,
 * which rendered the whole district and not one animal. Zones are only allowed
 * to widen the box if they are actually near the animals.
 *
 * Re-runs when the locate button bumps `nonce`.
 */
function FrameHerd({ points, zones, roads, nonce, meAt }: {
  points: Array<[number, number]>;
  zones: ZoneFeature[];
  roads: RoadFeature[];
  nonce: number;
  meAt?: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0 && !meAt) return;

    const raf = requestAnimationFrame(() => {
      map.invalidateSize({ animate: false });

      const anchor = points[0] ?? meAt!;
      const near = zones
        .flatMap((z) => z.ring)
        .filter((p) => metresBetween(anchor, p) <= NEARBY_M);

      const roadAnchor = nearestRoadPoint(anchor, roads);

      const all = [
        ...points,
        ...near,
        ...(roadAnchor ? [roadAnchor] : []),
        ...(meAt && metresBetween(anchor, meAt) <= NEARBY_M ? [meAt] : []),
      ];
      if (all.length === 1) { map.setView(all[0], 17); return; }

      /*
       * Asymmetric padding. The Live pill sits top-left and the locate/layers
       * stack sits top-right, both floating over the map — a symmetric fit put
       * the animal nearest the road directly underneath the layers button,
       * where the one pin the farmer most needed to see was a sliver of red.
       * paddingTopLeft / paddingBottomRight keep the herd clear of both.
       */
      map.fitBounds(all as [number, number][], {
        paddingTopLeft: [30, 46],      // clears the Live pill
        paddingBottomRight: [62, 62],  // clears the locate/layers stack
        maxZoom: 17,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [map, nonce, points.length, zones.length, roads.length]);
  return null;
}

/**
 * Closest point on a highway (NH/SH — base_risk 4 or 5) to the herd.
 *
 * Minor roads are excluded on purpose: a farm track running through the field
 * would always be the nearest "road" and would pin the view to it, hiding the
 * highway that is the actual danger.
 */
function nearestRoadPoint(
  from: [number, number],
  roads: RoadFeature[],
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const r of roads) {
    if (r.base_risk < 4) continue;
    for (const [x, y] of r.geom.coordinates) {
      const d = metresBetween(from, [y, x]);
      if (d < bestD) { bestD = d; best = [y, x]; }
    }
  }
  // Same rule as nearZones just above: `roads` comes from roads_near_zones,
  // scoped to the CONFIGURED fence's location, not to wherever the herd
  // actually is right now. The two normally coincide -- until a collar is
  // bench-tested miles from the real farm, at which point the "nearest" road
  // on file is still ~18 km off. Folding that point into fitBounds forced the
  // whole card out to zoom 10 to fit both her and a road she isn't near.
  if (best && metresBetween(from, best) > NEARBY_M) return null;
  return best;
}

/** The red hazard marker sitting on the road. */
const hazardIcon = L.divIcon({
  className: 'cow-pin',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
  html: `
<div style="width:34px;height:34px;border-radius:11px;background:#E23B3B;
            display:grid;place-items:center;border:2px solid #fff;
            box-shadow:0 2px 7px rgba(12,32,18,.45)">
  <svg width="19" height="19" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
    <path d="M13.1 3.4a1.3 1.3 0 0 0-2.2 0L1.7 19.2a1.3 1.3 0 0 0 1.1 1.9h18.4a1.3 1.3 0 0 0 1.1-1.9L13.1 3.4Z"/>
    <path d="M11.1 8.6h1.8v5.2h-1.8V8.6Zm0 6.7h1.8v1.9h-1.8v-1.9Z" fill="#E23B3B"/>
  </svg>
</div>`,
});

/* -------------------------------------------------------------------------
 * Copy
 * ---------------------------------------------------------------------- */

function situationLine(situation?: string) {
  switch (situation) {
    case 'on_road':
    case 'stationary_on_road': return 'is standing on the road';
    case 'outside_zone':       return 'is leaving the grazing area';
    case 'device_fault':       return 'has a collar problem';
    case 'fall':               return 'may have fallen';
    default:                   return 'is heading toward a road';
  }
}

function detailLine(m: { risk: { road_risk: number; p_reaches_road_5min: number | null } | null }) {
  const p = m.risk?.p_reaches_road_5min;
  if (p != null) return `${Math.round(p * 100)}% chance of reaching the road`;
  return 'Tap to see where she is';
}

/* -------------------------------------------------------------------------
 * Tiles
 * ---------------------------------------------------------------------- */

function StatCard({ to, value, label, icon, color }: {
  to: string; value: number | string; label: string;
  icon: React.ReactNode; color: string;
}) {
  return (
    <Link to={to} className="stat-card">
      <span className="stat-icon" style={{ color }}>{icon}</span>
      <span className="stat-value tnum">{value}</span>
      <span className="stat-label">{label}</span>
    </Link>
  );
}

function TrendCard({ label, value, unit, now, prev, lowerIsBetter }: {
  label: string; value: string; unit?: string;
  now: number; prev: number; lowerIsBetter?: boolean;
}) {
  const delta = prev === 0 ? (now === 0 ? 0 : 100) : Math.round(((now - prev) / prev) * 100);
  const good = lowerIsBetter ? delta <= 0 : delta >= 0;
  const flat = delta === 0 || prev === 0;
  const num = unit ? value.replace(` ${unit}`, '') : value;

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--line-soft)',
                  borderRadius: 'var(--r-sm)', boxShadow: 'var(--sh)',
                  padding: '.75rem .7rem' }}>
      <p style={{ fontSize: '.7rem', color: 'var(--text-dim)', fontWeight: 600,
                  lineHeight: 1.25 }}>
        {label}
      </p>
      <p className="d-md tnum mt-1" style={{ fontSize: '1.35rem', lineHeight: 1.1 }}>
        {num}
        {unit && <span style={{ fontSize: '.8rem', fontWeight: 700,
                                color: 'var(--text-dim)' }}> {unit}</span>}
      </p>
      <p className="tnum mt-1.5" style={{
        fontSize: '.72rem', fontWeight: 700,
        color: flat ? 'var(--text-faint)' : good ? 'var(--green)' : 'var(--red)',
      }}>
        {flat ? '—' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}%`}
      </p>
    </div>
  );
}

/**
 * The leaf sprig and rolling hills in the bottom-right of the health card.
 * Purely decorative, so it is aria-hidden and sits behind the content — it
 * must never push the score or the verdict around.
 */
function Leaves() {
  return (
    <svg aria-hidden viewBox="0 0 160 104" className="home-leaves pointer-events-none absolute"
         style={{ right: 0, bottom: 0, width: 146, height: 95, zIndex: 0 }}>
      {/* Rolling ground along the bottom edge, under the text baseline. */}
      <path d="M0 74c22-3 34-16 56-16s31 12 53 9 38-14 61-10v47H0V74Z"
            fill="var(--green-soft)" opacity=".95" />
      <path d="M18 92c20-8 32-14 53-14s34 8 55 5 29-8 39-6v27H18v-12Z"
            fill="var(--green-glow)" opacity=".5" />
      {/* Sprig, tucked into the corner so it grows out of the hills rather
          than across the sentence to its left. */}
      <g transform="translate(86 14) scale(.86)" fill="none" stroke="var(--green)"
         strokeWidth="2.6" strokeLinecap="round">
        <path d="M62 2C46 18 34 40 28 66" />
        <path d="M62 2c-14-1-25 6-27 18 12 4 23-5 27-18Z"
              fill="var(--green-glow)" opacity=".9" />
        <path d="M45 26c-12-5-23-2-28 8 10 7 23 3 28-8Z"
              fill="var(--green)" opacity=".75" />
        <path d="M35 46c-11-6-23-4-29 6 9 8 23 5 29-6Z"
              fill="var(--green-glow)" opacity=".9" />
      </g>
    </svg>
  );
}
