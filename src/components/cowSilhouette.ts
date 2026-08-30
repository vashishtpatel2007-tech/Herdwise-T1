/**
 * The cow.
 *
 * One silhouette, drawn once, used everywhere: the map pin, the Animals tab,
 * the dashboard tile, the empty states.
 *
 * Traced as ONE continuous outline — barrel, neck, head and muzzle are a
 * single closed path. An earlier version assembled the animal from separate
 * overlapping pieces (a neck quad, a head blob, an ear, a muzzle circle) and
 * every seam between them showed as a white notch once the shape was knocked
 * out of a coloured pin. Horns, legs, udder and tail are added on top, where
 * an overlap is invisible because it happens inside the body.
 *
 * Authored on a 0 0 100 100 grid, facing right, back at y=34, standing on
 * y=85. Consumers scale it with a nested <svg viewBox="0 0 100 100">, so
 * nothing downstream has to know these numbers.
 *
 * Pure path data, no JSX — CowMarker builds a Leaflet divIcon from an HTML
 * string and cannot import a component.
 */

/** The single closed outline: rump, back, neck, head, muzzle, jaw, belly. */
const OUTLINE =
  'M20,48A13,13 0 0 1 33,34L55,34C63,34 68,33 72,30C77,27 82,28 85,32' +
  'C89,35 92,37 93,41C94,45 94,47 93,49C91,52 87,53 83,52L74,50' +
  'C70,49 67,50 65,53C63,56 63,59 63,62L33,62A13,13 0 0 1 20,48Z';

/** Horns, springing from the poll. */
const HORNS =
  'M80,29c-3,-4 -7,-6 -11.5,-6c1,4.2 4.4,7.4 8.4,9.2z' +
  'M87,28c1,-4.2 5,-7.4 9.4,-8.2c0.2,4.2 -2.2,8.2 -6.2,10.4z';

/** Four legs with a slight hoof, the udder, and the tail with its tuft. */
const UNDER =
  'M25,58h7v25a2.2,2.2 0 0 1 -2.2,2.2h-2.6a2.2,2.2 0 0 1 -2.2,-2.2z' +
  'M37,58h7v25a2.2,2.2 0 0 1 -2.2,2.2h-2.6a2.2,2.2 0 0 1 -2.2,-2.2z' +
  'M52,58h7v25a2.2,2.2 0 0 1 -2.2,2.2h-2.6a2.2,2.2 0 0 1 -2.2,-2.2z' +
  'M61.5,58h7v25a2.2,2.2 0 0 1 -2.2,2.2h-2.6a2.2,2.2 0 0 1 -2.2,-2.2z' +
  'M46,58c4,0 7,3 7,6.5s-3,6.5 -7,6.5s-7,-3 -7,-6.5s3,-6.5 7,-6.5z' +
  'M21,40c-4,5 -6,13 -6,23h4.5c0,-9 1.5,-16 4.5,-19.5z' +
  'M15.5,59a4.4,5.2 0 0 1 0,10.4a4.4,5.2 0 0 1 0,-10.4z';

/** Filled silhouette — the map pin and the solid stat glyph. */
export const COW_BODY = OUTLINE + HORNS + UNDER;

/**
 * Outline version for the tab bar and list rows, where a solid dark blob at
 * 24px turns into a smudge. The body keeps its closed outline; legs and tail
 * become plain strokes so they do not read as filled bars.
 */
export const COW_OUTLINE =
  OUTLINE + HORNS +
  'M28.5,62V83M40.5,62V83M55.5,62V83M65,62V83' +
  'M21,40c-4,5 -6,13 -6,22';
