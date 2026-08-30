/**
 * Grazing schedules — "from 6am to 6pm this field is the grazing area".
 *
 * Outside its hours a zone is NOT a fence: the collar stops cueing and no
 * geofence alerts fire. That is the point — the farmer walks the herd out at
 * dawn and back at dusk, and the system should not fight him twice a day.
 *
 * A highway is never on a schedule. Road steering keeps working around the
 * clock regardless of what is set here, and the panel says so, because a
 * farmer who believes he has switched everything off has been misled.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';

interface Zone {
  id: string;
  name: string;
  buffer_m: number;
  is_enabled: boolean;
  active_from: string | null;
  active_to: string | null;
  active_days: number[] | null;
  drawn_by: string | null;
}

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Postgres `time` comes back as HH:MM:SS; <input type=time> wants HH:MM. */
const toInput = (t: string | null) => (t ? t.slice(0, 5) : '');
const fromInput = (v: string) => (v ? `${v}:00` : null);

export function ZoneSchedules() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('grazing_zones')
      .select('id, name, buffer_m, is_enabled, active_from, active_to, active_days, drawn_by')
      .order('name');
    setZones((data ?? []) as Zone[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, fields: Partial<Zone>) {
    setSaving(id);
    setZones((zs) => zs.map((z) => (z.id === id ? { ...z, ...fields } : z)));
    await supabase.from('grazing_zones').update(fields).eq('id', id);
    setSaving(null);
  }

  function toggleDay(z: Zone, day: number) {
    const cur = z.active_days ?? ALL_DAYS;
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort();
    void patch(z.id, { active_days: next });
  }

  if (zones.length === 0) {
    return (
      <p className="p-4 text-center text-[16px] font-semibold opacity-60">
        No grazing areas yet. Draw one above.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {zones.map((z) => {
        const days = z.active_days ?? ALL_DAYS;
        const allDay = !z.active_from || !z.active_to;
        return (
          <section key={z.id} className="card">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[18px] font-bold">{z.name}</h3>
                <p className="text-[14px] font-semibold opacity-60">
                  {/* No 'Circle' branch: that mode is gone and every circle
                      zone has been removed, so the old fallback could only
                      ever mislabel a zone drawn some other way. */}
                  {z.drawn_by === 'walk' ? 'Walked' : 'Corners'}
                  {' · '}warns {z.buffer_m} m before the edge
                </p>
              </div>
              <input
                type="checkbox"
                checked={z.is_enabled}
                onChange={(e) => void patch(z.id, { is_enabled: e.target.checked })}
                className="h-8 w-8 shrink-0 accent-[#43A047]"
                aria-label="Area on"
              />
            </div>

            {z.is_enabled && (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-[14px] font-bold">
                    Grazing from
                    <input
                      type="time" value={toInput(z.active_from)}
                      onChange={(e) => void patch(z.id, { active_from: fromInput(e.target.value) })}
                      className="tnum mt-1 w-full rounded-lg border-2 border-line p-2 text-[17px]"
                    />
                  </label>
                  <label className="text-[14px] font-bold">
                    until
                    <input
                      type="time" value={toInput(z.active_to)}
                      onChange={(e) => void patch(z.id, { active_to: fromInput(e.target.value) })}
                      className="tnum mt-1 w-full rounded-lg border-2 border-line p-2 text-[17px]"
                    />
                  </label>
                </div>

                <div className="mt-3 flex gap-1">
                  {DAYS.map((label, i) => (
                    <button
                      key={i}
                      onClick={() => toggleDay(z, i)}
                      aria-pressed={days.includes(i)}
                      className={`h-11 flex-1 rounded-lg text-[15px] font-extrabold ${
                        days.includes(i) ? 'bg-green text-text' : 'bg-card2 text-dim'
                      }`}
                      style={{ minWidth: 0, minHeight: 44 }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <p className="mt-2 text-[14px] font-semibold opacity-70">
                  {allDay
                    ? 'Fence is on all day.'
                    : `Fence is on ${toInput(z.active_from)}–${toInput(z.active_to)}` +
                      (days.length === 7 ? ', every day.' : ` on ${days.length} days.`)}
                </p>

                {/* Never let the farmer believe a schedule silences a highway. */}
                <p className="mt-1 text-[14px] font-bold" style={{ color: 'var(--red)' }}>
                  Road warnings always stay on.
                </p>
              </>
            )}

            {saving === z.id && (
              <p className="mt-2 text-[14px] font-semibold opacity-60">Saving…</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
