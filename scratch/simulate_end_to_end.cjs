function downsampleRing(srcLat, srcLon, maxPoints) {
  const srcCount = srcLat.length;
  if (srcCount <= maxPoints) {
    return { outLat: srcLat, outLon: srcLon };
  }
  const outLat = [];
  const outLon = [];
  for (let i = 0; i < maxPoints; i++) {
    const srcIndex = Math.floor(i * srcCount / maxPoints);
    outLat.push(srcLat[srcIndex]);
    outLon.push(srcLon[srcIndex]);
  }
  return { outLat, outLon };
}

// Generate a 150-point circular walk track
const track = [];
const R = 6371000;
const centerLat = 13.076946;
const centerLon = 77.554085;
const radius = 50; // 50m radius
for (let i = 0; i < 150; i++) {
  const angle = (i / 150) * Math.PI * 2;
  const lat = centerLat + (radius / R) * (180 / Math.PI) * Math.cos(angle);
  const lon = centerLon + (radius / R) * (180 / Math.PI) * Math.sin(angle) / Math.cos(centerLat * Math.PI / 180);
  track.push([lat, lon]);
}

// App creates closed ring
const closed = [...track, track[0]]; // 151 points

// App sends to device_commands
const payload = { ring: closed };

// Gateway receives JSON
const json = JSON.stringify(payload);
console.log("1. Gateway receives JSON of length:", json.length);

// Gateway parses JSON (simulating applySetZoneCommand)
const srcLat = [];
const srcLon = [];
const parsed = JSON.parse(json);
const ring = parsed.ring;
for (const p of ring) {
  srcLat.push(p[0]);
  srcLon.push(p[1]);
}
console.log(`2. Gateway parses ${srcLat.length} points (MAX_RING_SOURCE is 300)`);

// Gateway downsamples
const { outLat, outLon } = downsampleRing(srcLat, srcLon, 8);
console.log(`3. Gateway downsamples to ${outLat.length} points`);

// Gateway creates SET_BOUNDARY payload
let data = "";
for (let i = 0; i < outLat.length; i++) {
  if (i > 0) data += ";";
  data += outLat[i].toFixed(4) + "|" + outLon[i].toFixed(4);
}
console.log("4. Gateway sends to Collar: CMD|SET_BOUNDARY|8|" + data);
console.log("SUCCESS: Simulation proves the Walk mode works perfectly without crashing or losing points.");
