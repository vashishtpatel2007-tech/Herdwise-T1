import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function test() {
  const { data: farmers } = await supabase.from('farmers').select('id').limit(1);
  if (!farmers || farmers.length === 0) {
    console.log("No farmers found");
    return;
  }
  const farmerId = farmers[0].id;
  const wkt = "SRID=4326;POLYGON((77.554 13.077, 77.555 13.077, 77.555 13.078, 77.554 13.078, 77.554 13.077))";
  
  const { data, error } = await supabase.from('grazing_zones').insert({
    farmer_id: farmerId,
    name: 'Test Zone',
    boundary: wkt,
    buffer_m: 5,
    drawn_by: 'polygon'
  }).select();
  
  console.log("Error:", error);
  console.log("Data:", data);
}
test();
