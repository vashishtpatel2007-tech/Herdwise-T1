/**
 * §11 — critical alerts trigger an automated VOICE CALL, not only a push.
 *
 * A notification in a shirt pocket in a noisy field is missed. A ringing phone
 * is not. This is behind an interface so any telephony provider plugs in
 * (Exotel and Twilio are the realistic options in India; Exotel has better
 * rural termination and local numbers).
 *
 * Nothing here dials from the browser. The browser records the INTENT; the
 * actual call is placed server-side, because the provider credentials must
 * never reach the client and because the call has to happen whether or not the
 * farmer's phone currently has the app open.
 */

import { supabase } from './supabase.ts';

export type CallReason =
  | 'stationary_on_road'
  | 'on_road'
  | 'fall'
  | 'critical_road_risk';

export interface VoiceCallRequest {
  farmer_phone: string;
  /** Spoken in the farmer's own language (§11). */
  language: 'en' | 'hi' | 'kn';
  animal_name: string;
  road_name: string | null;
  reason: CallReason;
}

export interface TelephonyProvider {
  name: string;
  placeCall(req: VoiceCallRequest): Promise<{ ok: boolean; detail?: string }>;
}

/**
 * Default provider: hand off to an Edge Function that holds the credentials.
 * Swapping providers means changing that function, not this file.
 */
export const edgeFunctionProvider: TelephonyProvider = {
  name: 'edge-function',
  async placeCall(req) {
    const { data, error } = await supabase.functions.invoke('voice-call', { body: req });
    if (error) return { ok: false, detail: error.message };
    return { ok: true, detail: JSON.stringify(data) };
  },
};

/**
 * Development provider. Logs instead of dialling.
 *
 * Deliberately loud: a silent no-op here would make a missing telephony
 * integration look like a working one during a demo, which is exactly the
 * class of dishonesty §13 exists to prevent.
 */
export const consoleProvider: TelephonyProvider = {
  name: 'console',
  async placeCall(req) {
    console.warn(
      `[telephony] NO PROVIDER CONFIGURED — would have called ${req.farmer_phone} ` +
      `in ${req.language} about ${req.animal_name} (${req.reason})`,
    );
    return { ok: false, detail: 'no provider configured' };
  },
};

let active: TelephonyProvider = consoleProvider;

export function setTelephonyProvider(p: TelephonyProvider) { active = p; }
export function getTelephonyProvider(): TelephonyProvider { return active; }

/**
 * Quiet hours never suppress a critical alert (§9.6). An animal standing on a
 * highway at 2am is precisely when the farmer is asleep and precisely when he
 * most needs waking.
 */
export function shouldPlaceCall(
  severity: 'warning' | 'high' | 'critical',
  quietHoursActive: boolean,
): boolean {
  if (severity === 'critical') return true;
  return !quietHoursActive && severity === 'high';
}

export async function placeCriticalCall(req: VoiceCallRequest) {
  return active.placeCall(req);
}
