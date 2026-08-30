/**
 * A cow on the map.
 *
 * A coloured dot is a data point; a pin with an animal in it is *her*. On a
 * satellite photo of a field that difference is the whole readability of the
 * screen — the farmer is looking for his animals, not for markers.
 *
 * Two colours, deliberately:
 *   green — she is inside the grazing area
 *   red   — she is leaving it, or already out
 * Amber was a third state that meant "sort of", and on a 38px pin over a
 * satellite photo nobody could tell it from green at a glance.
 *
 * Built as a Leaflet divIcon rather than an image so it scales crisply,
 * colours itself from the status, and needs no network round trip.
 */

import { Marker } from 'react-leaflet';
import L from 'leaflet';
import { useMemo } from 'react';

import { COW_BODY } from './cowSilhouette.ts';

export type Tone = 'safe' | 'warn' | 'danger';

/**
 * Three distinct intuitive tones:
 *   green  (#43A047) — safe inside the grazing area
 *   amber  (#FB8C00) — keep an eye / approaching fence or road
 *   red    (#E53935) — active danger / outside fence or on road
 */
const FILL: Record<Tone, string> = {
  safe: '#43A047',
  warn: '#FB8C00',
  danger: '#E53935',
};

/**
 * @param stale when we have not heard from her recently the pin goes hollow:
 *              white body, coloured cow, coloured outline. "I do not know
 *              where she is" must never look like "she is fine".
 *
 *              The outline used to be dashed as well. Dashes read as a torn
 *              or provisional edge and made a field of pins look noisy — the
 *              inversion alone already says "stale" loudly, and it says it
 *              from further away.
 */
export function cowIcon(tone: Tone, opts: {
  stale?: boolean; selected?: boolean; label?: string;
} = {}) {
  const { stale = false, selected = false, label } = opts;
  const c = FILL[tone];
  const w = selected ? 46 : 38;
  const h = selected ? 58 : 48;

  const html = `
<div style="position:relative;width:${w}px;height:${h}px;
            filter:drop-shadow(0 3px 5px rgba(12,32,18,.45))">
  <svg width="${w}" height="${h}" viewBox="0 0 38 48" xmlns="http://www.w3.org/2000/svg">
    <path d="M12.5 32.62A16 16 0 1 1 25.5 32.62L19 46.6Z"
          fill="${stale ? '#FFFFFF' : c}"
          stroke="${stale ? c : '#FFFFFF'}"
          stroke-width="2.5" />
    <svg x="7.4" y="7.6" width="23.2" height="23.2" viewBox="0 0 100 100">
      <path d="${COW_BODY}" fill="${stale ? c : '#FFFFFF'}" />
    </svg>
  </svg>
  ${label ? `<span style="position:absolute;left:50%;top:${h - 4}px;transform:translateX(-50%);
       white-space:nowrap;font:700 10px/1.4 Inter,system-ui,sans-serif;
       background:rgba(255,255,255,.94);color:#17301F;padding:1px 6px;border-radius:999px;
       box-shadow:0 1px 3px rgba(12,32,18,.3)">${label}</span>` : ''}
</div>`;

  return L.divIcon({
    html,
    className: 'cow-pin',                 // styling lives inline; kill the default box
    iconSize: [w, h],
    iconAnchor: [w / 2, h],               // tip of the pin sits on the position
    popupAnchor: [0, -h],
  });
}

interface Props {
  position: [number, number];
  tone: Tone;
  stale?: boolean;
  selected?: boolean;
  label?: string;
  onClick?: () => void;
}

export function CowMarker({ position, tone, stale, selected, label, onClick }: Props) {
  // Rebuild only when something visible actually changes — a new divIcon on
  // every render makes the whole herd flicker on each poll.
  const icon = useMemo(
    () => cowIcon(tone, { stale, selected, label }),
    [tone, stale, selected, label],
  );

  return (
    <Marker position={position} icon={icon}
            eventHandlers={onClick ? { click: onClick } : undefined} />
  );
}
