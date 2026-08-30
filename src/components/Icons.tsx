/**
 * FARMO Icons — consistent leaf/nature themed icon set.
 *
 * All icons use the same 24×24 grid with 1.9px strokes for consistency.
 * The leaf motif ties into the FARMO branding throughout the app.
 */

import { COW_BODY, COW_OUTLINE } from './cowSilhouette.ts';

type P = { className?: string; size?: number };

const base = (size = 24) => ({
  width: size, height: size, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/** FARMO leaf logo — the brand mark. */
export const IconLeaf = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M17 8C8 10 5.9 16.17 3.82 21.34" />
    <path d="M17 8A5 5 0 0 1 21 3c-1 4-3.5 8-9 11.5" />
    <path d="M17 8c-4 1-7 4-8.5 7.5" />
  </svg>
);

/** Home — house with chimney. */
export const IconHome = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3.5 10.5 12 3.5l8.5 7" />
    <path d="M5.5 9.5V20h13V9.5" />
    <path d="M9.75 20v-5.5h4.5V20" />
  </svg>
);

/** A cow's head — the primary animal icon. */
export const IconCow = ({ size }: P) => (
  <svg {...base(size)} viewBox="0 0 100 100" strokeWidth={6.5}>
    <path d={COW_OUTLINE} />
  </svg>
);
export const IconMapTab = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M9 4.5 3.5 6.8v12.7L9 17.2l6 2.3 5.5-2.3V4.5L15 6.8 9 4.5Z" />
    <path d="M9 4.5v12.7M15 6.8v12.7" />
  </svg>
);

/** Bell for alerts/notifications. */
export const IconBell = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.4 5.4 1.4 5.4H4.6S6 13 6 9Z" />
    <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
  </svg>
);

/** Profile / user. */
export const IconProfile = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c.8-3.9 3.6-6 7.5-6s6.7 2.1 7.5 6" />
  </svg>
);

/** Herd — grouped animals. */
export const IconHerd = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="7" cy="9" r="2.6" /><circle cx="16.5" cy="7.5" r="2.2" />
    <path d="M2.5 19c.6-3 2.3-4.6 4.5-4.6S11 16 11.6 19" />
    <path d="M13.5 17.6c.5-2.4 1.8-3.7 3.4-3.7 1.7 0 3 1.4 3.5 3.9" />
  </svg>
);

/** Insights — trend line. */
export const IconInsights = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 20V4" /><path d="M3 20h18" />
    <path d="M6.5 15.5l4-4.5 3.5 3 5-6.5" />
    <circle cx="19" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Live pin — a position fix. */
export const IconLive = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.4" fill="currentColor" stroke="none" />
  </svg>
);

/** Fields — bounded plot. */
export const IconFields = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 6.5 12 3.5l7.5 3v11L12 20.5l-7.5-3v-11Z" />
    <path d="M12 3.5v17" strokeDasharray="2 2.5" />
  </svg>
);

export const IconRoad = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M7.5 3 5 21M16.5 3 19 21" />
    <path d="M12 4v3M12 10.5v3M12 17v3" />
  </svg>
);

export const IconCollar = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="7" y="3.5" width="10" height="14" rx="4" />
    <circle cx="12" cy="8" r="1.9" fill="currentColor" stroke="none" />
    <path d="M9.5 20.5h5" />
  </svg>
);

export const IconUndo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4 9h9a5 5 0 0 1 0 10h-3" /><path d="M7.5 5.5 4 9l3.5 3.5" />
  </svg>
);

export const IconRedo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M20 9h-9a5 5 0 0 0 0 10h3" /><path d="M16.5 5.5 20 9l-3.5 3.5" />
  </svg>
);

export const IconLayers = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5Z" />
    <path d="M3.5 13 12 17.5 20.5 13" />
  </svg>
);

export const IconWalk = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="13" cy="4.2" r="1.8" fill="currentColor" stroke="none" />
    <path d="M11 21l1.6-5.4-2.1-2.2.8-4.4L14 8l2.4 2.6 2.6.9" />
    <path d="M10.3 9.4 7 11.2 5.5 15" />
  </svg>
);

export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);

export const IconChevron = ({ size }: P) => (
  <svg {...base(size)}><path d="m9 5 7 7-7 7" /></svg>
);

export const IconMore = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSun = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6" />
  </svg>
);

export const IconDrop = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3.5s5.5 6 5.5 9.5a5.5 5.5 0 1 1-11 0C6.5 9.5 12 3.5 12 3.5Z" />
  </svg>
);

export const IconPin = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSearch = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconBattery = ({ size }: P) => (
  <svg {...base(size)}>
    <rect x="2.5" y="8" width="16" height="8" rx="2.4" />
    <path d="M21 11v2" />
  </svg>
);

export const IconSpeed = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 16a8 8 0 1 1 15 0" />
    <path d="m12 12.5 3.6-3.2" />
  </svg>
);

export const IconLogout = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14.5 4.5H6.5v15h8" />
    <path d="M11 12h9.5M17.5 8.5 21 12l-3.5 3.5" />
  </svg>
);

export const IconShield = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3 5 5.8v5.4c0 4.3 2.9 7.9 7 9.8 4.1-1.9 7-5.5 7-9.8V5.8L12 3Z" />
  </svg>
);

/** Heart — for healthy animals count. */
export const IconHeart = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 20s-7-4.5-7-9.5c0-2.5 2-4.5 4-4.5 1.5 0 2.5.8 3 2 .5-1.2 1.5-2 3-2 2 0 4 2 4 4.5 0 5-7 9.5-7 9.5Z" />
  </svg>
);

/** Warning triangle. */
export const IconWarning = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none" />
  </svg>
);

/** Settings gear. */
export const IconSettings = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
  </svg>
);

/** Thermometer. */
export const IconThermo = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M14 14.76V3.5a2 2 0 0 0-4 0v11.26a4.5 4.5 0 1 0 4 0Z" />
  </svg>
);

/** Farm barn. */
export const IconFarm = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M9 21v-6h6v6" />
    <path d="M12 4v-1" />
  </svg>
);

/** Notification bell with dot. */
export const IconNotification = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.4 5.4 1.4 5.4H4.6S6 13 6 9Z" />
    <path d="M10 18.5a2.2 2.2 0 0 0 4 0" />
    <circle cx="18" cy="4" r="2.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Check / tick mark. */
export const IconCheck = ({ size }: P) => (
  <svg {...base(size)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth="2.5" />
  </svg>
);

/** Distance / route. */
export const IconRoute = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M18 7v4c0 3.3-2.7 6-6 6H6" />
  </svg>
);

/* ---------------------------------------------------------------------------
 * Header + map controls.
 * ------------------------------------------------------------------------ */

/** Hamburger — opens the side drawer. */
export const IconMenu = ({ size }: P) => (
  <svg {...base(size)} strokeWidth={2.2}>
    <path d="M3.5 7h17" />
    <path d="M3.5 12h17" />
    <path d="M3.5 17h11" />
  </svg>
);

/** Crosshair — recentre the map on the herd. */
export const IconLocate = ({ size }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="6.2" />
    <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    <path d="M12 2.4v2.6M12 19v2.6M2.4 12H5M19 12h2.6" />
  </svg>
);

/* ---------------------------------------------------------------------------
 * Solid stat glyphs.
 *
 * The four dashboard tiles read as one row of pictograms, so they are FILLED
 * shapes rather than the 1.9px outline set — an outlined icon at 26px next to a
 * 2rem number disappears. Outline versions above stay for list rows and tabs.
 * ------------------------------------------------------------------------ */

const solid = (size = 24) => ({
  width: size, height: size, viewBox: '0 0 24 24',
  fill: 'currentColor', 'aria-hidden': true,
});

/** Cow, side-on — the herd count. */
export const IconCowSolid = ({ size }: P) => (
  <svg {...solid(size)} viewBox="0 0 100 100">
    <path d={COW_BODY} />
  </svg>
);

/** Shield with a cross — the animals that are fine. */
export const IconShieldSolid = ({ size }: P) => (
  <svg {...solid(size)}>
    <path d="M12 2.2 4.6 5.1v6c0 4.7 3.1 8.7 7.4 10.7 4.3-2 7.4-6 7.4-10.7v-6L12 2.2Z" />
    <path d="M12.9 7.6h-1.8v2.2H8.9v1.8h2.2v2.2h1.8v-2.2h2.2V9.8h-2.2V7.6Z"
          fill="#fff" />
  </svg>
);

/** Warning triangle — open alerts. */
export const IconWarningSolid = ({ size }: P) => (
  <svg {...solid(size)}>
    <path d="M13.1 3.4a1.3 1.3 0 0 0-2.2 0L1.7 19.2a1.3 1.3 0 0 0 1.1 1.9h18.4a1.3 1.3 0 0 0 1.1-1.9L13.1 3.4Z" />
    <path d="M11.1 8.6h1.8v5.2h-1.8V8.6Zm0 6.7h1.8v1.9h-1.8v-1.9Z" fill="#fff" />
  </svg>
);

/** Battery, charged — mean collar charge. */
export const IconBatterySolid = ({ size }: P) => (
  <svg {...solid(size)}>
    <rect x="1.8" y="7" width="17" height="10" rx="2.6" />
    <rect x="20.2" y="10.2" width="2" height="3.6" rx="1" />
  </svg>
);
