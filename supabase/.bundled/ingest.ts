// supabase/functions/ingest/index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

// supabase/functions/_shared/engine/veto.ts
var FIX_QUALITY_MIN = 2;
var HDOP_MAX = 5;
var SATS_MIN = 5;
var POOR_FIX_ALERT_AFTER_MS = 15 * 60 * 1e3;
function gpsVeto(t) {
  const failures = [];
  if (t.fix_quality < FIX_QUALITY_MIN) failures.push(`fix_quality=${t.fix_quality}`);
  if (t.hdop > HDOP_MAX) failures.push(`hdop=${t.hdop}`);
  if (t.sats < SATS_MIN) failures.push(`sats=${t.sats}`);
  return failures.length > 0 ? { vetoed: true, reason: failures.join(", ") } : { vetoed: false, reason: null };
}
function shouldRaiseGpsFault(poorFixSince, lastAlertAt, now) {
  if (!poorFixSince) return false;
  const elapsed = now.getTime() - new Date(poorFixSince).getTime();
  if (elapsed < POOR_FIX_ALERT_AFTER_MS) return false;
  if (lastAlertAt && new Date(lastAlertAt).getTime() > new Date(poorFixSince).getTime()) {
    return false;
  }
  return true;
}

// supabase/functions/_shared/engine/geo.ts
var R_EARTH_M = 63710088e-1;
var toRad = (deg) => deg * Math.PI / 180;
var toDeg = (rad) => rad * 180 / Math.PI;
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var kmhToMps = (kmh) => kmh * 1e3 / 3600;
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
function bearing(lat1, lon1, lat2, lon2) {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function destination(lat, lon, bearing_deg, distance_m) {
  const δ = distance_m / R_EARTH_M;
  const θ = toRad(bearing_deg);
  const φ1 = toRad(lat), λ1 = toRad(lon);
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ)
  );
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [toDeg(φ2), (toDeg(λ2) + 540) % 360 - 180];
}
function angularDifference(a, b) {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}
function pointToSegmentMeters(plat, plon, alat, alon, blat, blon) {
  const latRef = toRad((alat + blat) / 2);
  const mx = (lon) => toRad(lon) * Math.cos(latRef) * R_EARTH_M;
  const my = (lat) => toRad(lat) * R_EARTH_M;
  const px = mx(plon), py = my(plat);
  const ax = mx(alon), ay = my(alat);
  const bx = mx(blon), by = my(blat);
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function pointToLineMeters(plat, plon, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = pointToSegmentMeters(
      plat,
      plon,
      line[i][0],
      line[i][1],
      line[i + 1][0],
      line[i + 1][1]
    );
    if (d < best) best = d;
  }
  return best;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function normalSample(rng, mean2, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean2 + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stddev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

// supabase/functions/_shared/engine/time.ts
var DEFAULT_TZ = "Asia/Kolkata";
function localHour(d, timeZone = DEFAULT_TZ) {
  try {
    const s = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false
    }).format(d);
    const h = Number.parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : d.getUTCHours();
  } catch {
    return d.getUTCHours();
  }
}
function isNightHour(hour) {
  return hour >= 21 || hour < 6;
}

// supabase/functions/_shared/engine/features.ts
var ON_ROAD_M = 15;
var STATIONARY_KMH = 0.3;
var STATIONARY_SUSTAIN_MS = 60 * 1e3;
var CLOSING_EPSILON_MPS = 0.1;
function isNight(d, tz) {
  return isNightHour(localHour(d, tz));
}
function deriveFeatures(input, ctx, prior, now, tz) {
  const speed_mps = kmhToMps(input.speed_kmh);
  const dist = ctx.distance_to_road;
  let theta_deg = null;
  let closing_speed = 0;
  let ttr_seconds = null;
  if (ctx.bearing_to_road !== null && dist !== null) {
    theta_deg = angularDifference(input.heading_deg, ctx.bearing_to_road);
    closing_speed = speed_mps * Math.cos(theta_deg * Math.PI / 180);
    if (closing_speed > CLOSING_EPSILON_MPS) {
      ttr_seconds = Math.round(dist / closing_speed);
    }
  }
  const on_road = dist !== null && dist < ON_ROAD_M;
  const isStill = input.speed_kmh < STATIONARY_KMH;
  let on_road_since = prior?.on_road_since ?? null;
  on_road_since = on_road ? on_road_since ?? now.toISOString() : null;
  let stationary_since = prior?.stationary_since ?? null;
  stationary_since = on_road && isStill ? stationary_since ?? now.toISOString() : null;
  const stationary_on_road = on_road && isStill && stationary_since !== null && now.getTime() - new Date(stationary_since).getTime() >= STATIONARY_SUSTAIN_MS;
  const is_isolated = ctx.distance_from_centroid !== null && ctx.herd_median_dist !== null && ctx.herd_median_dist > 0 && ctx.distance_from_centroid > 2 * ctx.herd_median_dist;
  const outside_zone = !ctx.inside_zone || ctx.distance_to_zone_edge !== null && ctx.inside_zone && ctx.distance_to_zone_edge < ctx.zone_buffer_m;
  return {
    features: {
      distance_to_road: dist,
      bearing_to_road: ctx.bearing_to_road,
      theta_deg,
      closing_speed,
      ttr_seconds,
      on_road,
      stationary_on_road,
      is_isolated,
      separation_rate: ctx.separation_rate,
      outside_zone,
      is_night: isNight(now, tz)
    },
    stationary_since,
    on_road_since
  };
}

// supabase/functions/_shared/engine/traffic.ts
var COLLISION_REFERENCE_KMH = 100;
var FALLBACK_BASE = 0.4;
function timeOfDayMultiplier(d, tz) {
  const h = localHour(d, tz);
  if (h >= 6 && h < 9 || h >= 17 && h < 21) return 1.5;
  if (h >= 9 && h < 17) return 1;
  return 1.3;
}
function trafficSignals(currentSpeedKmh, freeFlowKmh, now, tz) {
  const tod = timeOfDayMultiplier(now, tz);
  if (currentSpeedKmh === null || freeFlowKmh === null || !Number.isFinite(currentSpeedKmh) || !Number.isFinite(freeFlowKmh) || freeFlowKmh <= 0) {
    return {
      collision_risk: clamp(FALLBACK_BASE * tod, 0, 1),
      disruption_risk: 0,
      fallback: true
    };
  }
  const speed_ratio = clamp(currentSpeedKmh / freeFlowKmh, 0, 1);
  return {
    // Fast traffic kills animals. Scale by the clock too: the same 90 km/h is
    // worse at 2am when the driver cannot see her.
    collision_risk: clamp(currentSpeedKmh / COLLISION_REFERENCE_KMH * tod, 0, 1),
    // Slow dense traffic is the jam/disruption case, not the fatality case.
    disruption_risk: clamp(1 - speed_ratio, 0, 1),
    fallback: false
  };
}

// supabase/functions/_shared/engine/score.ts
var PROXIMITY_HORIZON_M = 300;
var CLOSING_REFERENCE_MPS = 1.5;
var ISOLATION_REFERENCE = 20;
var WEIGHTS = {
  proximity: 0.28,
  closing: 0.26,
  road_factor: 0.16,
  traffic_f: 0.12,
  isolation: 0.1,
  outside_zone: 0.08
};
function scoreRoadRisk(f, baseRisk, traffic, insideZone) {
  const proximity = f.distance_to_road === null ? 0 : clamp(1 - f.distance_to_road / PROXIMITY_HORIZON_M, 0, 1);
  const closing = clamp(f.closing_speed / CLOSING_REFERENCE_MPS, 0, 1);
  const road_factor = clamp(baseRisk / 5, 0, 1);
  const traffic_f = clamp(traffic.collision_risk, 0, 1);
  const isolation = clamp(f.separation_rate / ISOLATION_REFERENCE, 0, 1);
  const outside_zone = f.outside_zone ? 1 : 0;
  const components = {
    proximity,
    closing,
    road_factor,
    traffic_f,
    isolation,
    outside_zone,
    traffic_fallback: traffic.fallback
  };
  const raw = WEIGHTS.proximity * proximity + WEIGHTS.closing * closing + WEIGHTS.road_factor * road_factor + WEIGHTS.traffic_f * traffic_f + WEIGHTS.isolation * isolation + WEIGHTS.outside_zone * outside_zone;
  let road_risk = Math.round(100 * raw);
  let situation = "normal";
  if (f.stationary_on_road) {
    road_risk = 100;
    situation = "stationary_on_road";
    components.override = "stationary_on_road";
  } else if (f.on_road) {
    road_risk = 95;
    situation = "on_road";
    components.override = "on_road";
  } else if (f.ttr_seconds !== null && road_risk >= 40) {
    situation = "approaching_road";
  } else if (f.outside_zone) {
    situation = "outside_zone";
  }
  let geofence_risk = 0;
  if (!insideZone) geofence_risk = 70;
  else if (f.outside_zone) geofence_risk = 40;
  return { road_risk: clamp(road_risk, 0, 100), geofence_risk, components, situation };
}

// supabase/functions/_shared/engine/montecarlo.ts
var SIM_COUNT = 500;
var HORIZON_S = 300;
var STEP_S = 10;
var ROAD_BUFFER_M = 50;
var MIN_SPEED_MPS = 0.05;
var MAX_SPEED_MPS = 8;
function trajectoryCone(fixes, roadLine, seed = 1337) {
  if (fixes.length < 3 || roadLine.length < 2) {
    return { p_reaches_road_5min: 0, endpoints: [], computed: false };
  }
  const headings = [];
  const speeds = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1], b = fixes[i];
    const dt = (new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()) / 1e3;
    if (dt <= 0) continue;
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    speeds.push(d / dt);
    headings.push(bearing(a.lat, a.lon, b.lat, b.lon));
  }
  if (headings.length < 2) {
    return { p_reaches_road_5min: 0, endpoints: [], computed: false };
  }
  const turns = [];
  for (let i = 1; i < headings.length; i++) {
    let t = headings[i] - headings[i - 1];
    while (t > 180) t -= 360;
    while (t < -180) t += 360;
    turns.push(t);
  }
  const turn_mean = mean(turns);
  const turn_sd = Math.max(stddev(turns), 5);
  const speed_mean = Math.max(mean(speeds), MIN_SPEED_MPS);
  const speed_sd = Math.max(stddev(speeds), 0.05);
  const start = fixes[fixes.length - 1];
  const startHeading = headings[headings.length - 1];
  const rng = makeRng(seed);
  const steps = Math.floor(HORIZON_S / STEP_S);
  const endpoints = [];
  let crossings = 0;
  for (let s = 0; s < SIM_COUNT; s++) {
    let lat = start.lat, lon = start.lon, heading = startHeading;
    let crossed = false;
    for (let step = 0; step < steps; step++) {
      heading = (heading + normalSample(rng, turn_mean, turn_sd) + 360) % 360;
      const speed = Math.min(Math.max(normalSample(rng, speed_mean, speed_sd), 0), MAX_SPEED_MPS);
      [lat, lon] = destination(lat, lon, heading, speed * STEP_S);
      if (!crossed && pointToLineMeters(lat, lon, roadLine) < ROAD_BUFFER_M) {
        crossed = true;
      }
    }
    if (crossed) crossings++;
    endpoints.push([lat, lon]);
  }
  return {
    p_reaches_road_5min: crossings / SIM_COUNT,
    endpoints,
    computed: true
  };
}

// supabase/functions/_shared/engine/stateMachine.ts
var THRESHOLDS = {
  watch: { enter: 45, leave: 30 },
  warning: { enter: 65, leave: 45 },
  high: { enter: 80, leave: 60 },
  critical: { enter: 90, leave: 70 }
};
var COOLDOWN_S = 180;
var RANK = {
  safe: 0,
  watch: 1,
  warning: 2,
  high: 3,
  critical: 4
};
var SITUATION_RANK = {
  normal: 0,
  device_fault: 0,
  outside_zone: 1,
  possible_injury: 2,
  approaching_road: 2,
  on_road: 3,
  stationary_on_road: 4
};
function isOnRoadSituation(s) {
  return s === "on_road" || s === "stationary_on_road";
}
function nextState(current, roadRisk, situation) {
  if (isOnRoadSituation(situation)) return "critical";
  const cur = RANK[current];
  if (roadRisk >= THRESHOLDS.critical.enter) return "critical";
  if (roadRisk >= THRESHOLDS.high.enter && cur <= RANK.high) return "high";
  if (roadRisk >= THRESHOLDS.warning.enter && cur <= RANK.warning) return "warning";
  if (roadRisk >= THRESHOLDS.watch.enter && cur <= RANK.watch) return "watch";
  switch (current) {
    case "critical":
      return roadRisk < THRESHOLDS.critical.leave ? demote("high", roadRisk) : "critical";
    case "high":
      return roadRisk < THRESHOLDS.high.leave ? demote("warning", roadRisk) : "high";
    case "warning":
      return roadRisk < THRESHOLDS.warning.leave ? demote("watch", roadRisk) : "warning";
    case "watch":
      return roadRisk < THRESHOLDS.watch.leave ? "safe" : "watch";
    default:
      return "safe";
  }
}
function demote(to, roadRisk) {
  switch (to) {
    case "high":
      return roadRisk < THRESHOLDS.high.leave ? demote("warning", roadRisk) : "high";
    case "warning":
      return roadRisk < THRESHOLDS.warning.leave ? demote("watch", roadRisk) : "warning";
    case "watch":
      return roadRisk < THRESHOLDS.watch.leave ? "safe" : "watch";
    default:
      return "safe";
  }
}
function decideAlert(i) {
  const prior = i.prior;
  const from = prior?.state ?? "safe";
  const to = nextState(from, i.roadRisk, i.situation);
  const rising = RANK[to] > RANK[from];
  const falling = RANK[to] < RANK[from];
  const priorSituation = prior?.situation ?? "normal";
  const situationWorsened = isOnRoadSituation(i.situation) && SITUATION_RANK[i.situation] > SITUATION_RANK[priorSituation];
  const kind = isOnRoadSituation(i.situation) ? "on_road" : "road_risk";
  if (falling && !situationWorsened) {
    return {
      state: to,
      action: "none",
      alert: null,
      silent_update: true,
      resolve: to === "safe"
    };
  }
  if (!rising && !situationWorsened) {
    return {
      state: to,
      action: to === "critical" ? "notify_and_buzz" : "none",
      alert: null,
      silent_update: RANK[to] >= RANK.warning,
      resolve: false
    };
  }
  if (RANK[to] < RANK.warning) {
    return { state: to, action: "none", alert: null, silent_update: false, resolve: false };
  }
  const severity = to === "critical" ? "critical" : to === "high" ? "high" : "warning";
  const sameKind = prior?.last_alert_kind === kind;
  const lastSeverity = prior?.last_alert_severity ?? null;
  const notMoreSevere = lastSeverity !== null && RANK[severity] <= RANK[lastSeverity];
  const sinceLast = prior?.last_alert_at ? (i.now.getTime() - new Date(prior.last_alert_at).getTime()) / 1e3 : Infinity;
  const cooldownBlocks = sameKind && notMoreSevere && sinceLast < COOLDOWN_S;
  if (cooldownBlocks) {
    return { state: to, action: "none", alert: null, silent_update: true, resolve: false };
  }
  const nightStationary = i.situation === "stationary_on_road" && i.isNight;
  const action = nightStationary ? "escalate_to_authority" : to === "critical" || to === "high" ? "notify_and_buzz" : "notify";
  const message_key = i.situation === "stationary_on_road" ? "alert.stationary_on_road" : i.situation === "on_road" ? "alert.on_road" : i.situation === "outside_zone" ? "alert.outside_zone" : "alert.approaching_road";
  return {
    state: to,
    action,
    silent_update: false,
    resolve: false,
    alert: {
      kind,
      severity,
      message_key,
      message_params: {
        road: i.roadName ?? "the road",
        distance: i.distanceM ?? 0,
        minutes: i.ttrSeconds ? Math.max(1, Math.round(i.ttrSeconds / 60)) : 0
      },
      // Upgrade chain, not a new incident — the UI renders these as one thread.
      escalated_from: RANK[from] >= RANK.warning ? prior?.active_alert_id ?? null : null,
      notify: true
    }
  };
}

// supabase/functions/_shared/engine/steering.ts
var NO_CUE = {
  active: false,
  side: null,
  pattern: "none",
  intensity: 0,
  reason: null,
  target_bearing: null,
  detail: "clear"
};
function signedTurn(from, to) {
  return (to - from + 540) % 360 - 180;
}
function cueSideFor(heading, target) {
  const turn = signedTurn(heading, target);
  if (Math.abs(turn) > 150) return "both";
  return turn < 0 ? "right" : "left";
}
function computeSteering(i) {
  if (!i.steeringEnabled) {
    return { ...NO_CUE, detail: "steering disabled by farmer" };
  }
  const f = i.features;
  const d = f.distance_to_road;
  if (d !== null && i.ctx.base_risk >= 3) {
    const away = ((i.ctx.bearing_to_road ?? 0) + 180) % 360;
    if (f.on_road) {
      return {
        active: true,
        side: "both",
        pattern: "continuous",
        intensity: 4,
        reason: "road",
        target_bearing: away,
        detail: `on ${i.ctx.road_name ?? "road"} — continuous`
      };
    }
    if (f.closing_speed > 0.1) {
      if (d < 30) {
        return {
          active: true,
          side: cueSideFor(i.headingDeg, away),
          pattern: "tone_vibrate",
          intensity: 3,
          reason: "road",
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? "road"}, closing`
        };
      }
      if (d < 80) {
        return {
          active: true,
          side: cueSideFor(i.headingDeg, away),
          pattern: "tone_fast",
          intensity: 2,
          reason: "road",
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? "road"}, closing`
        };
      }
      if (d < 150) {
        return {
          active: true,
          side: cueSideFor(i.headingDeg, away),
          pattern: "tone",
          intensity: 1,
          reason: "road",
          target_bearing: away,
          detail: `${Math.round(d)} m from ${i.ctx.road_name ?? "road"}`
        };
      }
    }
  }
  if (!i.zoneActive) {
    return { ...NO_CUE, detail: "zone not scheduled active" };
  }
  const centre = i.ctx.zone_centre_lat !== null && i.ctx.zone_centre_lon !== null ? bearing(i.lat, i.lon, i.ctx.zone_centre_lat, i.ctx.zone_centre_lon) : null;
  if (centre === null) return NO_CUE;
  if (!i.ctx.inside_zone) {
    return {
      active: true,
      side: cueSideFor(i.headingDeg, centre),
      pattern: "tone_vibrate",
      intensity: 3,
      reason: "outside_zone",
      target_bearing: centre,
      detail: "outside the grazing area"
    };
  }
  const edge = i.ctx.distance_to_zone_edge;
  if (edge !== null && edge < i.ctx.zone_buffer_m) {
    const headingOut = angularDifference(i.headingDeg, centre) > 90;
    if (!headingOut) {
      return { ...NO_CUE, detail: "inside buffer but heading back in" };
    }
    return {
      active: true,
      side: cueSideFor(i.headingDeg, centre),
      pattern: edge < i.ctx.zone_buffer_m / 2 ? "tone_fast" : "tone",
      intensity: edge < i.ctx.zone_buffer_m / 2 ? 2 : 1,
      reason: "zone_boundary",
      target_bearing: centre,
      detail: `${Math.round(edge)} m from the edge, heading out`
    };
  }
  return NO_CUE;
}

// supabase/functions/_shared/engine/index.ts
var MONTE_CARLO_THRESHOLD = 40;
function evaluate(input, ctx, prior, opts = {}) {
  const now = opts.now ?? /* @__PURE__ */ new Date();
  const veto = gpsVeto(input);
  if (veto.vetoed) {
    return {
      road_risk: prior?.road_risk ?? 0,
      geofence_risk: prior?.geofence_risk ?? 0,
      injury_risk: prior?.injury_risk ?? 0,
      situation: "device_fault",
      state: prior?.state ?? "safe",
      p_reaches_road_5min: null,
      nearest_road_name: ctx.road_name,
      distance_m: null,
      ttr_seconds: null,
      components: {
        proximity: 0,
        closing: 0,
        road_factor: 0,
        traffic_f: 0,
        isolation: 0,
        outside_zone: 0,
        traffic_fallback: true
      },
      action: "none",
      alert: null,
      vetoed: true,
      veto_reason: veto.reason,
      cone: [],
      // Never steer on a bad fix. Cueing an animal to turn based on a position
      // that may be 50 m wrong could push her INTO the road (§7.2).
      cue: {
        active: false,
        side: null,
        pattern: "none",
        intensity: 0,
        reason: null,
        target_bearing: null,
        detail: "gps veto — no steering"
      },
      // Preserve the sustain clocks across a poor fix: a cow lying on a road
      // does not stop lying there because one packet had bad HDOP.
      stationary_since: prior?.stationary_since ?? null,
      on_road_since: prior?.on_road_since ?? null
    };
  }
  const { features, stationary_since, on_road_since } = deriveFeatures(input, ctx, prior, now, opts.tz);
  const traffic = trafficSignals(
    ctx.current_traffic_speed,
    ctx.free_flow_speed,
    now,
    opts.tz
  );
  const scored = scoreRoadRisk(features, ctx.base_risk, traffic, ctx.inside_zone);
  let p = null;
  let cone = [];
  if (scored.road_risk >= MONTE_CARLO_THRESHOLD && ctx.road_line.length >= 2) {
    const result = trajectoryCone(ctx.recent_fixes, ctx.road_line, opts.seed ?? 1337);
    if (result.computed) {
      p = result.p_reaches_road_5min;
      cone = result.endpoints;
    }
  }
  const decision = decideAlert({
    prior,
    roadRisk: scored.road_risk,
    situation: scored.situation,
    components: scored.components,
    roadName: ctx.road_name,
    distanceM: features.distance_to_road === null ? null : Math.round(features.distance_to_road),
    ttrSeconds: features.ttr_seconds,
    pReachesRoad: p,
    isNight: features.is_night,
    now
  });
  return {
    road_risk: scored.road_risk,
    geofence_risk: scored.geofence_risk,
    injury_risk: prior?.injury_risk ?? 0,
    situation: scored.situation,
    state: decision.state,
    p_reaches_road_5min: p,
    nearest_road_name: ctx.road_name,
    distance_m: features.distance_to_road === null ? null : Math.round(features.distance_to_road),
    ttr_seconds: features.ttr_seconds,
    components: scored.components,
    action: decision.action,
    alert: decision.alert,
    vetoed: false,
    veto_reason: null,
    cone,
    // MUST be persisted by the caller onto risk_state, or the 60 s sustain
    // clock resets on every packet and stationary_on_road never latches.
    stationary_since,
    on_road_since,
    cue: computeSteering({
      features,
      ctx,
      headingDeg: input.heading_deg,
      lat: input.lat,
      lon: input.lon,
      steeringEnabled: opts.steeringEnabled ?? true,
      zoneActive: ctx.zone_active
    })
  };
}

// supabase/functions/ingest/index.ts
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" }
  });
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function requireEnv(name) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let db;
  try {
    db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false }
    });
    const expected = requireEnv("DEVICE_INGEST_SECRET");
    const presented = req.headers.get("x-device-secret") ?? "";
    if (!safeEqual(presented, expected)) return json({ error: "unauthorized" }, 401);
  } catch (e2) {
    console.error(String(e2));
    return json({ error: String(e2) }, 500);
  }
  const packet = await req.json();
  const now = /* @__PURE__ */ new Date();
  const { data: device } = await db.from("devices").select("id, animal_id, is_enabled, steering_on, mute_until, live_until, animals(farmer_id)").eq("device_key", packet.device_id).maybeSingle();
  if (!device?.animal_id) return json({ error: "unknown device" }, 404);
  const animal_id = device.animal_id;
  const farmer_id = device.animals?.farmer_id ?? null;
  const muted = device.mute_until ? new Date(device.mute_until) > now : false;
  const live = device.live_until ? new Date(device.live_until) > now : false;
  const collarOn = device.is_enabled !== false;
  const steeringEnabled = collarOn && device.steering_on !== false && !muted;
  const { data: commands } = await db.rpc("pop_commands", { p_device_id: device.id });
  function nextIntervalS(situation, dToRoad) {
    if (live) return 5;
    if (!collarOn) return 600;
    if (situation === "on_road" || situation === "stationary_on_road") return 5;
    if (dToRoad !== null && dToRoad < 150) return 15;
    if (situation === "outside_zone") return 30;
    if ((packet.speed_kmh ?? 0) > 1.5) return 120;
    return 600;
  }
  const poorFix = packet.fix_quality < 2 || packet.hdop > 5 || packet.sats < 5;
  await db.from("telemetry").upsert({
    device_id: device.id,
    animal_id,
    position: `SRID=4326;POINT(${packet.lon} ${packet.lat})`,
    speed_kmh: packet.speed_kmh,
    heading_deg: Math.round(packet.heading_deg),
    fix_quality: packet.fix_quality,
    hdop: packet.hdop,
    sats: packet.sats,
    battery_pct: packet.battery_pct,
    movement_state: packet.movement_state,
    event_code: packet.event_code,
    seq: packet.seq,
    poor_fix: poorFix,
    recorded_at: packet.recorded_at
  }, { onConflict: "device_id,seq", ignoreDuplicates: true });
  await db.from("devices").update({ battery_pct: packet.battery_pct, last_seen_at: now.toISOString() }).eq("id", device.id);
  const { data: priorRow } = await db.from("risk_state").select("*").eq("animal_id", animal_id).maybeSingle();
  const prior = priorRow ?? null;
  if (poorFix) {
    const poor_fix_since = prior?.poor_fix_since ?? now.toISOString();
    if (shouldRaiseGpsFault(poor_fix_since, prior?.last_alert_at ?? null, now)) {
      await db.from("alerts").insert({
        animal_id,
        farmer_id,
        kind: "gps_fault",
        severity: "warning",
        message: "alert.gps_fault",
        components: { fix_quality: packet.fix_quality, hdop: packet.hdop, sats: packet.sats }
      });
      await db.from("risk_state").upsert({
        animal_id,
        poor_fix_since,
        situation: "device_fault",
        last_alert_at: now.toISOString(),
        last_alert_kind: "gps_fault",
        updated_at: now.toISOString()
      });
    } else {
      await db.from("risk_state").upsert({
        animal_id,
        poor_fix_since,
        updated_at: now.toISOString()
      });
    }
    return json({
      ok: true,
      vetoed: true,
      reason: "poor gps fix",
      enabled: collarOn,
      steering: false,
      // Silent on a bad fix. Steering on a position that may be 50 m wrong
      // could push her INTO the road.
      cue: { active: false, pattern: "none", side: null, intensity: 0 },
      commands: commands ?? [],
      next_interval_s: 60
    });
  }
  if (!collarOn) {
    await db.from("risk_state").upsert({
      animal_id,
      state: "safe",
      situation: "normal",
      road_risk: 0,
      geofence_risk: 0,
      p_reaches_road_5min: null,
      stationary_since: null,
      on_road_since: null,
      active_alert_id: null,
      components: { collar_disabled: true },
      updated_at: now.toISOString()
    });
    return json({
      ok: true,
      enabled: false,
      steering: false,
      cue: { active: false, pattern: "none", side: null, intensity: 0 },
      commands: commands ?? [],
      next_interval_s: nextIntervalS("normal", null)
    });
  }
  const [{ data: enriched }, { data: sepRate }, { data: fixes }] = await Promise.all([
    db.rpc("enrich_context", { p_animal_id: animal_id, p_lat: packet.lat, p_lon: packet.lon }),
    db.rpc("separation_rate", { p_animal_id: animal_id }),
    // Must go through the RPC. Selecting `position` directly returns hex EWKB
    // (0101000020E610...), not 'POINT(x y)' — the previous regex parse never
    // matched, so the Monte Carlo cone never ran in production.
    db.rpc("recent_fixes", { p_animal_id: animal_id, p_limit: 10 })
  ]);
  const e = enriched ?? {};
  let road_line = [];
  if (e.nearest_road_id) {
    const { data: geo } = await db.rpc("road_line", { p_road_id: e.nearest_road_id });
    if (Array.isArray(geo)) road_line = geo;
  }
  const recent_fixes = Array.isArray(fixes) ? fixes : [];
  const ctx = {
    nearest_road_id: e.nearest_road_id ?? null,
    road_name: e.road_name ?? null,
    road_class: e.road_class ?? null,
    base_risk: e.base_risk ?? 0,
    distance_to_road: e.distance_to_road ?? null,
    bearing_to_road: e.bearing_to_road ?? null,
    inside_zone: e.inside_zone ?? true,
    zone_id: e.zone_id ?? null,
    zone_buffer_m: e.zone_buffer_m ?? 30,
    distance_to_zone_edge: e.distance_to_zone_edge ?? null,
    herd_centroid_lat: e.herd_centroid_lat ?? null,
    herd_centroid_lon: e.herd_centroid_lon ?? null,
    herd_median_dist: e.herd_median_dist ?? null,
    distance_from_centroid: e.distance_from_centroid ?? null,
    separation_rate: sepRate ?? 0,
    current_traffic_speed: e.current_traffic_speed ?? null,
    free_flow_speed: e.free_flow_speed ?? null,
    traffic_confidence: e.traffic_confidence ?? null,
    traffic_is_stale: e.traffic_is_stale ?? true,
    prior_approaches_to_this_road: e.prior_approaches_to_this_road ?? 0,
    recent_fixes,
    road_line
  };
  const out = evaluate({ ...packet, animal_id }, ctx, prior, { now, steeringEnabled });
  let active_alert_id = prior?.active_alert_id ?? null;
  if (out.alert?.notify) {
    const { data: created } = await db.from("alerts").insert({
      animal_id,
      farmer_id,
      kind: out.alert.kind,
      severity: out.alert.severity,
      position: `SRID=4326;POINT(${packet.lon} ${packet.lat})`,
      road_name: out.nearest_road_name,
      distance_m: out.distance_m,
      ttr_seconds: out.ttr_seconds,
      p_reaches_road_5min: out.p_reaches_road_5min,
      components: out.components,
      message: out.alert.message_key,
      escalated_from: out.alert.escalated_from,
      notified: true
    }).select("id").single();
    active_alert_id = created?.id ?? active_alert_id;
  } else if (active_alert_id) {
    await db.from("alerts").update({
      components: out.components,
      distance_m: out.distance_m,
      ttr_seconds: out.ttr_seconds,
      p_reaches_road_5min: out.p_reaches_road_5min,
      ...out.state === "safe" ? { resolved_at: now.toISOString() } : {}
    }).eq("id", active_alert_id);
    if (out.state === "safe") active_alert_id = null;
  }
  const { error: stateErr } = await db.from("risk_state").upsert({
    animal_id,
    state: out.state,
    situation: out.situation,
    road_risk: out.road_risk,
    geofence_risk: out.geofence_risk,
    injury_risk: out.injury_risk,
    p_reaches_road_5min: out.p_reaches_road_5min,
    poor_fix_since: null,
    components: out.components,
    // Persist the cone so the map draws it without re-simulating in the browser.
    cone: out.cone.length ? out.cone : null,
    // The 60 s sustain clocks. Without writing these back, prior.stationary_since
    // is always NULL, the clock restarts every packet, and stationary_on_road
    // — the deadliest state in the product — can never latch (§7.4).
    stationary_since: out.stationary_since,
    on_road_since: out.on_road_since,
    active_alert_id,
    ...out.alert?.notify ? {
      last_alert_at: now.toISOString(),
      last_alert_kind: out.alert.kind,
      last_alert_severity: out.alert.severity
    } : {},
    updated_at: now.toISOString()
  });
  if (stateErr) {
    console.error(`risk_state upsert failed for ${animal_id}: ${stateErr.message}`);
    return json({ error: `risk_state write failed: ${stateErr.message}` }, 500);
  }
  return json({
    ok: true,
    enabled: true,
    steering: steeringEnabled,
    road_risk: out.road_risk,
    state: out.state,
    situation: out.situation,
    p_reaches_road_5min: out.p_reaches_road_5min,
    action: out.action,
    notified: Boolean(out.alert?.notify),
    // What to play, and on which side. The firmware does not decide this.
    cue: {
      active: out.cue.active,
      side: out.cue.side,
      pattern: out.cue.pattern,
      intensity: out.cue.intensity,
      reason: out.cue.reason,
      target_bearing: out.cue.target_bearing
    },
    // Queued from the app: beep, locate, enable/disable, zone push.
    commands: commands ?? [],
    // When to wake next. Server-side so the cadence can change without a
    // firmware flash.
    next_interval_s: nextIntervalS(out.situation, out.distance_m)
  });
});
