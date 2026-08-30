import fs from 'fs';

let content = fs.readFileSync('supabase/functions/_shared/engine/stateMachine.ts', 'utf-8');

const target1 = `export const COOLDOWN_S = 180;`;
const replacement1 = `export const COOLDOWN_S = 180;\nexport const CRITICAL_COOLDOWN_S = 30;`;

const target2 = `  const cooldownBlocks = sameKind && notMoreSevere && sinceLast < COOLDOWN_S;`;
const replacement2 = `  const effectiveCooldown = to === 'critical' ? CRITICAL_COOLDOWN_S : COOLDOWN_S;\n  const cooldownBlocks = sameKind && notMoreSevere && sinceLast < effectiveCooldown;`;

const target3 = `  // ---- Falling: update the row, never notify. Resolve at the bottom. -----
  if (falling && !situationWorsened) {
    return {
      state: to,
      action: 'none',
      alert: null,
      silent_update: true,
      resolve: to === 'safe',
    };
  }`;

const replacement3 = `  // ---- Falling: update the row, never notify. Resolve at the bottom. -----
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
  }`;

content = content.replace(target1, replacement1);
content = content.replace(target2, replacement2);
content = content.replace(target3, replacement3);

fs.writeFileSync('supabase/functions/_shared/engine/stateMachine.ts', content);
console.log("Patched stateMachine.ts");
