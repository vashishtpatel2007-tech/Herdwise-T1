/**
 * §5 — road data import. Run once per operating area.
 *
 *   npm run import:roads -- --bbox=12.90,77.45,13.10,77.70 [--name="Bengaluru N"]
 *   bbox order is south,west,north,east (Overpass convention).
 *
 * This script is the ONLY source of road data in the system. No road is ever
 * hardcoded anywhere else — the whole risk model rests on real OSM
 * classification, so inventing a road would invent a danger.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config();

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** §5.2 — OSM class to risk tier. */
const RISK_BY_CLASS: Record<string, number> = {
  motorway: 5,  // Expressway
  trunk: 5,     // National Highway
  primary: 4,   // State Highway
  secondary: 3, // Major district road
  tertiary: 2,  // Minor connecting road
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    // §1.5 — fail loudly naming the variable. Never silently fall back.
    console.error(`\n  Missing required environment variable: ${name}`);
    console.error(`  Set it in .env (see .env.example). Nothing was written.\n`);
    process.exit(1);
  }
  return v;
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=');
      return [k, rest.join('=')];
    }),
  );
  if (!args.bbox) {
    console.error('\n  --bbox=south,west,north,east is required.');
    console.error('  Example: --bbox=12.90,77.45,13.10,77.70\n');
    process.exit(1);
  }
  const parts = String(args.bbox).split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    console.error('\n  --bbox must be four numbers: south,west,north,east\n');
    process.exit(1);
  }
  const [south, west, north, east] = parts;
  if (south >= north || west >= east) {
    console.error('\n  Invalid bbox: south must be < north and west < east.\n');
    process.exit(1);
  }
  return { south, west, north, east, name: args.name ?? args.bbox };
}

interface OverpassWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

async function fetchOverpass(bbox: ReturnType<typeof parseArgs>): Promise<OverpassWay[]> {
  const classes = Object.keys(RISK_BY_CLASS).join('|');
  const q = `
    [out:json][timeout:180];
    (
      way["highway"~"^(${classes})$"]
        (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out geom;
  `;

  let lastErr: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      process.stdout.write(`  querying ${new URL(endpoint).host} ... `);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements: OverpassWay[] };
      console.log(`${json.elements.length} ways`);
      return json.elements.filter((e) => e.type === 'way' && e.geometry?.length);
    } catch (err) {
      console.log('failed');
      lastErr = err;
    }
  }
  throw new Error(`All Overpass endpoints failed: ${String(lastErr)}`);
}

/** WKT LineString. PostGIS wants lon lat, which is the reverse of how we read it. */
function toWkt(geometry: Array<{ lat: number; lon: number }>): string {
  return `LINESTRING(${geometry.map((p) => `${p.lon} ${p.lat}`).join(',')})`;
}

async function main() {
  const bbox = parseArgs();
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(url, key, { auth: { persistSession: false } });

  console.log(`\nPashuGuard — importing roads for ${bbox.name}`);
  console.log(`  bbox  ${bbox.south},${bbox.west},${bbox.north},${bbox.east}\n`);

  const ways = await fetchOverpass(bbox);

  const rows = ways
    .map((w) => {
      const cls = w.tags?.highway ?? '';
      const base_risk = RISK_BY_CLASS[cls];
      if (!base_risk || !w.geometry || w.geometry.length < 2) return null;
      return {
        osm_id: w.id,
        name: w.tags?.name ?? w.tags?.ref ?? null,
        highway_class: cls,
        base_risk,
        geom: toWkt(w.geometry),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    console.error('\n  No matching roads in that bbox. Nothing written.\n');
    process.exit(1);
  }

  // Replace this area's roads rather than accumulating duplicates on re-run.
  const osmIds = rows.map((r) => r.osm_id);
  for (let i = 0; i < osmIds.length; i += 500) {
    await db.from('road_segments').delete().in('osm_id', osmIds.slice(i, i + 500));
  }

  let inserted = 0;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await db.from('road_segments').insert(chunk);
    if (error) {
      console.error(`\n  Insert failed at row ${i}: ${error.message}\n`);
      process.exit(1);
    }
    inserted += chunk.length;
    process.stdout.write(`\r  inserted ${inserted}/${rows.length}`);
  }

  // §5.3 — log the count, broken down so the risk tiers are auditable.
  const byClass = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.highway_class] = (acc[r.highway_class] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\n\n  Imported by class:');
  for (const [cls, n] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cls.padEnd(10)} risk ${RISK_BY_CLASS[cls]}   ${n}`);
  }
  console.log(`\n  Total ${inserted} segments.\n`);
}

main().catch((e) => {
  console.error('\n  Import failed:', e instanceof Error ? e.message : e, '\n');
  process.exit(1);
});
