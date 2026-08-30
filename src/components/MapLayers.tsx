/**
 * Shared map furniture: base tiles, road lines, place names, and "you".
 *
 * Every map in the app draws the same world, so it draws it from here. When
 * the home card and the full map each rolled their own tile layers they
 * drifted apart — one showed roads, the other did not, and neither showed the
 * farmer where he was standing.
 *
 * Nothing here invents geography. Roads come from OpenStreetMap via the
 * road_segments import; if that table is empty, no road is drawn rather than a
 * decorative one being faked.
 */

import { useEffect, useMemo, useState } from 'react';
import { TileLayer, Polyline, Tooltip, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';

export const ESRI_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
export const ESRI_ATTR = 'Imagery &copy; Esri, Maxar, Earthstar Geographics';

/**
 * Esri's reference layers — transparent PNGs of road and place labels that sit
 * on top of the imagery. Satellite photography has no words on it, so without
 * these the farmer cannot tell which grey line is the highway or which cluster
 * of roofs is his village.
 */
export const ESRI_TRANSPORT =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
export const ESRI_PLACES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTR = '&copy; OpenStreetMap contributors';

export interface RoadFeature {
  id: number;
  name: string | null;
  base_risk: number;
  highway_class?: string | null;
  geom: { coordinates: number[][] };
}

/**
 * Base imagery plus name labels.
 *
 * @param labels off for the plain OSM basemap, which already has its names
 *               baked into the tiles — stacking Esri's labels on top of them
 *               produced every road name twice.
 */
export function BaseLayers({ satellite }: { satellite: boolean }) {
  if (!satellite) {
    return <TileLayer url={OSM} attribution={OSM_ATTR} maxZoom={19} maxNativeZoom={18} />;
  }
  return (
    <>
      <TileLayer url={ESRI_IMAGERY} attribution={ESRI_ATTR} maxZoom={19} maxNativeZoom={17} />
      <TileLayer url={ESRI_TRANSPORT} maxZoom={19} maxNativeZoom={17} />
      <TileLayer url={ESRI_PLACES} maxZoom={19} maxNativeZoom={17} />
    </>
  );
}

/**
 * Colour and weight by OSM class -- deliberately a THREE-tier system, not a
 * gradient, because only two classes carry real danger for a walking animal:
 *
 *   NH / expressway (base_risk 5) -- deep red, the heaviest line on the map
 *   SH (base_risk 4)              -- the same red family, visibly lighter,
 *                                    so it still reads as "a highway" at a
 *                                    glance without competing with an NH
 *   everything else                -- left alone. A farm track or a minor
 *                                    connecting road is not a hazard, and
 *                                    painting it the same danger colour as a
 *                                    national highway would teach the farmer
 *                                    to ignore the colour entirely.
 */
function styleFor(risk: number) {
  if (risk >= 5) return { color: '#D91E1E', weight: 6, label: '#B91010' };   // NH / expressway
  if (risk >= 4) return { color: '#EF8F8A', weight: 5, label: '#C24E11' };   // SH -- lighter red, not orange
  return { color: '#9AA5AE', weight: 2, label: '#5B6570' };                  // ordinary road, unhighlighted
}

/**
 * Road lines with one name label each.
 *
 * OSM splits a highway into many ways — NH-648 came back as eighteen separate
 * segments — so labelling every feature stamped the same name eighteen times
 * down the same road. Each NAME is labelled once, on its longest segment.
 */
export function RoadLines({ roads, labels = true }: { roads: RoadFeature[]; labels?: boolean }) {
  return (
    <>
      {roads.map((r) => {
        const s = styleFor(r.base_risk);
        const pts = r.geom.coordinates.map(([x, y]) => [y, x] as [number, number]);
        return (
          <Polyline key={r.id} positions={pts}
                    pathOptions={{ color: s.color, weight: s.weight, opacity: .9 }} />
        );
      })}

      {labels && <RoadLabels roads={roads} />}
    </>
  );
}

/**
 * One name per road, placed where it can actually be read.
 *
 * Two earlier attempts failed here. A react-leaflet <Tooltip> inside a path
 * binds to that path and ignores a `position` prop, so it only appeared on
 * hover at the cursor — which on a phone means never. Anchoring a marker at
 * the midpoint of the longest segment then put "SH-9" a kilometre up the road,
 * outside a 250px card that was showing the highway perfectly well.
 *
 * So the label follows the view: for each name, the vertex nearest the centre
 * of the current viewport wins, and a name with nothing on screen is not drawn
 * at all.
 */
function RoadLabels({ roads }: { roads: RoadFeature[] }) {
  const map = useMap();
  const [, bump] = useState(0);

  useEffect(() => {
    const onMove = () => bump((n) => n + 1);
    map.on('moveend zoomend', onMove);
    return () => { map.off('moveend zoomend', onMove); };
  }, [map]);

  const anchors = useMemo(() => {
    const bounds = map.getBounds();
    const centre = bounds.getCenter();
    const best = new Map<string, { at: [number, number]; d: number }>();

    for (const r of roads) {
      if (!r.name) continue;
      for (const [x, y] of r.geom.coordinates) {
        if (!bounds.contains([y, x])) continue;          // off screen: ignore
        const d = Math.hypot(y - centre.lat, x - centre.lng);
        const cur = best.get(r.name);
        if (!cur || d < cur.d) best.set(r.name, { at: [y, x], d });
      }
    }
    return [...best.entries()];
    // Recomputed on every pan/zoom via the bump above.
  }, [roads, map, bump]);

  return (
    <>
      {anchors.map(([name, { at }]) => (
        <Marker key={`label-${name}`} position={at}
                icon={roadLabelIcon(name)} interactive={false} zIndexOffset={400} />
      ))}
    </>
  );
}

/** A road name drawn straight onto the imagery, sized to stay legible at 250px. */
function roadLabelIcon(name: string) {
  return L.divIcon({
    className: 'road-label-icon',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    html: `<span class="road-label-text">${name}</span>`,
  });
}

/** Where the farmer is standing. Blue, because it is not an animal. */
const meIcon = L.divIcon({
  className: 'cow-pin',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div style="width:18px;height:18px;border-radius:999px;background:#2F7FE4;
                     border:3px solid #fff;box-shadow:0 1px 5px rgba(12,32,18,.5)"></div>`,
});

/**
 * The farmer's own position, with its accuracy ring.
 *
 * Drawing the dot without the ring would claim a precision the phone does not
 * have — the same rule the animal pins follow.
 */
export function MeMarker({ at, accuracy }: { at: [number, number]; accuracy?: number | null }) {
  return (
    <>
      {accuracy != null && accuracy > 12 && (
        <Circle center={at} radius={accuracy}
                pathOptions={{ color: '#2F7FE4', weight: 1, opacity: .5,
                               fillColor: '#2F7FE4', fillOpacity: .12 }} />
      )}
      <Marker position={at} icon={meIcon} zIndexOffset={500}>
        <Tooltip direction="top" offset={[0, -10]}>You are here</Tooltip>
      </Marker>
    </>
  );
}

/**
 * Watch the device position.
 *
 * Returns null until a fix arrives — never a guessed location. A denied or
 * failed lookup simply means no "you" marker, which is honest; putting the
 * farmer at the centre of his own field because we could not locate him would
 * be the same lie as putting a cow there.
 */
export function useMyLocation() {
  const [me, setMe] = useState<{ at: [number, number]; accuracy: number } | null>(null);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setMe({
        at: [p.coords.latitude, p.coords.longitude],
        accuracy: p.coords.accuracy,
      }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return me;
}
