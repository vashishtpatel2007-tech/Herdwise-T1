import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '/Users/vashishtpatel2007gmail.com/Desktop/cow/supabase/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://bzufqeuaordhrykgsiub.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY // fallback
);

async function check() {
  const { data, error } = await supabase
    .from('device_commands')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('Commands:', JSON.stringify(data, null, 2));
}

check();
