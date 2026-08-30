// Reproduce the EXACT circle-to-polygon conversion from FieldsScreen.tsx lines 127-134
// then downsample it like gateway.ino does (lines 5908-5915)
// then test if the collar's isInsideBoundary + getBoundaryDistance works correctly

const R_EARTH = 6_371_008.8;

// Test: circle centred at 13.0769, 77.5540, radius 200m
// The cow (collar) is at the CENTRE of the circle = should be INSIDE and 200m from boundary

const centreLat = 13.0769;
const centreLon = 77.5540;
const radiusM = 200;
const cowLat = 13.0769; // cow at center
const cowLon = 77.5540;

// ---- STEP 1: App generates 40-point circle polygon (FieldsScreen.tsx L128-134) ----
const ring = Array.from({ length: 40 }, (_, i) => {
  const br = (i / 40) * 2 * Math.PI;
  const lat = centreLat + (radiusM / R_EARTH) * (180 / Math.PI) * Math.cos(br);
  const lon = centreLon + (radiusM / R_EARTH) * (180 / Math.PI) * Math.sin(br)
    / Math.cos(centreLat * Math.PI / 180);
  return [lat, lon];
});

console.log('Circle ring has', ring.length, 'points');
console.log('Sample point[0]:', ring[0]);
console.log('Sample point[10]:', ring[10]);

// ---- STEP 2: Gateway downsampleRing picks 8 evenly spaced (gateway.ino L5908-5915) ----
const maxPoints = 8;
const srcCount = ring.length; // 40

const downsampled = [];
for (let i = 0; i < maxPoints; i++) {
  const srcIndex = Math.floor((i * srcCount) / maxPoints); // integer division like C
  downsampled.push(ring[srcIndex]);
}

console.log('\nDownsampled to', downsampled.length, 'points:');
downsampled.forEach((p, i) => console.log(`  P${i+1}: ${p[0].toFixed(6)}, ${p[1].toFixed(6)}`));

// ---- STEP 3: Collar isInsideBoundary ray-casting (collar.ino L796-853) ----
function isInsideBoundary(lat, lon, boundary) {
  const n = boundary.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = boundary[i][1]; // lon
    const yi = boundary[i][0]; // lat
    const xj = boundary[j][1];
    const yj = boundary[j][0];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---- STEP 4: Collar gpsToXY (collar.ino L662-688) ----
function gpsToXY(lat, lon, refLat, refLon) {
  const R = 6371000.0;
  const x = (lon - refLon) * Math.PI / 180 * Math.cos(refLat * Math.PI / 180) * R;
  const y = (lat - refLat) * Math.PI / 180 * R;
  return [x, y];
}

// ---- STEP 5: Collar pointToSegmentDistance (collar.ino L694-790) ----
function pointToSegmentDistance(pLat, pLon, aLat, aLon, bLat, bLon) {
  const [px, py] = gpsToXY(pLat, pLon, pLat, pLon); // always 0,0
  const [ax, ay] = gpsToXY(aLat, aLon, pLat, pLon);
  const [bx, by] = gpsToXY(bLat, bLon, pLat, pLon);
  const dx = bx - ax, dy = by - ay;
  const len2 = dx*dx + dy*dy;
  if (len2 < 0.000001) return Math.sqrt(ax*ax + ay*ay);
  let t = ((px - ax)*dx + (py - ay)*dy) / len2;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const cx = ax + t*dx, cy = ay + t*dy;
  return Math.sqrt((px-cx)**2 + (py-cy)**2);
}

// ---- STEP 6: Collar getBoundaryDistance (collar.ino L859-904) ----
function getBoundaryDistance(lat, lon, boundary) {
  let minimum = 1e12;
  for (let i = 0; i < boundary.length; i++) {
    const j = (i + 1) % boundary.length;
    const d = pointToSegmentDistance(lat, lon,
      boundary[i][0], boundary[i][1],
      boundary[j][0], boundary[j][1]);
    if (d < minimum) minimum = d;
  }
  return minimum;
}

// ---- RESULTS ----
const inside = isInsideBoundary(cowLat, cowLon, downsampled);
const dist = getBoundaryDistance(cowLat, cowLon, downsampled);

console.log('\n====== AUDIT RESULTS ======');
console.log(`Cow at: ${cowLat}, ${cowLon}`);
console.log(`Circle centre: ${centreLat}, ${centreLon}, radius: ${radiusM}m`);
console.log(`isInsideBoundary: ${inside}  (expected: true)`);
console.log(`getBoundaryDistance: ${dist.toFixed(1)}m  (expected: ~${radiusM}m)`);

// Also test cow OUTSIDE (500m away)
const cowOutLat = centreLat + (500 / R_EARTH) * (180/Math.PI);
const cowOutLon = centreLon;
const insideOut = isInsideBoundary(cowOutLat, cowOutLon, downsampled);
const distOut = getBoundaryDistance(cowOutLat, cowOutLon, downsampled);
console.log('\n--- COW OUTSIDE (500m north) ---');
console.log(`isInsideBoundary: ${insideOut}  (expected: false)`);
console.log(`getBoundaryDistance: ${distOut.toFixed(1)}m  (expected: ~300m away from perimeter)`);
console.log(`Risk: ${!insideOut ? '100 (OUTSIDE = MAX RISK) ✓' : 'BUG - shows inside'}`);
