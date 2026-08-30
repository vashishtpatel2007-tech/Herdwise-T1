import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '/Users/vashishtpatel2007gmail.com/Desktop/cow/supabase/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://bzufqeuaordhrykgsiub.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  const { data: zones } = await supabase.from('grazing_zones').select('*').order('created_at', { ascending: false }).limit(1);
  if (!zones || zones.length === 0) return console.log('No zones found');
  
  const wkt = zones[0].boundary;
  // WKT is POLYGON((lon lat, lon lat, ...))
  const inner = wkt.match(/\(\((.*?)\)\)/)[1];
  const points = inner.split(',').map(p => {
    const [lon, lat] = p.trim().split(' ');
    return [Number(lat), Number(lon)];
  });
  
  // Remove the last closing point to match frontend behavior which closes it manually or sends the ring
  if (points.length > 3 && points[0][0] === points[points.length-1][0] && points[0][1] === points[points.length-1][1]) {
    points.pop();
  }

  const { data: devices } = await supabase.from('devices').select('id').limit(1);
  const device_id = devices[0].id;

  console.log(`Pushing zone ${zones[0].name} with ${points.length} points to device ${device_id}...`);
  console.log(JSON.stringify(points));
  
  await supabase.from('device_commands').insert({
    device_id,
    command: 'set_zone',
    payload: { name: zones[0].name, ring: points }
  });
  console.log('Queued in device_commands!');
}

run();
