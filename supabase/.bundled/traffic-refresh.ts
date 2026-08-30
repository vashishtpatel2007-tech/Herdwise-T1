// supabase/functions/traffic-refresh/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return json({ error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  const tomtomKey = Deno.env.get("TOMTOM_API_KEY");
  if (!tomtomKey) {
    console.warn("TOMTOM_API_KEY not set — engine will use the time-of-day fallback model");
    return json({ ok: true, skipped: true, reason: "no_api_key", updated: 0 });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: segments, error } = await db.rpc("segments_near_active_zones", { p_radius_m: 3e3 });
  if (error) return json({ error: error.message }, 500);
  const list = segments ?? [];
  let updated = 0;
  let failed = 0;
  for (const seg of list) {
    try {
      const endpoint = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${tomtomKey}&point=${seg.lat},${seg.lon}&unit=KMPH`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        console.warn(`TomTom ${res.status} for segment ${seg.id}`);
        failed++;
        continue;
      }
      const body = await res.json();
      const f = body.flowSegmentData;
      if (!f) {
        failed++;
        continue;
      }
      await db.from("traffic_snapshots").insert({
        road_segment_id: seg.id,
        current_speed_kmh: f.currentSpeed,
        free_flow_kmh: f.freeFlowSpeed,
        confidence: f.confidence
      });
      updated++;
    } catch (e) {
      console.warn(`traffic fetch failed for ${seg.id}: ${String(e)}`);
      failed++;
    }
  }
  await db.rpc("prune_traffic_snapshots", { p_keep_hours: 24 }).then(
    () => {
    },
    () => {
    }
  );
  return json({ ok: true, segments: list.length, updated, failed });
});
