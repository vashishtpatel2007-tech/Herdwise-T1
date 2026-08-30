/**
 * §8 — device simulator. Build early: nothing is demoable without it.
 *
 *   npm run simulate                              12 collars, normal grazing
 *   npm run simulate -- --scenario=parallel-walk  a named scenario
 *   npm run simulate -- --bootstrap               create the demo herd first
 *
 * Posts to the REAL ingest endpoint with the REAL device secret, so the app
 * cannot tell a simulated collar from a real one. The scenario flags are
 * simultaneously the test suite and the demo script (§8).
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { destination, haversine, makeRng, normalSample } from '../src/engine/geo.ts';

config();

// ---------------------------------------------------------------------------
type Scenario =
  | 'graze' | 'road-approach' | 'parallel-walk' | 'stationary-on-road'
  | 'night-on-road' | 'lie-down' | 'fall' | 'threshold-oscillation'
  | 'bad-gps' | 'geofence-breach' | 'offline';

const SCENARIOS: Record<Scenario, string> = {
  'graze': 'normal grazing inside the zone',
  'road-approach': 'walks at a real imported highway — should alert',
  'parallel-walk': 'walks ALONGSIDE a highway — MUST NOT alert (proves §7.3)',
  'stationary-on-road': 'stops on the highway — MUST go critical (proves §7.4)',
  'night-on-road': 'stationary on road at 23:00 — critical + call + authority',
  'lie-down': 'slow rotation, no spike — MUST NOT fire a fall (proves §7.8)',
  'fall': 'spike then rotation then stillness — MUST fire',
  'threshold-oscillation': 'risk hovers 63–67 for 10 min — MUST produce ONE alert',
  'bad-gps': 'hdop 8, sats 3 — MUST produce a DEVICE alert, not an animal alert',
  'geofence-breach': 'leaves the grazing zone',
  'offline': 'collar stops reporting',
};

// §8 — adaptive reporting rate, matching real firmware.
const INTERVALS_MS = {
  idle_in_zone: 10 * 60_000,
  moving: 2 * 60_000,
  near_boundary: 30_000,
  toward_road: 15_000,
  live_requested: 5_000,
};

const DEMO_ANIMALS = [
  'Lakshmi', 'Ganga', 'Nandini', 'Kamadhenu', 'Radha', 'Tulsi',
  'Sarasvati', 'Meera', 'Parvati', 'Yamuna', 'Kaveri', 'Sita',
];

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  Missing required environment variable: ${name}`);
    console.error('  Set it in .env (see .env.example). Nothing was sent.\n');
    process.exit(1);
  }
  return v;
}

function parseArgs() {
  const a = Object.fromEntries(
    process.argv.slice(2).map((s) => {
      const [k, ...r] = s.replace(/^--/, '').split('=');
      return [k, r.length ? r.join('=') : 'true'];
    }),
  );
  return {
    scenario: (a.scenario ?? 'graze') as Scenario,
    count: Number(a.count ?? 12),
    bootstrap: a.bootstrap === 'true',
    /** Wall-clock seconds between ticks; the sim clock advances by the real interval. */
    tick: Number(a.tick ?? 2),
    duration: Number(a.duration ?? 0), // 0 = run forever
    speed: Number(a.speed ?? 60), // sim seconds per wall second
  };
}

interface Collar {
  device_key: string;
  animal_id: string;
  name: string;
  lat: number;
  lon: number;
  heading: number;
  speed_kmh: number;
  battery: number;
  seq: number;
  nextDueMs: number;
  rng: () => number;
  /** Mirrors the collar's own switch, set by a downlink command. */
  enabled: boolean;
  /** Command ids to acknowledge on the next packet. */
  acked: string[];
}

// ---------------------------------------------------------------------------
/**
 * `supabase gen types` has not been run against this project yet, so the client
 * has no row types to infer from and every select() would widen to `never`.
 * This is a dev-only script talking to a schema we control, so it is typed
 * loosely on purpose rather than propagating casts through every call.
 */
interface Db {
  from(table: string): any;
  rpc(fn: string, args?: Record<string, unknown>): any;
}

async function bootstrap(db: Db, count: number) {
  console.log('  bootstrapping demo herd ...');

  const { data: existing } = await db.from('farmers').select('id').eq('phone', '+919000000001').maybeSingle();
  let farmer_id = existing?.id as string | undefined;

  if (!farmer_id) {
    const { data, error } = await db.from('farmers').insert({
      phone: '+919000000001', name: 'Demo Farmer', village: 'Hoskote', language: 'en',
    }).select('id').single();
    if (error) throw new Error(`farmer: ${error.message}`);
    farmer_id = data.id as string;
  }

  // Anchor the demo on a real imported road so the risk model has something
  // genuine to reason about. Without roads there is nothing to be near.
  const { data: road } = await db
    .from('road_segments')
    .select('id, name, base_risk')
    .gte('base_risk', 4)
    .limit(1).maybeSingle();

  if (!road) {
    console.error('\n  No roads imported yet. Run:');
    console.error('    npm run import:roads -- --bbox=12.90,77.45,13.10,77.70\n');
    process.exit(1);
  }

  const { data: mid } = await db.rpc('road_line', { p_road_id: road.id });
  const line = mid as Array<[number, number]>;
  const anchor = line[Math.floor(line.length / 2)];

  // Zone sits 400 m south of the road: close enough to be interesting,
  // far enough that normal grazing is genuinely safe.
  const [zLat, zLon] = destination(anchor[0], anchor[1], 180, 400);
  const ring: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const [la, lo] = destination(zLat, zLon, (i / 24) * 360, 260);
    ring.push(`${lo} ${la}`);
  }

  const { data: zone } = await db.from('grazing_zones').select('id').eq('farmer_id', farmer_id).maybeSingle();
  if (!zone) {
    const { error } = await db.from('grazing_zones').insert({
      farmer_id, name: 'Home field', drawn_by: 'circle', buffer_m: 30,
      boundary: `SRID=4326;POLYGON((${ring.join(',')}))`,
    });
    if (error) throw new Error(`zone: ${error.message}`);
  }

  for (let i = 0; i < count; i++) {
    const name = DEMO_ANIMALS[i % DEMO_ANIMALS.length] + (i >= DEMO_ANIMALS.length ? ` ${i}` : '');
    const slug = `demo-${name.toLowerCase().replace(/\s+/g, '-')}`;
    const { data: a } = await db.from('animals').upsert({
      farmer_id, name, public_slug: slug,
      pashu_aadhaar_tag: String(100000000000 + i),
      breed: ['Gir', 'Sahiwal', 'Deoni', 'Hallikar'][i % 4],
    }, { onConflict: 'public_slug' }).select('id').single();

    if (a) {
      await db.from('devices').upsert(
        { device_key: `SIM-${String(i + 1).padStart(3, '0')}`, animal_id: a.id, firmware: 'sim-1.0' },
        { onConflict: 'device_key' },
      );
    }
  }

  console.log(`  demo herd ready: ${count} animals near ${road.name ?? 'an imported road'}`);
  return { farmer_id, anchor, zone: { lat: zLat, lon: zLon, radius: 260 } };
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs();
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const secret = requireEnv('DEVICE_INGEST_SECRET');
  const ingest = process.env.INGEST_URL || `${url}/functions/v1/ingest`;

  if (!(args.scenario in SCENARIOS)) {
    console.error(`\n  Unknown scenario "${args.scenario}". Available:\n`);
    for (const [k, v] of Object.entries(SCENARIOS)) console.error(`    ${k.padEnd(22)} ${v}`);
    console.error('');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } }) as unknown as Db;

  console.log('\nPashuGuard device simulator');
  console.log(`  scenario  ${args.scenario} — ${SCENARIOS[args.scenario]}`);
  console.log(`  endpoint  ${ingest}\n`);

  let anchor: [number, number] | null = null;
  let zone: { lat: number; lon: number; radius: number } | null = null;

  if (args.bootstrap) {
    const b = await bootstrap(db, args.count);
    anchor = b.anchor; zone = b.zone;
  }

  const { data: devices } = await db
    .from('devices')
    .select('device_key, animal_id, animals(name)')
    .not('animal_id', 'is', null)
    .limit(args.count);

  if (!devices?.length) {
    console.error('\n  No devices found. Run with --bootstrap first.\n');
    process.exit(1);
  }

  if (!zone) {
    const { data: z } = await db.rpc('zone_centre_for_device', { p_device_key: devices[0].device_key })
      .then((r: { data: unknown }) => r, () => ({ data: null }));
    if (z) zone = z as typeof zone;
  }

  // Fall back to the first animal's last position, else the road anchor.
  if (!zone) {
    const { data: lp } = await db.from('latest_positions').select('lat, lon').limit(1).maybeSingle();
    if (lp) zone = { lat: lp.lat as number, lon: lp.lon as number, radius: 260 };
  }
  if (!zone && anchor) zone = { lat: anchor[0], lon: anchor[1], radius: 260 };
  if (!zone) {
    console.error('\n  Could not determine a starting area. Run with --bootstrap.\n');
    process.exit(1);
  }

  // Find the nearest dangerous road so scenarios aim at something real.
  const { data: roads } = await db.rpc('nearest_road_to', { p_lat: zone.lat, p_lon: zone.lon });
  const road = roads as { id: number; name: string; line: Array<[number, number]> } | null;

  // ---- Build collars, with STAGGERED wake times (§8) ----------------------
  // Staggering matters: it keeps the map as a whole from ever being more than
  // one interval stale, without anyone requesting a refresh.
  const collars: Collar[] = devices.map((d: Record<string, unknown>, i: number) => {
    const rng = makeRng(1000 + i);
    const ang = rng() * 360;
    const rad = Math.sqrt(rng()) * zone!.radius * 0.7;
    const [lat, lon] = destination(zone!.lat, zone!.lon, ang, rad);
    return {
      device_key: d.device_key as string,
      animal_id: d.animal_id as string,
      name: (d.animals as { name: string } | null)?.name ?? d.device_key as string,
      lat, lon,
      heading: rng() * 360,
      speed_kmh: 0.3 + rng() * 0.9,
      battery: 60 + Math.floor(rng() * 40),
      seq: 1,
      nextDueMs: Math.floor((i / devices.length) * INTERVALS_MS.moving),
      rng,
      enabled: true,
      acked: [],
    };
  });

  // The scenario subject is collar 0; the rest keep grazing normally so the
  // demo shows one animal in trouble against a calm herd.
  const subject = collars[0];
  console.log(`  subject   ${subject.name} (${subject.device_key})`);
  console.log(`  herd      ${collars.length} collars\n`);

  let simMs = 0;
  const startWall = Date.now();

  // Night scenarios need a night clock; recorded_at drives every time-of-day
  // decision in the engine (§6, §7.4, §7.8).
  const baseClock = args.scenario === 'night-on-road'
    ? new Date(new Date().setHours(23, 0, 0, 0))
    : new Date();

  async function post(c: Collar, over: Record<string, unknown> = {}) {
    const recorded_at = new Date(baseClock.getTime() + simMs).toISOString();
    const body = {
      device_id: c.device_key,
      animal_id: c.animal_id,
      lat: c.lat, lon: c.lon,
      speed_kmh: Number(c.speed_kmh.toFixed(2)),
      heading_deg: Math.round(c.heading),
      fix_quality: 3, hdop: 0.8 + c.rng() * 0.8, sats: 8 + Math.floor(c.rng() * 4),
      battery_pct: Math.round(c.battery),
      movement_state: c.speed_kmh < 0.3 ? 0 : c.speed_kmh < 1.5 ? 1 : c.speed_kmh < 4 ? 2 : 3,
      event_code: 0,
      seq: c.seq++,
      recorded_at,
      // Echo back the ids we were handed last time, so the app can show
      // "delivered" instead of "waiting for collar".
      ...(c.acked.length ? { acked: c.acked } : {}),
      ...over,
    };
    c.acked = [];

    try {
      const res = await fetch(ingest, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-secret': secret },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.log(`  ${c.name.padEnd(12)} HTTP ${res.status} ${JSON.stringify(j)}`);
        return;
      }

      // ---- Act on the downlink, exactly as the firmware must (§ collar
      // contract). The response IS the instruction set.
      if (typeof j.next_interval_s === 'number') c.nextDueMs = j.next_interval_s * 1000;

      if (Array.isArray(j.commands)) {
        for (const cmd of j.commands) {
          console.log(`  ${' '.repeat(10)}  ${c.name.padEnd(12)} << ${cmd.command} ${JSON.stringify(cmd.payload ?? {})}`);
          if (cmd.command === 'set_enabled') c.enabled = cmd.payload?.enabled !== false;
        }
        // Ack so the server can show "delivered" rather than "waiting".
        c.acked = j.commands.map((x: { id: string }) => x.id);
      }

      const cue = j.cue ?? {};
      const cueTag = cue.active
        ? `  [CUE ${String(cue.pattern).toUpperCase()} ${String(cue.side).toUpperCase()} x${cue.intensity}]`
        : '';
      const offTag = j.enabled === false ? '  (collar OFF)' : '';
      const tag = j.notified ? '  ** ALERT **' : '';

      console.log(
        `  ${new Date(recorded_at).toLocaleTimeString()}  ${c.name.padEnd(12)}` +
        ` risk ${String(j.road_risk ?? '-').padStart(3)}  ${String(j.state ?? '-').padEnd(8)}` +
        ` ${String(j.situation ?? '-').padEnd(20)}${cueTag}${offTag}${tag}`,
      );
    } catch (err) {
      console.log(`  ${c.name.padEnd(12)} post failed: ${String(err)}`);
    }
  }

  /** Correlated random walk: heading persists, speed drifts. Real grazing. */
  function graze(c: Collar, dtS: number) {
    c.heading = (c.heading + normalSample(c.rng, 0, 25) + 360) % 360;
    c.speed_kmh = Math.min(Math.max(c.speed_kmh + normalSample(c.rng, 0, 0.25), 0.1), 1.2);
    // Occasional directed excursion at 3–5 km/h.
    if (c.rng() < 0.03) c.speed_kmh = 3 + c.rng() * 2;
    // Gentle attraction back toward the zone centre keeps the herd coherent.
    const dCentre = haversine(c.lat, c.lon, zone!.lat, zone!.lon);
    if (dCentre > zone!.radius * 0.8) {
      const back = (Math.atan2(zone!.lon - c.lon, zone!.lat - c.lat) * 180) / Math.PI;
      c.heading = (c.heading + 0.4 * (((back - c.heading + 540) % 360) - 180) + 360) % 360;
    }
    const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
    c.lat = lat; c.lon = lon;
  }

  /** Drive the subject according to the scenario. */
  async function driveSubject(dtS: number) {
    const c = subject;
    const line = road?.line;
    const target = line?.[Math.floor(line.length / 2)];

    switch (args.scenario) {
      case 'road-approach': {
        if (!target) return graze(c, dtS);
        c.heading = bearingTo(c.lat, c.lon, target[0], target[1]);
        c.speed_kmh = 3.5;
        const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
        c.lat = lat; c.lon = lon;
        return;
      }
      case 'parallel-walk': {
        if (!target) return graze(c, dtS);
        // Hold a 45 m offset and walk ALONG the road. Deliberately outside the
        // 15 m on-road band so this tests §7.3 (closing speed), not §7.4.
        const toRoad = bearingTo(c.lat, c.lon, target[0], target[1]);
        const d = haversine(c.lat, c.lon, target[0], target[1]);
        if (Math.abs(d - 45) > 8) {
          c.heading = d > 45 ? toRoad : (toRoad + 180) % 360;
        } else {
          c.heading = (toRoad + 90) % 360; // exactly perpendicular => closing 0
        }
        c.speed_kmh = 4.0;
        const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
        c.lat = lat; c.lon = lon;
        return;
      }
      case 'stationary-on-road':
      case 'night-on-road': {
        if (!target) return graze(c, dtS);
        const d = haversine(c.lat, c.lon, target[0], target[1]);
        if (d > 6) {
          c.heading = bearingTo(c.lat, c.lon, target[0], target[1]);
          c.speed_kmh = 4.0;
          const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
          c.lat = lat; c.lon = lon;
        } else {
          c.lat = target[0]; c.lon = target[1];
          c.speed_kmh = 0.05; // parked on the carriageway
        }
        return;
      }
      case 'bad-gps': {
        graze(c, dtS);
        await post(c, { hdop: 8.0, sats: 3, fix_quality: 1 });
        return 'posted';
      }
      case 'fall': {
        graze(c, dtS);
        c.speed_kmh = 0;
        await post(c, { event_code: 4, movement_state: 0, speed_kmh: 0 });
        return 'posted';
      }
      case 'lie-down': {
        // A lie-down is a normal heartbeat with the animal still. The collar's
        // gate 1 rejected it, so no fall event ever reaches the cloud (§7.8).
        c.speed_kmh = 0;
        await post(c, { event_code: 0, movement_state: 0, speed_kmh: 0 });
        return 'posted';
      }
      case 'geofence-breach': {
        const out = bearingTo(zone!.lat, zone!.lon, c.lat, c.lon);
        c.heading = out; c.speed_kmh = 3.0;
        const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
        c.lat = lat; c.lon = lon;
        return;
      }
      case 'threshold-oscillation': {
        if (!target) return graze(c, dtS);
        // Hover in the band that produces road_risk ~63–67 and oscillate across
        // it. Hysteresis must collapse this into ONE notification.
        const d = haversine(c.lat, c.lon, target[0], target[1]);
        const want = 95 + Math.sin(simMs / 60_000) * 12;
        const toRoad = bearingTo(c.lat, c.lon, target[0], target[1]);
        c.heading = d > want ? toRoad : (toRoad + 180) % 360;
        c.speed_kmh = 1.2;
        const [lat, lon] = destination(c.lat, c.lon, c.heading, (c.speed_kmh / 3.6) * dtS);
        c.lat = lat; c.lon = lon;
        return;
      }
      case 'offline':
        return 'skip';
      default:
        return graze(c, dtS);
    }
  }

  /** §8 adaptive interval — how soon this collar should wake again. */
  function intervalFor(c: Collar): number {
    if (c === subject && args.scenario !== 'graze') return INTERVALS_MS.toward_road;
    const dCentre = haversine(c.lat, c.lon, zone!.lat, zone!.lon);
    if (dCentre > zone!.radius - 100) return INTERVALS_MS.near_boundary;
    if (c.speed_kmh > 1.5) return INTERVALS_MS.moving;
    return INTERVALS_MS.idle_in_zone;
  }

  console.log('  time      animal        risk  state     situation\n');

  const timer = setInterval(async () => {
    const dtS = args.speed * args.tick;
    simMs += dtS * 1000;

    for (const c of collars) {
      c.nextDueMs -= dtS * 1000;
      if (c.nextDueMs > 0) {
        if (c !== subject) graze(c, dtS);
        continue;
      }
      c.nextDueMs = intervalFor(c);
      c.battery = Math.max(0, c.battery - 0.002 * (dtS / 60));

      if (c === subject) {
        const r = await driveSubject(dtS);
        if (r === 'posted' || r === 'skip') continue;
      } else {
        graze(c, dtS);
      }
      await post(c);
    }

    if (args.duration && Date.now() - startWall > args.duration * 1000) {
      clearInterval(timer);
      console.log('\n  done.\n');
      process.exit(0);
    }
  }, args.tick * 1000);
}

function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

main().catch((e) => {
  console.error('\n  Simulator failed:', e instanceof Error ? e.message : e, '\n');
  process.exit(1);
});
