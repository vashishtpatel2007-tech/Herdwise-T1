function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const x = lon * Math.cos(lat * Math.PI/180);
    const y = lat;
    const x1 = lon1 * Math.cos(lat1 * Math.PI/180);
    const y1 = lat1;
    const x2 = lon2 * Math.cos(lat2 * Math.PI/180);
    const y2 = lat2;
    
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const len_sq = C * C + D * D;
    let param = -1;
    if (len_sq != 0) param = dot / len_sq;
    
    let xx, yy;
    if (param < 0) {
      xx = x1; yy = y1;
    } else if (param > 1) {
      xx = x2; yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }
    
    const dx = x - xx;
    const dy = y - yy;
    
    return Math.sqrt(dx * dx + dy * dy) * (Math.PI/180) * R;
}

const cowLat = 13.076937;
const cowLon = 77.554073;

// Triangle points from visual estimation of Screenshot 1
const p1 = { lat: 13.0815, lon: 77.5510 }; // Top Left
const p2 = { lat: 13.0815, lon: 77.5585 }; // Top Right
const p3 = { lat: 13.0710, lon: 77.5540 }; // Bottom Tip

const d1 = distanceToSegment(cowLat, cowLon, p1.lat, p1.lon, p2.lat, p2.lon); // Northern edge
const d2 = distanceToSegment(cowLat, cowLon, p2.lat, p2.lon, p3.lat, p3.lon); // Eastern edge
const d3 = distanceToSegment(cowLat, cowLon, p3.lat, p3.lon, p1.lat, p1.lon); // Western edge

console.log('Distance to Northern Edge:', d1.toFixed(1), 'meters');
console.log('Distance to Eastern Edge:', d2.toFixed(1), 'meters');
console.log('Distance to Western Edge:', d3.toFixed(1), 'meters');
console.log('Minimum (Boundary Distance):', Math.min(d1, d2, d3).toFixed(1), 'meters');

// Distance to the southern corner (bottom tip)
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}
console.log('Distance to Southern Tip (Corner):', haversine(cowLat, cowLon, p3.lat, p3.lon).toFixed(1), 'meters');
