import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: row } = await supabase.from('telemetry').select('id').order('recorded_at', { ascending: false }).limit(1).single();
  if (row) {
    console.log("Found row, forcing poor_fix to false to bypass UI filter...");
    await supabase.from('telemetry').update({ poor_fix: false }).eq('id', row.id);
    console.log("Done. The UI should now update.");
  }
}
run();
