/**
 * Collar control panel.
 *
 * Every control here names what physically happens (§10): "Collar is ON",
 * "Make it beep". Nothing says "actuator" or "downlink".
 *
 * The honesty rule that matters most on this screen: a command is QUEUED, not
 * executed. A collar on a duty-cycled radio may be minutes from its next
 * wake-up. Showing a green tick the instant the button is pressed would be a
 * lie, so state is shown as Queued -> Delivered with the age attached.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  beep, commandHistory, getCollar, muteFor, requestLive, setCollarEnabled,
  setSteering, steerTest, type CollarState,
} from '../lib/collar.ts';
import { ageLabel, batteryWords } from '../lib/format.ts';

interface CmdRow {
  id: string; command: string; created_at: string;
  delivered_at: string | null; acked_at: string | null; expires_at: string;
}

export function CollarControl({ animalId }: { animalId: string }) {
  const { t } = useTranslation();
  const [collar, setCollar] = useState<CollarState | null>(null);
  const [history, setHistory] = useState<CmdRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const c = await getCollar(animalId);
    setCollar(c);
    if (c) setHistory((await commandHistory(c.device_id)) as CmdRow[]);
  }, [animalId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Commands land on the collar's NEXT wake-up, so poll while the panel is
  // open rather than pretending the state is instant.
  useEffect(() => {
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!collar) {
    return (
      <div className="card">
        <p className="text-[16px] font-semibold opacity-70">No collar on this animal.</p>
      </div>
    );
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try { await fn(); await refresh(); } finally { setBusy(null); }
  }

  const muted = collar.mute_until ? new Date(collar.mute_until) > new Date() : false;
  const live = collar.live_until ? new Date(collar.live_until) > new Date() : false;

  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Collar
        </h2>
        <span className="tnum text-[14px] font-semibold opacity-60">
          {collar.device_key}
        </span>
      </div>

      <p className="mt-1 text-[15px] font-semibold opacity-70">
        {batteryWords(collar.battery_pct, t)} · {ageLabel(collar.last_seen_at, t)}
      </p>

      {/* Master switch. Copy states the consequence, because this is the one
          control that can silence a real danger. */}
      <label className="mt-4 flex items-center justify-between gap-3
                        rounded-xl bg-card2 px-4">
        <span>
          <span className="block text-[17px] font-bold">
            {collar.is_enabled ? 'Collar is ON' : 'Collar is OFF'}
          </span>
          <span className="block text-[14px] font-semibold opacity-70">
            {collar.is_enabled
              ? 'Fence and road warnings are working'
              : 'No warnings. Location still shows.'}
          </span>
        </span>
        <input
          type="checkbox"
          checked={collar.is_enabled}
          disabled={busy !== null}
          onChange={(e) => void run('enable', () => setCollarEnabled(collar.device_id, e.target.checked))}
          className="h-8 w-8 shrink-0 accent-[#43A047]"
        />
      </label>

      {!collar.is_enabled && (
        <p className="mt-2 rounded-xl bg-amber/15 p-3 text-[15px] font-bold">
          Turn the collar back on when the animals are back in their field.
        </p>
      )}

      <label className="mt-2 flex items-center justify-between gap-3
                        rounded-xl bg-card2 px-4">
        <span>
          <span className="block text-[17px] font-bold">Steering</span>
          <span className="block text-[14px] font-semibold opacity-70">
            Sound and vibration that turn her around
          </span>
        </span>
        <input
          type="checkbox"
          checked={collar.steering_on && collar.is_enabled}
          disabled={busy !== null || !collar.is_enabled}
          onChange={(e) => void run('steer', () => setSteering(collar.device_id, e.target.checked))}
          className="h-8 w-8 shrink-0 accent-[#43A047]"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          disabled={busy !== null}
          onClick={() => void run('beep', () => beep(collar.device_id))}
          className="btn btn-primary text-[15px] disabled:opacity-40"
        >
          {t('animal.make_beep')}
        </button>
        <button
          disabled={busy !== null}
          onClick={() => void run('live', () => requestLive(collar.device_id, 10))}
          className={`btn text-[15px] ${live ? 'bg-green text-white' : 'btn-ghost'}`}
        >
          {live ? 'Live · on' : t('animal.see_live')}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <button disabled={busy !== null}
                onClick={() => void run('l', () => steerTest(collar.device_id, 'left'))}
                className="btn btn-ghost text-[15px]">Test ←</button>
        <button disabled={busy !== null}
                onClick={() => void run('r', () => steerTest(collar.device_id, 'right'))}
                className="btn btn-ghost text-[15px]">Test →</button>
        <button disabled={busy !== null}
                onClick={() => void run('mute', () => muteFor(collar.device_id, 60))}
                className={`btn text-[15px] ${muted ? 'bg-amber text-text' : 'btn-ghost'}`}>
          {muted ? 'Muted' : 'Mute 1h'}
        </button>
      </div>

      {live && (
        <p className="mt-2 text-[14px] font-semibold opacity-70">
          Reporting every 5 seconds until {new Date(collar.live_until!).toLocaleTimeString()}.
          Uses more battery.
        </p>
      )}

      {/* Queued vs delivered, never a fake instant tick. */}
      {history.length > 0 && (
        <ul className="mt-4 grid gap-1">
          {history.slice(0, 5).map((c) => {
            const expired = !c.delivered_at && new Date(c.expires_at) < new Date();
            return (
              <li key={c.id} className="flex justify-between text-[14px] font-semibold">
                <span>{c.command.replace(/_/g, ' ')}</span>
                <span className={expired ? 'text-red' : 'opacity-60'}>
                  {c.delivered_at ? `sent ${ageLabel(c.delivered_at, t)}`
                    : expired ? 'expired — collar was asleep'
                    : 'waiting for collar'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
