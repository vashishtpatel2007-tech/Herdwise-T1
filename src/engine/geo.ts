/**
 * Spherical geometry primitives. Pure, dependency-free, deterministic.
 *
 * PostGIS does the authoritative distance/bearing work during enrichment.
 * These exist for the Monte Carlo simulation (§7.7), which advances thousands
 * of hypothetical points and cannot afford a database round trip per step.
 */

const R_EARTH_M = 6_371_008.8; // IUGG mean radius

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const kmhToMps = (kmh: number): number => (kmh * 1000) / 3600;
export const mpsToKmh = (mps: number): number => (mps * 3600) / 1000;

/** Great-circle distance in metres. */
export function haversine(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from point 1 to point 2, degrees clockwise from north. */
export function bearing(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Move `distance_m` from a point along `bearing_deg`. */
export function destination(
  lat: number, lon: number, bearing_deg: number, distance_m: number,
): [number, number] {
  const δ = distance_m / R_EARTH_M;
  const θ = toRad(bearing_deg);
  const φ1 = toRad(lat), λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return [toDeg(φ2), ((toDeg(λ2) + 540) % 360) - 180];
}

/**
 * Smallest angle between two bearings, 0..180.
 *
 * The wrap-around matters: heading 350° and bearing 10° differ by 20°, not 340°.
 * Getting this wrong inverts the closing-speed sign and turns every animal
 * walking away from a road into an alert.
 */
export function angularDifference(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** Perpendicular distance from a point to a segment, in metres. */
export function pointToSegmentMeters(
  plat: number, plon: number,
  alat: number, alon: number,
  blat: number, blon: number,
): number {
  // Equirectangular projection to local metres. Exact enough over the tens of
  // metres that matter here, and far cheaper than a full geodesic solve.
  const latRef = toRad((alat + blat) / 2);
  const mx = (lon: number) => toRad(lon) * Math.cos(latRef) * R_EARTH_M;
  const my = (lat: number) => toRad(lat) * R_EARTH_M;

  const px = mx(plon), py = my(plat);
  const ax = mx(alon), ay = my(alat);
  const bx = mx(blon), by = my(blat);

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Shortest distance from a point to a polyline, in metres. */
export function pointToLineMeters(
  plat: number, plon: number, line: Array<[number, number]>,
): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointToSegmentMeters(
      plat, plon, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1],
    );
    if (d < best) best = d;
  }
  return best;
}

/**
 * Seedable PRNG (mulberry32).
 *
 * Monte Carlo results must be reproducible: an acceptance test that asserts
 * "p > 0.5" cannot flake because Math.random() had a bad afternoon, and a
 * demo that shows a different cone on every reload is not defensible.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample from a uniform generator. */
export function normalSample(rng: () => number, mean: number, sd: number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
