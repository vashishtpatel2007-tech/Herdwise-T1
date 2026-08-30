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

// Rough coords from reading the Google Map screenshot
const topLeftLat = 13.0811;
const topLeftLon = 77.5526;
const bottomLat = 13.0710;
const bottomLon = 77.5556;

const d = distanceToSegment(cowLat, cowLon, topLeftLat, topLeftLon, bottomLat, bottomLon);
console.log('Perpendicular distance to western edge:', d.toFixed(2), 'meters');
