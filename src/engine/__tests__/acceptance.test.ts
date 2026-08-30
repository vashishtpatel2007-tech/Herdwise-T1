/**
 * §15 "Done means" — executable acceptance criteria.
 *
 * Each block below corresponds to a scenario flag in §8 and asserts the exact
 * stated outcome. These are the tests that decide whether the engine is
 * correct; everything else is decoration.
 */

import { describe, it, expect } from 'vitest';
import { evaluate } from '../index.ts';
import { detectFall, type ImuSample } from '../fall.ts';
import { decideAlert, nextState } from '../stateMachine.ts';
import { destination, haversine } from '../geo.ts';
import type { EnrichedContext, RiskStateRow, TelemetryInput } from '../types.ts';

// ---------------------------------------------------------------------------
// Fixtures: an east–west highway, with the animal placed south of it so that
// "north" (bearing 0) is always the direction of the road.
// ---------------------------------------------------------------------------
const ROAD_LAT = 13.0;
const ROAD: Array<[number, number]> = [
  [ROAD_LAT, 77.50], [ROAD_LAT, 77.55], [ROAD_LAT, 77.60],
];
const START_LON = 77.55;

function animalAt(metresSouthOfRoad: number): { lat: number; lon: number } {
  const [lat, lon] = destination(ROAD_LAT, START_LON, 180, metresSouthOfRoad);
  return { lat, lon };
}

function makeInput(over: Partial<TelemetryInput> = {}): TelemetryInput {
  const p = animalAt(180);
  return {
    device_id: 'dev-1', animal_id: 'animal-1',
    lat: p.lat, lon: p.lon,
    speed_kmh: 4.0, heading_deg: 0, // heading north = straight at the road
    fix_quality: 3, hdop: 1.1, sats: 9, battery_pct: 80,
    movement_state: 2, event_code: 0, seq: 1,
    recorded_at: '2026-08-11T10:00:00Z',
    ...over,
  };
}

/** Build a fix history walking north toward the road at ~1.1 m/s. */
function northwardFixes(startM: number, n = 10, stepM = 12): EnrichedContext['recent_fixes'] {
  const out: EnrichedContext['recent_fixes'] = [];
  const t0 = new Date('2026-08-11T09:58:00Z').getTime();
  for (let i = 0; i < n; i++) {
    const p = animalAt(startM - i * stepM);
    out.push({ lat: p.lat, lon: p.lon, recorded_at: new Date(t0 + i * 11000).toISOString() });
  }
  return out;
}

/** Build a fix history walking east, parallel to the road, at a fixed offset. */
function parallelFixes(offsetM: number, n = 10, stepM = 12): EnrichedContext['recent_fixes'] {
  const out: EnrichedContext['recent_fixes'] = [];
  const t0 = new Date('2026-08-11T09:58:00Z').getTime();
  const base = animalAt(offsetM);
  for (let i = 0; i < n; i++) {
    const [lat, lon] = destination(base.lat, base.lon, 90, i * stepM);
    out.push({ lat, lon, recorded_at: new Date(t0 + i * 11000).toISOString() });
  }
  return out;
}

function makeCtx(over: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    nearest_road_id: 1, road_name: 'NH-48', road_class: 'trunk', base_risk: 5,
    distance_to_road: 180,
    bearing_to_road: 0, // road is due north of the animal
    inside_zone: true, zone_id: 'zone-1', zone_buffer_m: 30,
    distance_to_zone_edge: 200,
    zone_centre_lat: null, zone_centre_lon: null, zone_active: true,
    herd_centroid_lat: null, herd_centroid_lon: null,
    herd_median_dist: 40, distance_from_centroid: 30,
    separation_rate: 0,
    current_traffic_speed: null, free_flow_speed: null,
    traffic_confidence: null, traffic_is_stale: true,
    prior_approaches_to_this_road: 0,
    recent_fixes: northwardFixes(180),
    road_line: ROAD,
    ...over,
  };
}

const DAY = new Date('2026-08-11T10:00:00+05:30'); // 10:00 local
const NIGHT = new Date('2026-08-11T23:00:00+05:30'); // 23:00 local

// ===========================================================================
describe('§7.2 GPS veto — bad-gps produces a DEVICE alert, never an animal alert', () => {
  it('skips risk evaluation entirely on a poor fix', () => {
    const out = evaluate(
      makeInput({ hdop: 8, sats: 3, fix_quality: 1 }),
      makeCtx({ distance_to_road: 5 }), // would otherwise be on_road => critical
      null,
      { now: DAY },
    );

    expect(out.vetoed).toBe(true);
    expect(out.situation).toBe('device_fault');
    // The decisive assertion: no animal alert despite being 5 m from a highway.
    expect(out.alert).toBeNull();
    expect(out.action).toBe('none');
  });

  it('does not downgrade an animal who was already in trouble', () => {
    const prior = { state: 'critical', road_risk: 100 } as RiskStateRow;
    const out = evaluate(
      makeInput({ hdop: 9, sats: 2, fix_quality: 0 }), makeCtx(), prior, { now: DAY },
    );
    expect(out.state).toBe('critical'); // prior state preserved, not reset to safe
  });

  it('accepts a good fix', () => {
    expect(evaluate(makeInput(), makeCtx(), null, { now: DAY }).vetoed).toBe(false);
  });
});

// ===========================================================================
describe('§7.3 parallel-walk — MUST NOT alert', () => {
  const ctx = makeCtx({
    distance_to_road: 45,
    recent_fixes: parallelFixes(45),
  });

  it('computes zero closing speed when walking parallel', () => {
    const out = evaluate(
      makeInput({ heading_deg: 90, speed_kmh: 5.4 }), ctx, null, { now: DAY },
    );
    expect(out.components.closing).toBeCloseTo(0, 5);
    expect(out.ttr_seconds).toBeNull(); // never extrapolate a parallel walker
  });

  it('produces ZERO alerts across 30 minutes of parallel walking', () => {
    let prior: RiskStateRow | null = null;
    let notifications = 0;

    // 30 minutes at the 15 s "heading toward a road" cadence = 120 evaluations.
    for (let i = 0; i < 120; i++) {
      const now = new Date(DAY.getTime() + i * 15_000);
      const out = evaluate(
        makeInput({ heading_deg: 90, speed_kmh: 5.4, seq: i }), ctx, prior, { now },
      );
      if (out.alert?.notify) notifications++;
      prior = { ...(prior ?? {}), ...out, animal_id: 'animal-1' } as RiskStateRow;
    }

    expect(notifications).toBe(0);
  });

  it('still alerts when the same animal turns toward the road', () => {
    const out = evaluate(
      makeInput({ heading_deg: 0, speed_kmh: 5.4 }),
      makeCtx({ distance_to_road: 45, recent_fixes: northwardFixes(45, 10, 8) }),
      null, { now: DAY },
    );
    expect(out.ttr_seconds).not.toBeNull();
    expect(out.road_risk).toBeGreaterThanOrEqual(65);
  });
});

// ===========================================================================
describe('§7.4 on-road states', () => {
  it('stationary-on-road goes CRITICAL within one reporting interval', () => {
    const ctx = makeCtx({ distance_to_road: 3 });
    // First packet: on the road, still. Starts the 60 s sustain clock.
    const t0 = new Date(DAY.getTime());
    let out = evaluate(makeInput({ speed_kmh: 0.1, lat: animalAt(3).lat }), ctx, null, { now: t0 });
    expect(out.situation).toBe('on_road');
    expect(out.road_risk).toBe(95);
    expect(out.state).toBe('critical');

    // 90 s later, still still => stationary_on_road.
    const prior = {
      ...out, stationary_since: t0.toISOString(), animal_id: 'a',
    } as unknown as RiskStateRow;
    out = evaluate(
      makeInput({ speed_kmh: 0.1 }), ctx, prior, { now: new Date(t0.getTime() + 90_000) },
    );
    expect(out.situation).toBe('stationary_on_road');
    expect(out.road_risk).toBe(100);
    expect(out.state).toBe('critical');
  });

  it('night-on-road escalates to the authority', () => {
    const ctx = makeCtx({ distance_to_road: 3 });
    const t0 = NIGHT;
    const prior = {
      state: 'safe', stationary_since: new Date(t0.getTime() - 90_000).toISOString(),
    } as RiskStateRow;

    const out = evaluate(makeInput({ speed_kmh: 0.05 }), ctx, prior, { now: t0 });
    expect(out.situation).toBe('stationary_on_road');
    expect(out.action).toBe('escalate_to_authority');
  });

  it('an on-road animal scores high despite zero closing speed', () => {
    // The failure mode this override exists to fix: distance 0, closing 0,
    // TTR undefined — a naive approach-model scores the deadliest state at ~0.
    const out = evaluate(
      makeInput({ speed_kmh: 0 }), makeCtx({ distance_to_road: 2 }), null, { now: DAY },
    );
    expect(out.components.closing).toBe(0);
    expect(out.road_risk).toBeGreaterThanOrEqual(95);
  });
});

// ===========================================================================
describe('§7.9 threshold-oscillation — MUST produce exactly ONE notification', () => {
  it('hysteresis holds state while risk hovers at 63–67', () => {
    let prior = { state: 'safe', last_alert_at: null, last_alert_kind: null,
                  active_alert_id: null } as RiskStateRow;
    let notifications = 0;
    const seq = [63, 67, 64, 66, 63, 67, 65, 64, 66, 63, 67, 64];

    seq.forEach((risk, i) => {
      const now = new Date(DAY.getTime() + i * 50_000);
      const d = decideAlert({
        prior, roadRisk: risk, situation: 'approaching_road',
        components: {} as never, roadName: 'NH-48', distanceM: 120,
        ttrSeconds: 90, pReachesRoad: 0.3, isNight: false, now,
      });
      if (d.alert?.notify) notifications++;
      prior = { ...prior, state: d.state,
        last_alert_at: d.alert ? now.toISOString() : prior.last_alert_at,
        last_alert_kind: d.alert ? d.alert.kind : prior.last_alert_kind };
    });

    expect(notifications).toBe(1);
  });

  it('never leaves warning until risk drops below 45', () => {
    expect(nextState('warning', 64, 'approaching_road')).toBe('warning');
    expect(nextState('warning', 46, 'approaching_road')).toBe('warning');
    // Below 45 it leaves warning, but lands in `watch` rather than `safe`:
    // 44 is still elevated. `watch` is a UI colour and never notifies, so the
    // zero-alert guarantees hold. Only below the watch leave-threshold (30)
    // is the animal genuinely safe.
    expect(nextState('warning', 44, 'approaching_road')).toBe('watch');
    expect(nextState('warning', 29, 'approaching_road')).toBe('safe');
  });

  it('watch never produces a notification', () => {
    const d = decideAlert({
      prior: { state: 'safe', last_alert_at: null, last_alert_kind: null,
               active_alert_id: null } as RiskStateRow,
      roadRisk: 50, situation: 'approaching_road', components: {} as never,
      roadName: 'NH-48', distanceM: 200, ttrSeconds: 300, pReachesRoad: 0.1,
      isNight: false, now: DAY,
    });
    expect(d.state).toBe('watch');
    expect(d.alert).toBeNull();
  });

  it('escalation sends at most three notifications over a whole event', () => {
    let prior = { state: 'safe', last_alert_at: null, last_alert_kind: null,
                  active_alert_id: null } as RiskStateRow;
    let notifications = 0;
    // A genuine, steadily worsening approach.
    const seq = [50, 66, 70, 72, 82, 85, 88, 91, 95, 97, 99, 100];

    seq.forEach((risk, i) => {
      const now = new Date(DAY.getTime() + i * 20_000);
      const d = decideAlert({
        prior, roadRisk: risk, situation: 'approaching_road',
        components: {} as never, roadName: 'NH-48', distanceM: 60,
        ttrSeconds: 40, pReachesRoad: 0.8, isNight: false, now,
      });
      if (d.alert?.notify) notifications++;
      prior = { ...prior, state: d.state,
        last_alert_at: d.alert ? now.toISOString() : prior.last_alert_at,
        last_alert_kind: d.alert ? d.alert.kind : prior.last_alert_kind };
    });

    expect(notifications).toBe(3); // warning, high, critical — never forty
  });

  it('cooldown suppresses repetition but never suppresses escalation', () => {
    const now = new Date(DAY.getTime());
    const prior = {
      state: 'warning', last_alert_kind: 'road_risk',
      last_alert_at: new Date(now.getTime() - 10_000).toISOString(), // 10 s ago
      active_alert_id: 'alert-1',
    } as RiskStateRow;

    // Rising to critical 10 s after a warning must still get through.
    const d = decideAlert({
      prior, roadRisk: 95, situation: 'approaching_road', components: {} as never,
      roadName: 'NH-48', distanceM: 20, ttrSeconds: 15, pReachesRoad: 0.9,
      isNight: false, now,
    });
    expect(d.alert?.notify).toBe(true);
    expect(d.alert?.severity).toBe('critical');
    expect(d.alert?.escalated_from).toBe('alert-1'); // one thread, not two events
  });
});

// ===========================================================================
describe('§7.8 fall detection — order is the discriminator', () => {
  /** Slow controlled rotation, peak under 1.5 g, then stillness. */
  function lieDownSamples(): ImuSample[] {
    const s: ImuSample[] = [];
    for (let t = 0; t <= 4000; t += 50) {
      s.push({ t_ms: t, a_g: 1 + 0.35 * Math.sin((t / 4000) * Math.PI), orientation_deg: (t / 4000) * 85 });
    }
    for (let t = 4050; t <= 120_000; t += 250) {
      s.push({ t_ms: t, a_g: 1.0, orientation_deg: 85 });
    }
    return s;
  }

  /** Impact spike FIRST, then rotation, then stillness. */
  function fallSamples(): ImuSample[] {
    const s: ImuSample[] = [];
    for (let t = 0; t < 1000; t += 50) s.push({ t_ms: t, a_g: 1.0, orientation_deg: 0 });
    s.push({ t_ms: 1000, a_g: 4.2, orientation_deg: 5 });   // impact
    s.push({ t_ms: 1050, a_g: 3.1, orientation_deg: 20 });
    for (let t = 1100; t <= 3500; t += 50) {
      s.push({ t_ms: t, a_g: 1.2, orientation_deg: 20 + ((t - 1100) / 2400) * 75 });
    }
    for (let t = 3550; t <= 130_000; t += 250) {
      s.push({ t_ms: t, a_g: 1.0, orientation_deg: 95 });
    }
    return s;
  }

  it('lie-down produces ZERO fall alerts', () => {
    const v = detectFall(lieDownSamples(), DAY);
    expect(v.fall).toBe(false);
    if (!v.fall) expect(v.failed_gate).toBe(1); // stopped at the spike gate
  });

  it('fall produces exactly one', () => {
    const v = detectFall(fallSamples(), DAY);
    expect(v.fall).toBe(true);
  });

  it('raises the spike threshold at night', () => {
    // A 3.0 g event clears the 2.5 g day gate but not the 3.5 g night gate.
    const s: ImuSample[] = [{ t_ms: 0, a_g: 1, orientation_deg: 0 },
                            { t_ms: 100, a_g: 3.0, orientation_deg: 0 }];
    for (let t = 200; t <= 3000; t += 50) s.push({ t_ms: t, a_g: 1.1, orientation_deg: 80 });
    for (let t = 3050; t <= 120_000; t += 250) s.push({ t_ms: t, a_g: 1.0, orientation_deg: 80 });

    expect(detectFall(s, DAY).fall).toBe(true);
    expect(detectFall(s, NIGHT).fall).toBe(false);
  });
});

// ===========================================================================
describe('§7.7 Monte Carlo produces a real probability', () => {
  it('is higher for an animal walking at the road than one walking away', () => {
    const toward = evaluate(
      makeInput({ heading_deg: 0, speed_kmh: 4 }),
      makeCtx({ distance_to_road: 60, recent_fixes: northwardFixes(60, 10, 6) }),
      null, { now: DAY, seed: 42 },
    );

    // Same distance, walking parallel — should be markedly less likely.
    const parallel = evaluate(
      makeInput({ heading_deg: 90, speed_kmh: 4 }),
      makeCtx({ distance_to_road: 60, recent_fixes: parallelFixes(60) }),
      null, { now: DAY, seed: 42 },
    );

    expect(toward.p_reaches_road_5min).not.toBeNull();
    expect(toward.p_reaches_road_5min!).toBeGreaterThan(0.5);
    if (parallel.p_reaches_road_5min !== null) {
      expect(toward.p_reaches_road_5min!).toBeGreaterThan(parallel.p_reaches_road_5min);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const ctx = makeCtx({ distance_to_road: 60, recent_fixes: northwardFixes(60, 10, 6) });
    const a = evaluate(makeInput(), ctx, null, { now: DAY, seed: 7 });
    const b = evaluate(makeInput(), ctx, null, { now: DAY, seed: 7 });
    expect(a.p_reaches_road_5min).toBe(b.p_reaches_road_5min);
  });

  it('returns 500 endpoints for the cone', () => {
    const out = evaluate(
      makeInput(), makeCtx({ distance_to_road: 60, recent_fixes: northwardFixes(60, 10, 6) }),
      null, { now: DAY, seed: 7 },
    );
    expect(out.cone.length).toBe(500);
  });
});

// ===========================================================================
describe('§13 honesty rules', () => {
  it('flags when traffic risk came from the fallback model', () => {
    const out = evaluate(makeInput(), makeCtx(), null, { now: DAY });
    expect(out.components.traffic_fallback).toBe(true);
  });

  it('uses live traffic when present', () => {
    const out = evaluate(
      makeInput(),
      makeCtx({ current_traffic_speed: 88, free_flow_speed: 90 }),
      null, { now: DAY },
    );
    expect(out.components.traffic_fallback).toBe(false);
  });

  it('never emits a probability without running the simulation', () => {
    // Far from any road: score below the Monte Carlo threshold, so p must be
    // null rather than a fabricated number (§7.7).
    const out = evaluate(
      makeInput({ speed_kmh: 0 }),
      makeCtx({ distance_to_road: 3000, base_risk: 2 }),
      null, { now: DAY },
    );
    expect(out.road_risk).toBeLessThan(40);
    expect(out.p_reaches_road_5min).toBeNull();
  });
});

// ===========================================================================
describe('geometry sanity', () => {
  it('destination and haversine round-trip', () => {
    const [lat, lon] = destination(13.0, 77.55, 90, 500);
    expect(haversine(13.0, 77.55, lat, lon)).toBeCloseTo(500, 0);
  });
});
