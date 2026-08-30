/**
 * §9.3 — the danger screen takes over the display.
 *
 * This is the piece that makes DangerScreen real rather than a component
 * nobody renders. It listens for alerts the ENGINE decided to notify about and
 * hoists the most severe one over everything else.
 *
 * It deliberately does NOT re-derive severity from risk_state. The alert state
 * machine (§7.9) already decided what deserves an interruption, applying
 * hysteresis, cooldown and escalation. Second-guessing that here would
 * reintroduce the alert fatigue those mechanisms exist to prevent.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { DangerScreen, type DangerInfo } from '../screens/DangerScreen.tsx';
import { placeCriticalCall, shouldPlaceCall } from '../lib/telephony.ts';

interface AlertRow {
  id: string;
  animal_id: string;
  kind: string;
  severity: 'warning' | 'high' | 'critical';
  road_name: string | null;
  distance_m: number | null;
  ttr_seconds: number | null;
  p_reaches_road_5min: number | null;
  components: Record<string, unknown> | null;
  message: string | null;
  notified: boolean;
  resolved_at: string | null;
  created_at: string;
}

/** Only these interrupt. A `warning` colours the map; it does not seize it. */
const TAKEOVER = new Set(['high', 'critical']);

function quietHoursActive(): boolean {
  const raw = localStorage.getItem('pashuguard.quietHours');
  if (!raw) return false;
  try {
    const { from, to } = JSON.parse(raw) as { from: number; to: number };
    const h = new Date().getHours();
    return from <= to ? h >= from && h < to : h >= from || h < to;
  } catch { return false; }
}

export function DangerHost() {
  const [info, setInfo] = useState<DangerInfo | null>(null);
  /** Alerts already shown, so a re-render or reconnect does not re-interrupt. */
  const seen = useRef<Set<string>>(new Set());
  const dismissed = useRef<Set<string>>(new Set());

  const present = useCallback(async (a: AlertRow) => {
    if (!a.notified || a.resolved_at) return;
    if (!TAKEOVER.has(a.severity)) return;
    if (seen.current.has(a.id) || dismissed.current.has(a.id)) return;
    seen.current.add(a.id);

    const [{ data: animal }, { data: farmer }] = await Promise.all([
      supabase.from('animals').select('name').eq('id', a.animal_id).maybeSingle(),
      supabase.from('farmers').select('phone, language').maybeSingle(),
    ]);

    const { data: helper } = await supabase
      .from('helpers').select('phone').eq('receives_critical', true).limit(1).maybeSingle();

    const situation =
      a.message === 'alert.stationary_on_road' ? 'stationary_on_road'
      : a.message === 'alert.on_road' ? 'on_road'
      : a.message === 'alert.outside_zone' ? 'outside_zone'
      : 'approaching_road';

    const c = (a.components ?? {}) as Record<string, number | boolean>;

    setInfo({
      animalId: a.animal_id,
      animalName: animal?.name ?? '—',
      situation,
      roadName: a.road_name,
      distanceM: a.distance_m,
      ttrSeconds: a.ttr_seconds,
      probability: a.p_reaches_road_5min,
      bearingDeg: null,
      // collision_risk high => fast traffic; that is the fatality case (§6).
      trafficFast: typeof c.traffic_f === 'number' ? c.traffic_f > 0.5 : false,
      trafficFallback: c.traffic_fallback === true,
      helperPhone: (helper?.phone as string) ?? (farmer?.phone as string) ?? null,
    });

    // §11 — a ringing phone is not missed the way a notification is.
    if (shouldPlaceCall(a.severity, quietHoursActive()) && farmer?.phone) {
      void placeCriticalCall({
        farmer_phone: farmer.phone as string,
        language: (farmer.language as 'en' | 'hi' | 'kn') ?? 'en',
        animal_name: animal?.name ?? '',
        road_name: a.road_name,
        reason: situation === 'stationary_on_road' ? 'stationary_on_road'
              : situation === 'on_road' ? 'on_road' : 'critical_road_risk',
      });
    }
  }, []);

  useEffect(() => {
    // Catch anything raised while the app was closed — a critical alert must
    // not be lost just because the phone was in a pocket.
    void (async () => {
      const { data } = await supabase
        .from('alerts').select('*')
        .is('resolved_at', null).eq('notified', true)
        .in('severity', ['high', 'critical'])
        // Bound the catch-up. Without this, an unresolved alert from days ago
        // seized the whole screen on every app open, presented as if it were
        // happening now — a §13.1 violation on the most urgent surface there is.
        .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
        .order('created_at', { ascending: false }).limit(1);
      if (data?.[0]) void present(data[0] as AlertRow);
    })();

    const ch = supabase
      .channel('danger')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' },
        (payload) => void present(payload.new as AlertRow))
      // The engine RESOLVES an alert with an UPDATE, not an insert. Without
      // this the takeover screen stayed up forever after the animal was safe
      // again — the farmer had to dismiss a danger that no longer existed.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts' },
        (payload) => {
          const row = payload.new as AlertRow;
          setInfo((cur) => (cur && row.resolved_at && row.animal_id === cur.animalId
            ? null
            : cur));
        })
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [present]);

  if (!info) return null;

  return (
    <DangerScreen
      info={info}
      onDismiss={() => {
        // Remember the dismissal so it does not immediately re-fire; the
        // engine will raise a NEW alert if the situation escalates further.
        for (const id of seen.current) dismissed.current.add(id);
        setInfo(null);
      }}
    />
  );
}
