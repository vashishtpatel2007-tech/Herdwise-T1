/**
 * Virtual fencing — the cue the collar actually plays.
 *
 * This is what turns the risk engine into a fence rather than a reporter. The
 * collar has a left and a right transducer; cueing ONE side is what turns an
 * animal, because she walks away from the sound. Cueing both just alarms her,
 * and an alarmed cow runs in whatever direction she was already pointing —
 * which, when she is approaching a road, is the wrong one.
 *
 * Escalation ladder is deliberate and welfare-first:
 *   1 tone            she is drifting toward the edge
 *   2 tone (fast)     she has not turned
 *   3 tone + vibrate  she is close
 *   4 continuous      she is on the road; the noise itself may move her
 *
 * No shock, at any level. Audio + vibration is what commercial virtual fencing
 * settles on for cattle, and a shocked animal bolts unpredictably.
 */

import { angularDifference, bearing } from './geo.ts';
import type { DerivedFeatures, EnrichedContext } from './types.ts';

export type CuePattern =
  | 'none' | 'tone' | 'tone_fast' | 'tone_vibrate' | 'continuous';

export interface SteeringCue {
  active: boolean;
  /** Which transducer to fire. She turns AWAY from the cued side. */
  side: 'left' | 'right' | 'both' | null;
  pattern: CuePattern;
  /** 0–4. The collar maps this to volume / motor duty. */
  intensity: number;
  reason: 'road' | 'zone_boundary' | 'outside_zone' | null;
  /** Heading we want her on, degrees. Diagnostics + firmware closed loop. */
  target_bearing: number | null;
  /** Human-readable, for the device page and logs. */
  detail: string;
}

const NO_CUE: SteeringCue = {
  active: false, side: null, pattern: 'none', intensity: 0,
  reason: null, target_bearing: null, detail: 'clear',
};

/**
 * Signed turn from `from` to `to`, in [-180, 180].
 * Negative = turn left (counter-clockwise), positive = turn right.
 */
export function signedTurn(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Which side to cue so she turns toward `target`.
 *
 * She moves AWAY from the sound, so to send her LEFT we fire the RIGHT
 * transducer. Getting this backwards steers every animal into the hazard, so
 * it is stated explicitly rather than left implicit in a sign.
 */
export function cueSideFor(heading: number, target: number): 'left' | 'right' | 'both' {
  const turn = signedTurn(heading, target);
  // Near 180° the correct turn is ambiguous; cue both and let her pick.
  if (Math.abs(turn) > 150) return 'both';
  return turn < 0 ? 'right' : 'left';
}

export interface SteeringInput {
  features: DerivedFeatures;
  ctx: EnrichedContext;
  headingDeg: number;
  lat: number;
  lon: number;
  /** Farmer disabled steering, or the collar is muted / off. */
  steeringEnabled: boolean;
  /** Zone schedule says this zone is not in force right now. */
  zoneActive: boolean;
}

export function computeSteering(i: SteeringInput): SteeringCue {
  if (!i.steeringEnabled) {
    return { ...NO_CUE, detail: 'steering disabled by farmer' };
  }

  const f = i.features;
  const d = f.distance_to_road;

  // ---- Road hazard. Highest priority, always outranks the fence. ---------
  if (d !== null && i.ctx.base_risk >= 3) {
    // Away from the road is simply the reciprocal of the bearing to it.
    const away = ((i.ctx.bearing_to_road ?? 0) + 180) % 360;

    if (f.on_road) {
      // She is ON the carriageway. Continuous, both sides — this is the one
      // case where the point is noise, not direction.
      return {
        active: true, side: 'both', pattern: 'continuous', intensity: 4,
        reason: 'road', target_bearing: away,
        detail: `on ${i.ctx.road_name ?? 'road'} — continuous`,
      };
    }

    // Only cue if she is actually closing. A cow grazing parallel to a
    // highway must never be buzzed — that is §7.3 applied to the actuator,
    // and it is the difference between a fence she respects and one she
    // learns to ignore.
    if (f.closing_speed > 0.1) {
      if (d < 30) {
        return {
          active: true, side: cueSideFor(i.headingDeg, away),
          pattern: 'tone_vibrate', intensity: 3, reason: 'road',
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? 'road'}, closing`,
        };
      }
      if (d < 80) {
        return {
          active: true, side: cueSideFor(i.headingDeg, away),
          pattern: 'tone_fast', intensity: 2, reason: 'road',
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? 'road'}, closing`,
        };
      }
      if (d < 150) {
        return {
          active: true, side: cueSideFor(i.headingDeg, away),
          pattern: 'tone', intensity: 1, reason: 'road',
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? 'road'}`,
        };
      }
    }
  }

  // ---- Grazing-zone fence -----------------------------------------------
  // A zone outside its scheduled hours is not a fence. Buzzing an animal for
  // crossing a boundary the farmer has switched off destroys her trust in the
  // cue, and the cue only works because she trusts it.
  if (!i.zoneActive) {
    return { ...NO_CUE, detail: 'zone not scheduled active' };
  }

  const centre =
    i.ctx.zone_centre_lat !== null && i.ctx.zone_centre_lon !== null
      ? bearing(i.lat, i.lon, i.ctx.zone_centre_lat, i.ctx.zone_centre_lon)
      : null;

  if (centre === null) return NO_CUE;

  // Already out: steer her back, hard.
  if (!i.ctx.inside_zone) {
    return {
      active: true, side: cueSideFor(i.headingDeg, centre),
      pattern: 'tone_vibrate', intensity: 3, reason: 'outside_zone',
      target_bearing: centre, detail: 'outside the grazing area',
    };
  }

  // Inside, but within the warning buffer. Cue only if she is heading OUT —
  // an animal walking back inside should be left alone, or the fence
  // punishes the behaviour it is trying to produce.
  const edge = i.ctx.distance_to_zone_edge;
  if (edge !== null && edge < i.ctx.zone_buffer_m) {
    const headingOut = angularDifference(i.headingDeg, centre) > 90;
    if (!headingOut) {
      return { ...NO_CUE, detail: 'inside buffer but heading back in' };
    }
    return {
      active: true, side: cueSideFor(i.headingDeg, centre),
      pattern: edge < i.ctx.zone_buffer_m / 2 ? 'tone_fast' : 'tone',
      intensity: edge < i.ctx.zone_buffer_m / 2 ? 2 : 1,
      reason: 'zone_boundary', target_bearing: centre,
      detail: `${Math.round(edge)} m from the edge, heading out`,
    };
  }

  return NO_CUE;
}
