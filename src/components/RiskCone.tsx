/**
 * §9.1 / §10 — the signature element.
 *
 * The Monte Carlo projection (§7.7) drawn as a translucent fan from the animal
 * toward the road, opacity scaling with p_reaches_road_5min. This is where the
 * visual boldness is spent; everything around it stays quiet.
 *
 * The 500 simulated endpoints are reduced to their convex hull so the shape
 * reads as one region at a glance rather than as a cloud of dots. A farmer
 * needs "she is likely to end up over there", not a scatter plot.
 */

import { Polygon } from 'react-leaflet';
import { useMemo } from 'react';

interface Props {
  endpoints: Array<[number, number]>;
  probability: number;
  /** Reduced motion disables the pulse; the shape itself never moves. */
  animate?: boolean;
}

/** Andrew's monotone chain. O(n log n), fine for 500 points on a cheap phone. */
function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  if (points.length < 3) return points;
  const pts = [...points].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);

  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop(); upper.pop();
  return lower.concat(upper);
}

export function RiskCone({ endpoints, probability, animate = true }: Props) {
  const hull = useMemo(() => convexHull(endpoints), [endpoints]);

  if (hull.length < 3) return null;

  // Opacity carries the probability. Floor at 0.12 so a real-but-low chance is
  // still visible, ceiling at 0.55 so the satellite image stays readable.
  const opacity = Math.min(0.55, Math.max(0.12, probability * 0.7));

  return (
    <Polygon
      positions={hull}
      pathOptions={{
        color: '#D62828',
        weight: 2,
        opacity: 0.9,
        fillColor: '#D62828',
        fillOpacity: opacity,
        className: animate ? 'cone-live' : undefined,
      }}
      // Screen readers and the device-details page both need the raw number;
      // the map itself never shows a bare decimal (§9.3).
      interactive={false}
    />
  );
}
