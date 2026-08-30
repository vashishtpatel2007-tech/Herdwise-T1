import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log("Fetching grazing_zones...");
  const { data: zones, error: zErr } = await supabase.from('grazing_zones').select('*');
  console.log("Zones error:", zErr);
  
  console.log("Fetching device...");
  const { data: device, error: devErr } = await supabase.from('devices').select('animal_id').eq('device_key', 'PASHU-A01').single();
  console.log("Device:", device, "Error:", devErr);
  
  if (device) {
    console.log("Fetching latest_positions...");
    const { data: pos, error: pErr } = await supabase.from('latest_positions').select('*').eq('animal_id', device.animal_id).single();
    console.log("Pos:", pos, "Error:", pErr);
  }
}
test();
