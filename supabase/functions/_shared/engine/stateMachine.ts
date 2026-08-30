/**
 * §7.9 — alert state machine: hysteresis, cooldown, escalation.
 *
 * Alert fatigue is the number one way this system dies in the field. Not
 * accuracy — fatigue. The farmer mutes notifications in week two and the
 * product is dead while every metric still looks healthy. An animal
 * oscillating around a single threshold fires forty alerts in ten minutes.
 *
 * All three mechanisms below are required. Removing any one of them
 * reintroduces the failure.
 */

import type {
  AlertState, EngineAction, PendingAlert, RiskStateRow, ScoreComponents, Situation,
} from './types.ts';

/** Hysteresis — different thresholds entering and leaving. */
export const THRESHOLDS = {
  watch:    { enter: 45, leave: 30 },
  warning:  { enter: 65, leave: 45 },
  high:     { enter: 80, leave: 60 },
  critical: { enter: 90, leave: 70 },
} as const;

/** Minimum seconds between notifications of the same kind at the same severity. */
export const COOLDOWN_S = 180;
export const CRITICAL_COOLDOWN_S = 30;

const RANK: Record<AlertState, number> = {
  safe: 0, watch: 1, warning: 2, high: 3, critical: 4,
};

/**
 * Situation severity, tracked SEPARATELY from the state band.
 *
 * BUG THIS FIXES: `on_road` already pins the state to `critical`, so the
 * subsequent on_road -> stationary_on_road transition was FLAT in state terms
 * and returned early — meaning `escalate_to_authority` could never fire for a
 * cow lying still on a highway at night. That is the deadliest situation in
 * the entire problem domain (§7.4) and it was unreachable in production.
 *
 * The acceptance test passed only because it started from `safe` with
 * stationary_since pre-set, a state no real packet sequence produces.
 */
const SITUATION_RANK: Record<Situation, number> = {
  normal: 0,
  device_fault: 0,
  outside_zone: 1,
  possible_injury: 2,
  approaching_road: 2,
  on_road: 3,
  stationary_on_road: 4,
};

/** On-road situations pin the state to critical and leave ONLY when off the road. */
function isOnRoadSituation(s: Situation): boolean {
  return s === 'on_road' || s === 'stationary_on_road';
}

/**
 * Apply hysteresis. The asymmetry is the whole point: an animal hovering at
 * 63–67 crosses the 65 enter-threshold repeatedly but never drops under the
 * 45 leave-threshold, so she enters `warning` exactly once and stays there.
 */
export function nextState(
  current: AlertState,
  roadRisk: number,
  situation: Situation,
): AlertState {
  if (isOnRoadSituation(situation)) return 'critical';

  const cur = RANK[current];

  // Rising: cross the ENTER threshold.
  if (roadRisk >= THRESHOLDS.critical.enter) return 'critical';
  if (roadRisk >= THRESHOLDS.high.enter && cur <= RANK.high) return 'high';
  if (roadRisk >= THRESHOLDS.warning.enter && cur <= RANK.warning) return 'warning';
  if (roadRisk >= THRESHOLDS.watch.enter && cur <= RANK.watch) return 'watch';

  // Falling: only drop when under the LEAVE threshold of the current state.
  switch (current) {
    case 'critical':
      return roadRisk < THRESHOLDS.critical.leave ? demote('high', roadRisk) : 'critical';
    case 'high':
      return roadRisk < THRESHOLDS.high.leave ? demote('warning', roadRisk) : 'high';
    case 'warning':
      return roadRisk < THRESHOLDS.warning.leave ? demote('watch', roadRisk) : 'warning';
    case 'watch':
      return roadRisk < THRESHOLDS.watch.leave ? 'safe' : 'watch';
    default:
      return 'safe';
  }
}

/** Cascade downward in one evaluation if the risk collapsed several bands. */
function demote(to: AlertState, roadRisk: number): AlertState {
  switch (to) {
    case 'high':    return roadRisk < THRESHOLDS.high.leave ? demote('warning', roadRisk) : 'high';
    case 'warning': return roadRisk < THRESHOLDS.warning.leave ? demote('watch', roadRisk) : 'warning';
    case 'watch':   return roadRisk < THRESHOLDS.watch.leave ? 'safe' : 'watch';
    default:        return 'safe';
  }
}

export interface AlertDecision {
  state: AlertState;
  action: EngineAction;
  alert: PendingAlert | null;
  /** True when an existing alert row should be updated silently. */
  silent_update: boolean;
  /** True when the outstanding alert should be marked resolved. */
  resolve: boolean;
}

export interface DecideInput {
  prior: Pick<RiskStateRow,
    'state' | 'situation' | 'last_alert_at' | 'last_alert_kind'
    | 'last_alert_severity' | 'active_alert_id'> | null;
  roadRisk: number;
  situation: Situation;
  components: ScoreComponents;
  roadName: string | null;
  distanceM: number | null;
  ttrSeconds: number | null;
  pReachesRoad: number | null;
  isNight: boolean;
  now: Date;
}

export function decideAlert(i: DecideInput): AlertDecision {
  const prior = i.prior;
  const from: AlertState = prior?.state ?? 'safe';
  const to = nextState(from, i.roadRisk, i.situation);

  const rising = RANK[to] > RANK[from];
  const falling = RANK[to] < RANK[from];

  // A worsening SITUATION is an escalation even when the state band is flat,
  // because on_road and stationary_on_road are BOTH `critical` — without this
  // the night-escalation path below is unreachable by any real packet sequence.
  //
  // Deliberately narrow: it only fires when arriving at an ON-ROAD state.
  // Allowing it for approaching_road would reopen the fatigue hole, since
  // `approaching_road` flaps back to `normal` whenever closing speed dips
  // below the epsilon, and each re-entry would notify again.
  const priorSituation: Situation = prior?.situation ?? 'normal';
  const situationWorsened =
    isOnRoadSituation(i.situation) &&
    SITUATION_RANK[i.situation] > SITUATION_RANK[priorSituation];

  const kind: PendingAlert['kind'] = isOnRoadSituation(i.situation) ? 'on_road' : 'road_risk';

  // ---- Falling: update the row, never notify. Resolve at the bottom. -----
  if (falling && !situationWorsened) {
    // If it fully resolved to safe from a non-safe state, emit a 'steered_safe' alert.
    if (to === 'safe' && RANK[from] >= RANK.warning) {
      return {
        state: to,
        action: 'notify',
        silent_update: false,
        resolve: true,
        alert: {
          kind: 'steered_safe',
          severity: 'info',
          message_key: 'alert.steered_safe',
          message_params: {},
          escalated_from: prior?.active_alert_id ?? null,
          notify: true,
        } as PendingAlert,
      };
    }

    return {
      state: to,
      action: 'none',
      alert: null,
      silent_update: true,
      resolve: to === 'safe',
    };
  }

  // ---- Flat: silently update the existing alert. NO notification. --------
  // This is the branch that turns forty alerts into one. It must NOT swallow
  // a situation that got materially worse while staying in the same band.
  if (!rising && !situationWorsened) {
    return {
      state: to,
      action: to === 'critical' ? 'notify_and_buzz' : 'none',
      alert: null,
      silent_update: RANK[to] >= RANK.warning,
      resolve: false,
    };
  }

  // ---- Rising (or situation worsened): escalate. -------------------------
  // Below `warning` there is nothing to tell the farmer; `watch` is a UI
  // colour, not an interruption.
  if (RANK[to] < RANK.warning) {
    return { state: to, action: 'none', alert: null, silent_update: false, resolve: false };
  }

  const severity: PendingAlert['severity'] =
    to === 'critical' ? 'critical' : to === 'high' ? 'high' : 'warning';

  // Cooldown guards REPETITION, not escalation.
  //
  // BUG THIS FIXES: the old test was `!severityIncreased`, computed as
  // RANK[to] > RANK[from] — textually identical to `rising`, and unreachable
  // unless rising was already true. It was therefore ALWAYS true, making
  // cooldownBlocks always false: the 180 s cooldown was dead code.
  //
  // The meaningful comparison is against the last severity we actually
  // NOTIFIED at, which survives across the fall-and-rise cycle that a state
  // comparison cannot see.
  const sameKind = prior?.last_alert_kind === kind;
  const lastSeverity = prior?.last_alert_severity ?? null;
  const notMoreSevere =
    lastSeverity !== null && RANK[severity as AlertState] <= RANK[lastSeverity as AlertState];
  const sinceLast = prior?.last_alert_at
    ? (i.now.getTime() - new Date(prior.last_alert_at).getTime()) / 1000
    : Infinity;

  const effectiveCooldown = to === 'critical' ? CRITICAL_COOLDOWN_S : COOLDOWN_S;
  const cooldownBlocks = sameKind && notMoreSevere && sinceLast < effectiveCooldown;

  if (cooldownBlocks) {
    return { state: to, action: 'none', alert: null, silent_update: true, resolve: false };
  }

  // §7.4 — stationary on a road at night is the one case that escalates beyond
  // the farmer: voice call, authority, continuous buzzer.
  const nightStationary = i.situation === 'stationary_on_road' && i.isNight;

  const action: EngineAction = nightStationary
    ? 'escalate_to_authority'
    : to === 'critical' || to === 'high'
      ? 'notify_and_buzz'
      : 'notify';

  const message_key =
    i.situation === 'stationary_on_road' ? 'alert.stationary_on_road'
    : i.situation === 'on_road' ? 'alert.on_road'
    : i.situation === 'outside_zone' ? 'alert.outside_zone'
    : 'alert.approaching_road';

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
        road: i.roadName ?? 'the road',
        distance: i.distanceM ?? 0,
        minutes: i.ttrSeconds ? Math.max(1, Math.round(i.ttrSeconds / 60)) : 0,
      },
      // Upgrade chain, not a new incident — the UI renders these as one thread.
      escalated_from: RANK[from] >= RANK.warning ? (prior?.active_alert_id ?? null) : null,
      notify: true,
    },
  };
}
