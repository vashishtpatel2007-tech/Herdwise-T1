import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const { data: farmers } = await supabase.from('farmers').select('id').limit(1);
  if (!farmers || farmers.length === 0) return;
  const farmerId = farmers[0].id;
  
  const centre = [13.0772, 77.5547];
  const radius = 50;
  const R_EARTH = 6371000;
  
  const ring = Array.from({ length: 40 }, (_, i) => {
    const br = (i / 40) * 2 * Math.PI;
    const lat = centre[0] + (radius / R_EARTH) * (180 / Math.PI) * Math.cos(br);
    const lon = centre[1] + (radius / R_EARTH) * (180 / Math.PI) * Math.sin(br)
      / Math.cos(centre[0] * Math.PI / 180);
    return [lat, lon];
  });
  
  const closed = [...ring, ring[0]];
  const wkt = `SRID=4326;POLYGON((${closed.map(([la, lo]) => `${lo} ${la}`).join(',')}))`;
  
  const { data, error } = await supabase.from('grazing_zones').insert({
    farmer_id: farmerId,
    name: 'Test Circle',
    boundary: wkt,
    buffer_m: 5,
    drawn_by: 'circle'
  }).select();
  
  console.log("Error:", error);
  console.log("Data:", data);
}
test();
