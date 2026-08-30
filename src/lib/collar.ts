/**
 * Collar control — the downlink, from the farmer's side.
 *
 * Two mechanisms, deliberately different:
 *
 *   STATE  (on/off, steering, mute, live) is written to the `devices` row.
 *          It is durable: a collar that has been off for a day is still off
 *          when it finally gets a link.
 *
 *   COMMANDS (beep, locate, zone push) go into `device_commands` and expire
 *          after two minutes. A "beep now" that arrives ten minutes late is
 *          worse than useless — the farmer has walked off and the beep just
 *          startles the animal.
 *
 * Both are delivered on the ingest RESPONSE, so nothing here opens a second
 * connection to a battery-powered device.
 */

import { supabase } from './supabase.ts';

export type CollarCommand =
  | 'set_enabled' | 'set_steering' | 'beep' | 'vibrate'
  | 'steer' | 'locate' | 'set_interval' | 'set_zone' | 'mute';

export interface CollarState {
  device_id: string;
  device_key: string;
  is_enabled: boolean;
  steering_on: boolean;
  mute_until: string | null;
  live_until: string | null;
  battery_pct: number | null;
  last_seen_at: string | null;
}

export async function getCollar(animalId: string): Promise<CollarState | null> {
  const { data } = await supabase
    .from('devices')
    .select('id, device_key, is_enabled, steering_on, mute_until, live_until, battery_pct, last_seen_at')
    .eq('animal_id', animalId)
    .maybeSingle();
  if (!data) return null;
  return {
    device_id: data.id as string,
    device_key: data.device_key as string,
    is_enabled: data.is_enabled !== false,
    steering_on: data.steering_on !== false,
    mute_until: (data.mute_until as string) ?? null,
    live_until: (data.live_until as string) ?? null,
    battery_pct: (data.battery_pct as number) ?? null,
    last_seen_at: (data.last_seen_at as string) ?? null,
  };
}

async function queue(deviceId: string, command: CollarCommand, payload: object = {}) {
  const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
  return supabase.from('device_commands').insert({
    device_id: deviceId, command, payload, issued_by: farmer?.id ?? null,
  });
}

/**
 * Switch the whole collar off — the "moving the herd" case.
 *
 * Off means: no steering, no geofence, no road alerts. Position reporting
 * CONTINUES, because the farmer still wants to see where the animals are
 * while he walks them down the road. Turning off tracking too would mean
 * losing an animal precisely when the herd is strung out along a lane.
 */
export async function setCollarEnabled(deviceId: string, enabled: boolean) {
  await supabase.from('devices').update({ is_enabled: enabled }).eq('id', deviceId);
  return queue(deviceId, 'set_enabled', { enabled });
}

/** Keep the fence and alerts, but stop the collar cueing the animal. */
export async function setSteering(deviceId: string, on: boolean) {
  await supabase.from('devices').update({ steering_on: on }).eq('id', deviceId);
  return queue(deviceId, 'set_steering', { on });
}

/** Silence cues for a while without disarming the whole system. */
export async function muteFor(deviceId: string, minutes: number) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase.from('devices').update({ mute_until: until }).eq('id', deviceId);
  return queue(deviceId, 'mute', { until });
}

/**
 * §8 — "farmer requested live" drops the collar to 5-second reporting.
 * Time-boxed, because 5 s reporting flattens the battery in hours.
 */
export async function requestLive(deviceId: string, minutes = 10) {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  await supabase.from('devices').update({ live_until: until }).eq('id', deviceId);
  return queue(deviceId, 'set_interval', { seconds: 5, until });
}

/** Make it beep so the farmer can find the animal in tall grass or at dusk. */
export async function beep(deviceId: string, seconds = 3) {
  return queue(deviceId, 'locate', { seconds });
}

/** Manual steer, for testing the hardware against the app. */
export async function steerTest(
  deviceId: string, side: 'left' | 'right' | 'both', seconds = 3,
) {
  return queue(deviceId, 'steer', { side, seconds, intensity: 2 });
}

/** Recent command history, so the farmer can see whether it actually landed. */
export async function commandHistory(deviceId: string, limit = 20) {
  const { data } = await supabase
    .from('device_commands')
    .select('id, command, payload, created_at, delivered_at, acked_at, expires_at')
    .eq('device_id', deviceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data ?? [];
}
