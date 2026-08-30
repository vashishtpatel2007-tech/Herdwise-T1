/**
 * Edge Function: ingest
 *
 * The single entry point for collar telemetry.
 *
 * PIPELINE (EDGE COMPUTING):
 * 1. authenticate
 * 2. store raw telemetry
 * 3. persist collar's local engine state directly to risk_state
 * 4. queue downlink commands
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { shouldRaiseGpsFault } from '../_shared/engine/veto.ts';
import type { RiskStateRow, TelemetryInput } from '../_shared/engine/types.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let db;
  try {
    db = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
    const expected = requireEnv('DEVICE_INGEST_SECRET');
    const presented = req.headers.get('x-device-secret') ?? '';
    if (!safeEqual(presented, expected)) return json({ error: 'unauthorized' }, 401);
  } catch (e) {
    console.error(String(e));
    return json({ error: String(e) }, 500);
  }

  const packet = (await req.json()) as TelemetryInput;
  const now = new Date();

  // ---- Resolve device -> animal -------------------------------------------
  const { data: device } = await db
    .from('devices')
    .select('id, animal_id, is_enabled, steering_on, mute_until, live_until, animals(farmer_id)')
    .eq('device_key', packet.device_id)
    .maybeSingle();

  if (!device?.animal_id) return json({ error: 'unknown device' }, 404);

  const animal_id = device.animal_id as string;
  const farmer_id = (device.animals as { farmer_id: string } | null)?.farmer_id ?? null;

  // ---- Collar state (downlink) -------------------------------------------
  const muted = device.mute_until ? new Date(device.mute_until as string) > now : false;
  const live = device.live_until ? new Date(device.live_until as string) > now : false;
  const collarOn = device.is_enabled !== false;
  const steeringEnabled = collarOn && device.steering_on !== false && !muted;

  const { data: commands } = await db.rpc('pop_commands', { p_device_id: device.id });

  /**
   * Reporting cadence, decided server-side so the rate can be retuned
   * without reflashing the collar.
   *
   * The collar clamps this to a 2 s floor -- one GSM POST costs ~1.5-2 s of
   * round trip, so nothing below that buys a faster screen, it only removes
   * the idle gap between transmissions.
   *
   * These are TESTING values: fast everywhere, because right now the point
   * is watching the pipeline move. For real deployment the idle case should
   * go back up (30-600 s) -- at 2 s this is ~1800 rows/hour and keeps the
   * modem almost permanently awake, which costs both data and battery.
   */
  function nextIntervalS(): number {
    if (live) return 2;
    if (!collarOn) return 10;
    if ((packet.speed_kmh ?? 0) > 1.5) return 2;
    return 3;
  }

  // ---- GPS veto -----------------------------------------------------
  const poorFix = packet.fix_quality < 2 || packet.hdop > 5 || packet.sats < 3;

  // The GSM collar has no clock of its own, so it does not send recorded_at.
  // `telemetry.recorded_at` is NOT NULL, so passing undefined made every
  // single insert fail -- silently, because the error below was not checked.
  // Receipt time is the honest stamp here: the packet is posted the moment
  // it is read, so server time is within seconds of the actual reading.
  const recordedAt = packet.recorded_at ?? now.toISOString();

  const { error: telErr } = await db.from('telemetry').upsert({
    device_id: device.id,
    animal_id,
    position: `SRID=4326;POINT(${packet.lon} ${packet.lat})`,
    speed_kmh: packet.speed_kmh,
    heading_deg: Math.round(((packet.heading_deg % 360) + 360) % 360),
    fix_quality: packet.fix_quality,
    hdop: packet.hdop,
    sats: packet.sats,
    battery_pct: packet.battery_pct ?? null,
    movement_state: packet.movement_state,
    event_code: packet.event_code,
    seq: packet.seq,
    poor_fix: poorFix,
    // Calibrated dynamic acceleration from the collar's MPU6050. Independent
    // of GPS, so it stays meaningful even while the fix is still searching.
    accel_g: packet.acceleration ?? null,
    recorded_at: recordedAt,
  }, { onConflict: 'device_id,seq,recorded_at', ignoreDuplicates: true });

  // Never swallow this. A failed telemetry write with an ok:true response is
  // invisible from the collar AND from the dashboard -- the device reports
  // "data reached Supabase" while nothing is stored and every live screen
  // sits empty. Fail loudly instead.
  if (telErr) {
    console.error(`telemetry upsert failed for ${animal_id}: ${telErr.message}`);
    return json({ error: `telemetry write failed: ${telErr.message}` }, 500);
  }

  await db.from('devices')
    .update({ battery_pct: packet.battery_pct ?? null, last_seen_at: now.toISOString() })
    .eq('id', device.id);

  const { data: priorRow } = await db
    .from('risk_state').select('*').eq('animal_id', animal_id).maybeSingle();
  const prior = (priorRow ?? null) as RiskStateRow | null;

  // Maintain boundary_pts in risk_state components so UI can confirm downlink receipt
  let updatedComponents = prior?.components ?? {};
  if (packet.boundary_pts !== undefined) {
    updatedComponents = { ...updatedComponents, boundary_pts: packet.boundary_pts, boundary_hash: packet.boundary_hash };
  }

  // Acknowledge successfully processed commands
  if (Array.isArray(packet.acked) && packet.acked.length > 0) {
    await db.from('device_commands')
      .update({ acked_at: now.toISOString() })
      .in('id', packet.acked);
  }

  if (poorFix) {
    const poor_fix_since = prior?.poor_fix_since ?? now.toISOString();

    // A vetoed fix must CLEAR the spatial numbers, not leave the last good
    // ones sitting there. Previously this branch only wrote poor_fix_since
    // and returned, so geofence_risk / boundary_distance / state kept their
    // last values forever -- the dashboard went on showing a risk score and
    // a boundary distance from minutes ago as though they were current,
    // while the collar itself was reporting NO_GPS. That is the worst kind
    // of wrong: not blank, but confidently stale.
    //
    // The collar's own engine is already honest here (risk 0, state
    // WAITING, type NO_GPS), so write ITS truth through rather than
    // inventing or preserving anything.
    // risk_state.state is a CHECK-constrained RISK LADDER
    // (safe|watch|warning|high|critical). The collar's own "WAITING" is a
    // DEVICE status, not a risk level -- writing it straight through failed
    // the constraint and, because the result was not checked, failed
    // silently and left the stale row in place.
    //
    // With no fix we cannot claim ANY risk level, so the ladder sits at its
    // floor; the truth that we do not know where she is lives in
    // situation='device_fault' and risk_type below, which is what the app
    // actually colours the animal red from.
    const VALID_STATES = ['safe', 'watch', 'warning', 'high', 'critical'];
    const reportedState = (packet.state || '').toLowerCase();
    const vetoedState = VALID_STATES.includes(reportedState) ? reportedState : 'safe';

    const vetoedFields = {
      animal_id,
      poor_fix_since,
      state: vetoedState,
      situation: 'device_fault',
      // Unknown, not zero-risk: with no fix we cannot place her at all.
      geofence_risk: 0,
      road_risk: 0,
      p_reaches_road_5min: null,
      components: {
        ...updatedComponents,
        // null, never a stale number -- distance is unknowable without a fix.
        boundary_distance: null,
        buzzer_on: packet.buzzer_on ?? false,
        risk_type: packet.risk_type ?? 'NO_GPS',
        reason: 'gps veto',
        fix_quality: packet.fix_quality,
        hdop: packet.hdop,
        sats: packet.sats,
        vibration_on: packet.vibration_on ?? false,
      },
      updated_at: now.toISOString(),
    };

    let vetoErr;

    if (shouldRaiseGpsFault(poor_fix_since, prior?.last_alert_at ?? null, now)) {
      await db.from('alerts').insert({
        animal_id, farmer_id,
        kind: 'gps_fault', severity: 'warning',
        message: 'alert.gps_fault',
        components: { fix_quality: packet.fix_quality, hdop: packet.hdop, sats: packet.sats },
      });
      ({ error: vetoErr } = await db.from('risk_state').upsert({
        ...vetoedFields,
        last_alert_at: now.toISOString(), last_alert_kind: 'gps_fault',
      }));
    } else {
      ({ error: vetoErr } = await db.from('risk_state').upsert(vetoedFields));
    }

    if (vetoErr) {
      console.error(`risk_state (gps veto) upsert failed for ${animal_id}: ${vetoErr.message}`);
      return json({ error: `risk_state write failed: ${vetoErr.message}` }, 500);
    }

    return json({
      ok: true, vetoed: true, reason: 'poor gps fix',
      enabled: collarOn, steering: false,
      cue: { active: false, pattern: 'none', side: null, intensity: 0 },
      commands: commands ?? [],
      // NOT a hardcoded 60. A collar still searching for satellites takes
      // this branch on EVERY packet, so a fixed 60 s here silently pinned
      // the whole device to one-minute reporting -- and made downlink
      // commands take up to a minute to arrive, which is precisely when
      // you are watching and wondering why nothing happens.
      next_interval_s: nextIntervalS(),
    });
  }

  if (!collarOn) {
    await db.from('risk_state').upsert({
      animal_id, state: 'safe', situation: 'normal',
      road_risk: 0, geofence_risk: 0, p_reaches_road_5min: null,
      stationary_since: null, on_road_since: null, active_alert_id: null,
      components: { ...updatedComponents, collar_disabled: true },
      updated_at: now.toISOString(),
    });
    return json({
      ok: true, enabled: false, steering: false,
      cue: { active: false, pattern: 'none', side: null, intensity: 0 },
      commands: commands ?? [],
      next_interval_s: nextIntervalS(),
    });
  }

  // ---- LOCAL ENGINE PASSTHROUGH -----------------------------------------

  const collarState = packet.state || 'SAFE';
  const riskScore = packet.risk_score || 0;

  // Same CHECK-constraint guard as the veto branch, and it is NOT optional
  // here. risk_state.state allows only safe|watch|warning|high|critical.
  // The collar's vocabulary is SAFE / WARNING / HIGH_RISK / WAITING, so a
  // raw .toLowerCase() yields "high_risk" -- which violates the constraint,
  // fails the upsert, and returns 500 to the collar. That fires the moment
  // the animal is at real risk with a good fix: exactly the demo case.
  const VALID_STATES_MAIN = ['safe', 'watch', 'warning', 'high', 'critical'];
  const mappedState = collarState.toLowerCase();
  const storedState = mappedState === 'high_risk'
    ? 'high'
    : VALID_STATES_MAIN.includes(mappedState) ? mappedState : 'safe';

  const { error: stateErr } = await db.from('risk_state').upsert({
    animal_id,
    state: storedState,
    situation: collarState === 'SAFE' ? 'normal' : 'outside_zone',
    road_risk: 0,
    geofence_risk: riskScore,
    injury_risk: 0,
    p_reaches_road_5min: null,
    poor_fix_since: null,
    components: {
      ...updatedComponents,
      boundary_distance: packet.boundary_distance ?? null,
      buzzer_on: packet.buzzer_on ?? false,
      // The collar classifies this itself (PERIMETER / HIGH_TRAFFIC_ROAD /
      // NO_GPS / SAFE). The dashboard used to hardcode "GEOFENCE" for every
      // reading regardless -- a label that was right by luck, not by data.
      risk_type: packet.risk_type ?? null,
      vibration_on: packet.vibration_on ?? false,
    },
    cone: null,
    stationary_since: null,
    on_road_since: null,
    active_alert_id: null,
    updated_at: now.toISOString(),
  });

  if (stateErr) {
    console.error(`risk_state upsert failed for ${animal_id}: ${stateErr.message}`);
    return json({ error: `risk_state write failed: ${stateErr.message}` }, 500);
  }

  // ---- The downlink. This response IS the collar's instruction set. ------
  return json({
    ok: true,
    enabled: true,
    steering: steeringEnabled,
    road_risk: 0,
    state: storedState,
    situation: collarState === 'SAFE' ? 'normal' : 'outside_zone',
    p_reaches_road_5min: 0,
    action: collarState === 'HIGH_RISK' ? 'shock' : collarState === 'WARNING' ? 'buzz' : 'none',
    notified: false,
    cue: {
      active: packet.buzzer_on || false,
      side: null,
      pattern: 'default',
      intensity: 100,
      reason: 'geofence',
      target_bearing: null,
    },
    commands: commands ?? [],
    next_interval_s: nextIntervalS(),
  });
});
