/**
 * Edge Function: traffic-refresh (§6). Scheduled every 15 minutes.
 *
 * Holds the TomTom key server-side. The key NEVER reaches the browser — this
 * function returns only the computed result, which is the entire reason it
 * exists rather than calling TomTom from the client.
 *
 * Failure is not an error condition here. If TomTom is down or the quota is
 * spent we log it and stop; the engine falls back to the time-of-day model on
 * its own. Never block an alert on a traffic API being down (§6.4).
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const tomtomKey = Deno.env.get('TOMTOM_API_KEY');
  if (!tomtomKey) {
    // Explicit, visible, and non-fatal. The UI surfaces this state (§13.4).
    console.warn('TOMTOM_API_KEY not set — engine will use the time-of-day fallback model');
    return json({ ok: true, skipped: true, reason: 'no_api_key', updated: 0 });
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // §6.1 — only segments within 3 km of an ACTIVE grazing zone. Typically
  // 10–30, which is what keeps this inside a free tier.
  const { data: segments, error } = await db.rpc('segments_near_active_zones', { p_radius_m: 3000 });
  if (error) return json({ error: error.message }, 500);

  const list = (segments ?? []) as Array<{ id: number; lat: number; lon: number }>;
  let updated = 0;
  let failed = 0;

  for (const seg of list) {
    try {
      const endpoint =
        `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
        `?key=${tomtomKey}&point=${seg.lat},${seg.lon}&unit=KMPH`;

      const res = await fetch(endpoint);
      if (!res.ok) {
        // 403 here is usually quota exhaustion. Log and keep going: a partial
        // refresh is strictly better than none, and the engine degrades.
        console.warn(`TomTom ${res.status} for segment ${seg.id}`);
        failed++;
        continue;
      }

      const body = await res.json() as {
        flowSegmentData?: {
          currentSpeed: number; freeFlowSpeed: number; confidence: number;
        };
      };
      const f = body.flowSegmentData;
      if (!f) { failed++; continue; }

      await db.from('traffic_snapshots').insert({
        road_segment_id: seg.id,
        current_speed_kmh: f.currentSpeed,
        free_flow_kmh: f.freeFlowSpeed,
        confidence: f.confidence,
      });
      updated++;
    } catch (e) {
      console.warn(`traffic fetch failed for ${seg.id}: ${String(e)}`);
      failed++;
    }
  }

  // Keep the table from growing without bound; the engine only trusts samples
  // from the last 45 minutes anyway.
  await db.rpc('prune_traffic_snapshots', { p_keep_hours: 24 }).then(
    () => {}, () => {},
  );

  return json({ ok: true, segments: list.length, updated, failed });
});
