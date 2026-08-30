/**
 * Virtual fencing behaviour — the half the HARDWARE actuates.
 *
 * These are the demo requirements stated as assertions:
 *   cross the perimeter        -> beeps, vibrates, steers you back
 *   approach an NH/SH          -> steers you away
 *   walk parallel to a highway -> stays silent
 *   collar switched off        -> completely silent (moving the herd)
 *   outside scheduled hours    -> fence is not in force
 */

import { describe, it, expect } from 'vitest';
import { computeSteering, cueSideFor, signedTurn } from '../steering.ts';
import { destination, bearing } from '../geo.ts';
import type { DerivedFeatures, EnrichedContext } from '../types.ts';

const ZONE_CENTRE = { lat: 12.9964, lon: 77.55 }; // ~400 m south of an E-W highway

function features(o: Partial<DerivedFeatures> = {}): DerivedFeatures {
  return {
    distance_to_road: 500, bearing_to_road: 0, theta_deg: 0,
    closing_speed: 0, ttr_seconds: null,
    on_road: false, stationary_on_road: false,
    is_isolated: false, separation_rate: 0, outside_zone: false,
    is_night: false, ...o,
  };
}

function ctx(o: Partial<EnrichedContext> = {}): EnrichedContext {
  return {
    nearest_road_id: 1, road_name: 'NH-48', road_class: 'trunk', base_risk: 5,
    distance_to_road: 500, bearing_to_road: 0,
    inside_zone: true, zone_id: 'z', zone_buffer_m: 30, distance_to_zone_edge: 200,
    zone_centre_lat: ZONE_CENTRE.lat, zone_centre_lon: ZONE_CENTRE.lon, zone_active: true,
    herd_centroid_lat: null, herd_centroid_lon: null, herd_median_dist: 40,
    distance_from_centroid: 30, separation_rate: 0,
    current_traffic_speed: null, free_flow_speed: null,
    traffic_confidence: null, traffic_is_stale: true,
    prior_approaches_to_this_road: 0, recent_fixes: [], road_line: [], ...o,
  };
}

/** A point `m` metres from the zone centre on `brg`. */
function fromCentre(m: number, brg: number) {
  const [lat, lon] = destination(ZONE_CENTRE.lat, ZONE_CENTRE.lon, brg, m);
  return { lat, lon };
}

const base = {
  steeringEnabled: true, zoneActive: true,
  lat: ZONE_CENTRE.lat, lon: ZONE_CENTRE.lon,
};

// ===========================================================================
describe('turn direction', () => {
  it('computes the signed turn with correct wrap-around', () => {
    expect(signedTurn(350, 10)).toBe(20);    // right, across north
    expect(signedTurn(10, 350)).toBe(-20);   // left, across north
    expect(signedTurn(0, 90)).toBe(90);
  });

  it('cues the OPPOSITE side, because she walks away from the sound', () => {
    // Heading north (0), we want her to go west (270) = a LEFT turn.
    // To send her left we must sound the RIGHT transducer.
    expect(cueSideFor(0, 270)).toBe('right');
    // Want her east (90) = a RIGHT turn -> sound the LEFT side.
    expect(cueSideFor(0, 90)).toBe('left');
  });

  it('cues both when the required turn is nearly a reversal', () => {
    expect(cueSideFor(0, 180)).toBe('both');
  });
});

// ===========================================================================
describe('perimeter: crossing it beeps, vibrates and steers back', () => {
  it('fires inside the buffer when heading OUT', () => {
    const p = fromCentre(240, 0); // north edge, heading further north = out
    const cue = computeSteering({
      ...base, lat: p.lat, lon: p.lon, headingDeg: 0,
      features: features({ distance_to_road: 400 }),
      ctx: ctx({ distance_to_road: 400, distance_to_zone_edge: 12 }),
    });
    expect(cue.active).toBe(true);
    expect(cue.reason).toBe('zone_boundary');
    expect(['left', 'right', 'both']).toContain(cue.side);
  });

  it('stays SILENT inside the buffer when she is heading back in', () => {
    // Punishing an animal for returning teaches her the cue is meaningless.
    const p = fromCentre(240, 0);
    const cue = computeSteering({
      ...base, lat: p.lat, lon: p.lon, headingDeg: 180, // back toward centre
      features: features({ distance_to_road: 400 }),
      ctx: ctx({ distance_to_road: 400, distance_to_zone_edge: 12 }),
    });
    expect(cue.active).toBe(false);
  });

  it('escalates to tone+vibrate once she is actually outside', () => {
    const p = fromCentre(300, 0);
    const cue = computeSteering({
      ...base, lat: p.lat, lon: p.lon, headingDeg: 0,
      features: features({ distance_to_road: 300, outside_zone: true }),
      ctx: ctx({ distance_to_road: 300, inside_zone: false }),
    });
    expect(cue.active).toBe(true);
    expect(cue.pattern).toBe('tone_vibrate');
    expect(cue.reason).toBe('outside_zone');
    // And it points her back at the middle of her own field.
    const want = bearing(p.lat, p.lon, ZONE_CENTRE.lat, ZONE_CENTRE.lon);
    expect(Math.abs(signedTurn(cue.target_bearing!, want))).toBeLessThan(1);
  });
});

// ===========================================================================
describe('roads: steers away from NH/SH, and outranks the fence', () => {
  it('escalates as she closes on the highway', () => {
    const mk = (d: number) => computeSteering({
      ...base, headingDeg: 0,
      features: features({ distance_to_road: d, closing_speed: 1.2 }),
      ctx: ctx({ distance_to_road: d }),
    });
    expect(mk(140).pattern).toBe('tone');
    expect(mk(60).pattern).toBe('tone_fast');
    expect(mk(20).pattern).toBe('tone_vibrate');
    expect(mk(20).intensity).toBeGreaterThan(mk(140).intensity);
  });

  it('goes continuous on both sides once she is ON the road', () => {
    const cue = computeSteering({
      ...base, headingDeg: 0,
      features: features({ distance_to_road: 3, on_road: true }),
      ctx: ctx({ distance_to_road: 3 }),
    });
    expect(cue.pattern).toBe('continuous');
    expect(cue.side).toBe('both');
    expect(cue.intensity).toBe(4);
  });

  it('steers her to the reciprocal of the bearing to the road', () => {
    const cue = computeSteering({
      ...base, headingDeg: 10,
      features: features({ distance_to_road: 50, closing_speed: 1.2 }),
      ctx: ctx({ distance_to_road: 50, bearing_to_road: 0 }),
    });
    expect(cue.target_bearing).toBe(180); // road is north => send her south
  });

  it('NEVER cues an animal walking parallel to a highway', () => {
    // §7.3 applied to the actuator. This is the difference between a fence
    // she respects and one she learns to ignore.
    const cue = computeSteering({
      ...base, headingDeg: 90,
      features: features({ distance_to_road: 45, closing_speed: 0 }),
      ctx: ctx({ distance_to_road: 45 }),
    });
    expect(cue.active).toBe(false);
  });

  it('ignores minor roads', () => {
    const cue = computeSteering({
      ...base, headingDeg: 0,
      features: features({ distance_to_road: 40, closing_speed: 1.2 }),
      ctx: ctx({ distance_to_road: 40, base_risk: 2 }),
    });
    expect(cue.reason).not.toBe('road');
  });
});

// ===========================================================================
describe('collar control from the app', () => {
  it('is completely silent when the farmer switches the collar off', () => {
    // The "moving the herd to another field" case.
    const cue = computeSteering({
      ...base, steeringEnabled: false, headingDeg: 0,
      features: features({ distance_to_road: 3, on_road: true }),
      ctx: ctx({ distance_to_road: 3 }),
    });
    expect(cue.active).toBe(false);
    expect(cue.detail).toMatch(/disabled/);
  });

  it('does not fence outside the zone schedule', () => {
    const p = fromCentre(300, 0);
    const cue = computeSteering({
      ...base, zoneActive: false, lat: p.lat, lon: p.lon, headingDeg: 0,
      features: features({ distance_to_road: 400, outside_zone: true }),
      ctx: ctx({ distance_to_road: 400, inside_zone: false, zone_active: false }),
    });
    expect(cue.active).toBe(false);
  });

  it('still steers off a HIGHWAY even outside the zone schedule', () => {
    // The fence is a schedule. A highway is not.
    const cue = computeSteering({
      ...base, zoneActive: false, headingDeg: 0,
      features: features({ distance_to_road: 20, closing_speed: 1.5 }),
      ctx: ctx({ distance_to_road: 20, zone_active: false }),
    });
    expect(cue.active).toBe(true);
    expect(cue.reason).toBe('road');
  });
});
