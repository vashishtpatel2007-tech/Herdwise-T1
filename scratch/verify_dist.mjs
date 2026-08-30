import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '/Users/vashishtpatel2007gmail.com/Desktop/cow/supabase/.env' });

// We use the anon key since we don't have the service role key, we'll query grazing_zones which should be readable
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://bzufqeuaordhrykgsiub.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY || ''
);

async function run() {
  const { data: zones, error } = await supabase.from('grazing_zones').select('*').order('created_at', { ascending: false }).limit(1);
  if (error) {
    console.error('Error fetching zones:', error);
    return;
  }
  if (!zones || zones.length === 0) return console.log('No zones found');
  
  console.log('Latest zone:', zones[0]);
  
  const wkt = zones[0].boundary;
  const inner = wkt.match(/\(\((.*?)\)\)/)[1];
  const points = inner.split(',').map(p => {
    const [lon, lat] = p.trim().split(' ');
    return { lat: Number(lat), lon: Number(lon) };
  });
  
  console.log('Polygon points:', points);
  
  const cowLat = 13.076954;
  const cowLon = 77.553985;
  
  console.log(`\nCow Position: ${cowLat}, ${cowLon}`);
  
  // Calculate distance to polygon edges
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }
  
  // Project point onto line segment
  function distanceToSegment(lat, lon, lat1, lon1, lat2, lon2) {
      // Very rough Cartesian approximation for small distances
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
  
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
      const d = distanceToSegment(cowLat, cowLon, points[i].lat, points[i].lon, points[i+1].lat, points[i+1].lon);
      if (d < minDist) minDist = d;
      console.log(`Distance to segment ${i}: ${d.toFixed(2)}m`);
  }
  
  console.log(`\nMinimum distance to boundary: ${minDist.toFixed(2)}m`);
}

run();
