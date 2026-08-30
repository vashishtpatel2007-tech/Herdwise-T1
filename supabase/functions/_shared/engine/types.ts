/**
 * PashuGuard — Engine B type contract (§7.10)
 *
 * This module is deliberately dependency-free. It runs unchanged in Deno
 * (Edge Function), Node (tests, simulator) and the browser (optimistic UI).
 * Nothing here may import Supabase, fetch, or any runtime-specific API.
 */

/** Exactly the 18-byte collar packet, decoded. Nothing more fits over LoRa. */
export interface TelemetryInput {
  device_id: string;
  animal_id: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  heading_deg: number;
  fix_quality: number; // 0 none, 1 2D, 2 3D, 3 3D+good HDOP
  hdop: number;
  sats: number;
  battery_pct: number;
  /** Conclusion from the collar IMU, never raw accelerometer data. */
  movement_state: 0 | 1 | 2 | 3; // still | grazing | walking | running
  event_code: number; // 0 hb, 1 motion, 2 geofence, 3 road_approach, 4 fall, 5 on_road, 6 tamper
  seq: number;
  
  // --- Local Engine Data ---
  risk_score?: number;
  boundary_distance?: number;
  state?: string;
  buzzer_on?: boolean;
  /** Calibrated dynamic acceleration in g, from the collar's MPU6050. */
  acceleration?: number;
  boundary_pts?: number;
  boundary_hash?: number;
  risk_type?: string;
  vibration_on?: boolean;
  
  /** Array of UUIDs of commands that the device successfully processed. */
  acked?: string[];

  /**
   * Optional: a collar with no clock (the GSM leader) omits this, and the
   * ingest endpoint stamps receipt time instead. Declaring it required while
   * the firmware never sent it is what hid the NOT NULL insert failure.
   */
  recorded_at?: string;
}

/** Everything Engine B looks up from Postgres before scoring (§7.10). */
export interface EnrichedContext {
  nearest_road_id: number | null;
  road_name: string | null;
  road_class: string | null;
  base_risk: number; // 0..5
  distance_to_road: number | null; // metres
  bearing_to_road: number | null; // degrees, 0=N
  inside_zone: boolean;
  zone_id: string | null;
  zone_buffer_m: number;
  distance_to_zone_edge: number | null;
  /** Zone centroid — the direction steering pushes her back toward. */
  zone_centre_lat: number | null;
  zone_centre_lon: number | null;
  /** False when the zone's schedule says it is not in force right now. */
  zone_active: boolean;
  herd_centroid_lat: number | null;
  herd_centroid_lon: number | null;
  herd_median_dist: number | null;
  distance_from_centroid: number | null;
  separation_rate: number; // m/min, positive = drifting away
  current_traffic_speed: number | null;
  free_flow_speed: number | null;
  traffic_confidence: number | null;
  traffic_is_stale: boolean;
  prior_approaches_to_this_road: number;
  /** Last 10 good fixes, oldest first. Drives the Monte Carlo cone. */
  recent_fixes: Array<{ lat: number; lon: number; recorded_at: string }>;
  /** Nearest road as a polyline [[lat,lon], ...]. Monte Carlo tests against it. */
  road_line: Array<[number, number]>;
}

/** Persisted per-animal state. Hysteresis and cooldown are impossible without it. */
export interface RiskStateRow {
  animal_id: string;
  state: AlertState;
  situation: Situation;
  road_risk: number;
  geofence_risk: number;
  injury_risk: number;
  p_reaches_road_5min: number | null;
  stationary_since: string | null;
  on_road_since: string | null;
  poor_fix_since: string | null;
  last_alert_at: string | null;
  last_alert_kind: string | null;
  /** Severity we last actually NOTIFIED at. Without it the cooldown is dead. */
  last_alert_severity: 'warning' | 'high' | 'critical' | null;
  active_alert_id: string | null;
  components: ScoreComponents | null;
}

export type AlertState = 'safe' | 'watch' | 'warning' | 'high' | 'critical';

export type Situation =
  | 'normal'
  | 'approaching_road'
  | 'on_road'
  | 'stationary_on_road'
  | 'outside_zone'
  | 'possible_injury'
  | 'device_fault';

export type EngineAction =
  | 'none'
  | 'notify'
  | 'notify_and_buzz'
  | 'escalate_to_authority';

/** The jsonb we store on every evaluation so "why did it fire?" has an answer. */
export interface ScoreComponents {
  proximity: number;
  closing: number;
  road_factor: number;
  traffic_f: number;
  isolation: number;
  outside_zone: number;
  /** True when traffic_f came from the clock, not TomTom (§13.4). */
  traffic_fallback: boolean;
  /** Set when an override in §7.4 replaced the weighted sum. */
  override?: 'on_road' | 'stationary_on_road';
}

export interface DerivedFeatures {
  distance_to_road: number | null;
  bearing_to_road: number | null;
  /** Angular difference between heading and bearing-to-road, 0..180. */
  theta_deg: number | null;
  /** speed × cos(theta). Negative or ~0 means not approaching. */
  closing_speed: number;
  /** NULL when not approaching — never extrapolate a parallel walker. */
  ttr_seconds: number | null;
  on_road: boolean;
  stationary_on_road: boolean;
  is_isolated: boolean;
  separation_rate: number;
  outside_zone: boolean;
  is_night: boolean;
}

export interface EngineOutput {
  road_risk: number; // 0..100 integer
  geofence_risk: number; // 0..100 integer
  injury_risk: number; // 0..100 integer
  situation: Situation;
  state: AlertState;
  /** The only genuine probability in the system (§7.7). Null when not computed. */
  p_reaches_road_5min: number | null;
  nearest_road_name: string | null;
  distance_m: number | null;
  ttr_seconds: number | null;
  components: ScoreComponents;
  action: EngineAction;
  /** Populated only when a notification should actually be sent (§7.9). */
  alert: PendingAlert | null;
  /** Set when the GPS veto (§7.2) skipped risk evaluation entirely. */
  vetoed: boolean;
  veto_reason: string | null;
  /** 500 simulated endpoints for the map cone. Empty unless MC ran. */
  cone: Array<[number, number]>;
  /**
   * Sustain clocks that MUST be written back to risk_state.
   *
   * These were previously computed and then discarded, so prior.stationary_since
   * was permanently NULL, the 60 s clock restarted on every packet, and
   * `stationary_on_road` — the deadliest state in the product — could never
   * become true in production (§7.4).
   */
  stationary_since: string | null;
  on_road_since: string | null;
  /**
   * What the collar should actually DO. This is the half that makes it a
   * fence rather than a reporter — the app can be closed and the animal is
   * still steered.
   */
  cue: import('./steering.ts').SteeringCue;
}

export interface PendingAlert {
  kind: 'road_risk' | 'on_road' | 'geofence' | 'fall' | 'low_battery' | 'offline' | 'gps_fault' | 'steered_safe' | 'outside_zone' | 'geofence_breach';
  severity: 'warning' | 'high' | 'critical' | 'info' | 'safe';
  message_key: string;
  /** Interpolated into the i18n string. Keeps copy translatable (§11). */
  message_params: Record<string, string | number>;
  escalated_from: string | null;
  notify: boolean;
}
