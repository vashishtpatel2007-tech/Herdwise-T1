const corners = [[13.0772, 77.5547], [13.0782, 77.5547], [13.0782, 77.5557], [13.0772, 77.5557]];
let closed = [...corners, corners[0]];
let wkt = `SRID=4326;POLYGON((${closed.map(([la, lo]) => `${lo} ${la}`).join(',')}))`;
console.log("Polygon WKT:", wkt);

const track = [[13.0772, 77.5547], [13.0782, 77.5547], [13.0782, 77.5557], [13.0772, 77.5557]];
closed = [...track, track[0]];
wkt = `SRID=4326;POLYGON((${closed.map(([la, lo]) => `${lo} ${la}`).join(',')}))`;
console.log("Walk WKT:", wkt);
