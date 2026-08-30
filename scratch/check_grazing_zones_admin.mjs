import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('grazing_zones').select('*');
  console.log('Grazing Zones Count:', data ? data.length : 0);
  if (data && data.length > 0) {
    console.log('Latest Zone:', data[data.length - 1]);
  }
  if (error) console.log('Error:', error);
}
check();
