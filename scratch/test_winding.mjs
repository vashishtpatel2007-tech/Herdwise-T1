function isClockwise(poly) {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    // (x2 - x1) * (y2 + y1)
    sum += (p2[1] - p1[1]) * (p2[0] + p1[0]);
  }
  return sum > 0; // True if clockwise
}

let corners = [[13.0, 77.0], [13.0, 77.2], [13.2, 77.2], [13.2, 77.0]];
let cx = 0, cy = 0;
for (const [lat, lon] of corners) { cx += lat; cy += lon; }
cx /= corners.length;
cy /= corners.length;

const sorted = [...corners].sort((a, b) => {
  return Math.atan2(b[1] - cy, b[0] - cx) - Math.atan2(a[1] - cy, a[0] - cx);
});

console.log("Sorted:", sorted);
console.log("Is Clockwise?", isClockwise(sorted));

