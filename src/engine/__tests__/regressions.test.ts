/**
 * Regression tests for defects found by the adversarial audit.
 *
 * Every test here corresponds to a bug that shipped while the 24 acceptance
 * tests were green. The common thread: those tests fed the engine hand-built
 * fixtures, so anything that only breaks when state round-trips through the
 * DATABASE was invisible. These assert the contract at that seam.
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../index.ts';
import { decideAlert } from '../stateMachine.ts';
import { isNight } from '../features.ts';
import { localHour } from '../time.ts';
import { timeOfDayMultiplier } from '../traffic.ts';
import { destination } from '../geo.ts';
import type { EnrichedContext, RiskStateRow, TelemetryInput } from '../types.ts';

const ROAD_LAT = 13.0;
const ROAD: Array<[number, number]> = [[ROAD_LAT, 77.50], [ROAD_LAT, 77.55], [ROAD_LAT, 77.60]];

function animalAt(m: number) {
  const [lat, lon] = destination(ROAD_LAT, 77.55, 180, m);
  return { lat, lon };
}

function makeInput(over: Partial<TelemetryInput> = {}): TelemetryInput {
  const p = animalAt(180);
  return {
    device_id: 'd', animal_id: 'a', lat: p.lat, lon: p.lon,
    speed_kmh: 4, heading_deg: 0, fix_quality: 3, hdop: 1, sats: 9,
    battery_pct: 80, movement_state: 2, event_code: 0, seq: 1,
    recorded_at: '2026-08-12T10:00:00Z', ...over,
  };
}

function makeCtx(over: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    nearest_road_id: 1, road_name: 'NH-48', road_class: 'trunk', base_risk: 5,
    distance_to_road: 180, bearing_to_road: 0,
    inside_zone: true, zone_id: 'z', zone_buffer_m: 30, distance_to_zone_edge: 200,
    zone_centre_lat: null, zone_centre_lon: null, zone_active: true,
    herd_centroid_lat: null, herd_centroid_lon: null,
    herd_median_dist: 40, distance_from_centroid: 30, separation_rate: 0,
    current_traffic_speed: null, free_flow_speed: null,
    traffic_confidence: null, traffic_is_stale: true,
    prior_approaches_to_this_road: 0, recent_fixes: [], road_line: ROAD, ...over,
  };
}

const emptyPrior = (o: Partial<RiskStateRow> = {}) => ({
  animal_id: 'a', state: 'safe', situation: 'normal',
  road_risk: 0, geofence_risk: 0, injury_risk: 0, p_reaches_road_5min: null,
  stationary_since: null, on_road_since: null, poor_fix_since: null,
  last_alert_at: null, last_alert_kind: null, last_alert_severity: null,
  active_alert_id: null, components: null, ...o,
}) as RiskStateRow;

// ===========================================================================
describe('REGRESSION: sustain clocks must survive the database round trip', () => {
  // Bug: deriveFeatures computed stationary_since/on_road_since, evaluate()
  // destructured only { features } and dropped them, and ingest never wrote
  // them. prior.stationary_since was permanently NULL, so the 60 s clock
  // restarted on every packet and stationary_on_road could NEVER become true.
  it('evaluate() returns the sustain clocks for persistence', () => {
    const out = evaluate(
      makeInput({ speed_kmh: 0.1 }), makeCtx({ distance_to_road: 3 }), null,
      { now: new Date('2026-08-12T10:00:00+05:30') },
    );
    expect(out.stationary_since).not.toBeNull();
    expect(out.on_road_since).not.toBeNull();
  });

  it('latches stationary_on_road when the clock is fed back in', () => {
    const t0 = new Date('2026-08-12T10:00:00+05:30');
    const ctx = makeCtx({ distance_to_road: 3 });

    // Packet 1 — starts the clock. Not yet sustained.
    const first = evaluate(makeInput({ speed_kmh: 0.1 }), ctx, null, { now: t0 });
    expect(first.situation).toBe('on_road');

    // Feed the returned clock back, exactly as ingest now does.
    const prior = emptyPrior({
      state: first.state, situation: first.situation,
      stationary_since: first.stationary_since, on_road_since: first.on_road_since,
    });

    const later = evaluate(
      makeInput({ speed_kmh: 0.1 }), ctx, prior,
      { now: new Date(t0.getTime() + 90_000) },
    );
    expect(later.situation).toBe('stationary_on_road');
    expect(later.road_risk).toBe(100);
  });

  it('a poor fix does not reset the clock', () => {
    const prior = emptyPrior({
      state: 'critical', situation: 'on_road',
      stationary_since: '2026-08-12T10:00:00Z', on_road_since: '2026-08-12T10:00:00Z',
    });
    const out = evaluate(
      makeInput({ hdop: 9, sats: 2, fix_quality: 1 }), makeCtx(), prior,
      { now: new Date('2026-08-12T10:02:00+05:30') },
    );
    expect(out.vetoed).toBe(true);
    // A cow does not stop lying on a road because one packet had bad HDOP.
    expect(out.stationary_since).toBe('2026-08-12T10:00:00Z');
  });
});

// ===========================================================================
describe('REGRESSION: night escalation must be reachable from on_road', () => {
  // Bug: on_road already pins state to `critical`, so the subsequent
  // on_road -> stationary_on_road transition was FLAT and returned early.
  // escalate_to_authority was unreachable by any real packet sequence.
  // The old test passed only by starting from `safe` with the clock pre-set.
  it('escalates to authority on the real on_road -> stationary sequence', () => {
    const night = new Date('2026-08-12T23:10:00+05:30');

    const d = decideAlert({
      prior: emptyPrior({ state: 'critical', situation: 'on_road' }),
      roadRisk: 100,
      situation: 'stationary_on_road',
      components: {} as never,
      roadName: 'NH-48', distanceM: 3, ttrSeconds: null, pReachesRoad: null,
      isNight: true, now: night,
    });

    expect(d.action).toBe('escalate_to_authority');
    expect(d.alert?.notify).toBe(true);
    expect(d.alert?.severity).toBe('critical');
  });

  it('still does not re-notify when the situation is genuinely unchanged', () => {
    const d = decideAlert({
      prior: emptyPrior({ state: 'critical', situation: 'stationary_on_road' }),
      roadRisk: 100, situation: 'stationary_on_road', components: {} as never,
      roadName: 'NH-48', distanceM: 3, ttrSeconds: null, pReachesRoad: null,
      isNight: true, now: new Date('2026-08-12T23:12:00+05:30'),
    });
    expect(d.alert).toBeNull(); // flat => silent, per §7.9
  });
});

// ===========================================================================
describe('REGRESSION: the 180 s cooldown must not be dead code', () => {
  // Bug: cooldownBlocks used `!severityIncreased`, which was textually
  // identical to `rising` and unreachable unless rising was already true —
  // so it was always false and the cooldown never blocked anything.
  it('blocks a same-severity repeat inside the window', () => {
    const now = new Date('2026-08-12T10:00:00+05:30');
    const d = decideAlert({
      prior: emptyPrior({
        state: 'watch', situation: 'approaching_road',
        last_alert_kind: 'road_risk', last_alert_severity: 'warning',
        last_alert_at: new Date(now.getTime() - 30_000).toISOString(),
      }),
      roadRisk: 66, situation: 'approaching_road', components: {} as never,
      roadName: 'NH-48', distanceM: 120, ttrSeconds: 90, pReachesRoad: 0.3,
      isNight: false, now,
    });
    expect(d.alert).toBeNull();      // suppressed
    expect(d.state).toBe('warning'); // but the state still advances
  });

  it('lets the same repeat through once the window has passed', () => {
    const now = new Date('2026-08-12T10:00:00+05:30');
    const d = decideAlert({
      prior: emptyPrior({
        state: 'watch', situation: 'approaching_road',
        last_alert_kind: 'road_risk', last_alert_severity: 'warning',
        last_alert_at: new Date(now.getTime() - 200_000).toISOString(),
      }),
      roadRisk: 66, situation: 'approaching_road', components: {} as never,
      roadName: 'NH-48', distanceM: 120, ttrSeconds: 90, pReachesRoad: 0.3,
      isNight: false, now,
    });
    expect(d.alert?.notify).toBe(true);
  });

  it('never blocks an escalation to a higher severity', () => {
    const now = new Date('2026-08-12T10:00:00+05:30');
    const d = decideAlert({
      prior: emptyPrior({
        state: 'warning', situation: 'approaching_road',
        last_alert_kind: 'road_risk', last_alert_severity: 'warning',
        last_alert_at: new Date(now.getTime() - 5_000).toISOString(),
        active_alert_id: 'alert-1',
      }),
      roadRisk: 95, situation: 'approaching_road', components: {} as never,
      roadName: 'NH-48', distanceM: 20, ttrSeconds: 12, pReachesRoad: 0.9,
      isNight: false, now,
    });
    expect(d.alert?.notify).toBe(true);
    expect(d.alert?.severity).toBe('critical');
  });
});

// ===========================================================================
describe('REGRESSION: time of day must be farm-local, not host-local', () => {
  // Bug: getHours() returns the HOST's hour. The Edge runtime is UTC, so
  // 02:00 IST was evaluated as 20:30 UTC — daytime. The most dangerous window
  // in the product was being read as one of the safest.
  it('reads 02:00 IST as night even though it is 20:30 UTC', () => {
    const d = new Date('2026-08-12T20:30:00Z'); // = 02:00 IST next day
    expect(localHour(d, 'Asia/Kolkata')).toBe(2);
    expect(isNight(d, 'Asia/Kolkata')).toBe(true);
    expect(timeOfDayMultiplier(d, 'Asia/Kolkata')).toBe(1.3);
  });

  it('reads 14:00 IST as day even though it is 08:30 UTC', () => {
    const d = new Date('2026-08-12T08:30:00Z'); // = 14:00 IST
    expect(localHour(d, 'Asia/Kolkata')).toBe(14);
    expect(isNight(d, 'Asia/Kolkata')).toBe(false);
    expect(timeOfDayMultiplier(d, 'Asia/Kolkata')).toBe(1.0);
  });

  it('falls back to UTC rather than throwing on a bad timezone', () => {
    const d = new Date('2026-08-12T20:30:00Z');
    expect(() => localHour(d, 'Not/AZone')).not.toThrow();
    expect(localHour(d, 'Not/AZone')).toBe(20);
  });
});

// ===========================================================================
describe('REGRESSION: Monte Carlo needs parsed fixes, not EWKB', () => {
  // Bug: ingest selected the raw geography column and matched it with
  // /POINT\(...\)/. PostgREST emits hex EWKB (0101000020E610...), so the
  // regex never matched, recent_fixes was always [], and the cone never ran.
  it('produces no probability when fixes are empty', () => {
    const out = evaluate(
      makeInput(), makeCtx({ distance_to_road: 60, recent_fixes: [] }), null,
      { now: new Date('2026-08-12T10:00:00+05:30') },
    );
    // Honest: null, not a fabricated number (§13.3).
    expect(out.p_reaches_road_5min).toBeNull();
    expect(out.cone.length).toBe(0);
  });

  it('produces a real probability once fixes are supplied as numbers', () => {
    const fixes = Array.from({ length: 10 }, (_, i) => {
      const p = animalAt(60 - i * 6);
      return {
        lat: p.lat, lon: p.lon,
        recorded_at: new Date(Date.parse('2026-08-12T09:58:00Z') + i * 11000).toISOString(),
      };
    });
    const out = evaluate(
      makeInput(), makeCtx({ distance_to_road: 60, recent_fixes: fixes }), null,
      { now: new Date('2026-08-12T10:00:00+05:30'), seed: 42 },
    );
    expect(out.p_reaches_road_5min).not.toBeNull();
    expect(out.cone.length).toBe(500);
  });
});
