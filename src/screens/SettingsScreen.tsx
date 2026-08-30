/**
 * §9.6 — Settings: alert preferences per kind, quiet hours, helpers, language.
 *
 * Quiet hours deliberately cannot suppress a critical alert, and the UI says so
 * rather than hiding it. A farmer who believes he has muted everything, and is
 * then woken at 2am, has been lied to; a farmer who was told criticals always
 * come through has been given a working mental model of his own tool.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { setLanguage } from '../i18n/index.ts';

interface Helper { id: string; name: string; phone: string; receives_critical: boolean }
interface Zone { id: string; name: string; is_enabled: boolean }

const ALERT_KINDS = ['road_risk', 'on_road', 'geofence', 'fall', 'low_battery', 'offline'] as const;

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const [helpers, setHelpers] = useState<Helper[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('pashuguard.alertPrefs') ?? '{}'); }
    catch { return {}; }
  });
  const [quiet, setQuiet] = useState<{ enabled: boolean; from: number; to: number }>(() => {
    try {
      const raw = localStorage.getItem('pashuguard.quietHours');
      return raw ? { enabled: true, ...JSON.parse(raw) } : { enabled: false, from: 22, to: 6 };
    } catch { return { enabled: false, from: 22, to: 6 }; }
  });

  useEffect(() => {
    void (async () => {
      const [h, z] = await Promise.all([
        supabase.from('helpers').select('*'),
        supabase.from('grazing_zones').select('id, name, is_enabled').order('name'),
      ]);
      setHelpers((h.data ?? []) as Helper[]);
      setZones((z.data ?? []) as Zone[]);
    })();
  }, []);

  const activeZone = zones.find((z) => z.is_enabled) ?? null;

  /**
   * Which zone comes back when the switch flips back on -- the one that was
   * JUST turned off, remembered here rather than re-derived. Re-deriving it
   * as "the first zone in the list" picked whichever row sorted first
   * alphabetically, which silently re-enabled the wrong fence the one time
   * this was tested against real data (a stray "Grazing area" instead of the
   * real "Home field"). A ref survives the toggle-off's setZones update.
   */
  const lastActiveZoneId = useRef<string | null>(null);

  /**
   * Only one zone can ever be enabled -- a database trigger enforces this now,
   * after three test shapes ended up active at once and fought over what the
   * collar's actual fence should be. Turning it off here does not delete the
   * shape; the farmer's drawing is still there, just not being enforced.
   */
  async function toggleGeofencing(on: boolean) {
    setZoneBusy(true);
    try {
      if (on) {
        // Nothing to re-enable if she never drew one -- send her to Fields
        // instead of flipping a switch that would silently do nothing.
        const target = zones.find((z) => z.id === lastActiveZoneId.current) ?? zones[0];
        if (!target) return;
        await supabase.from('grazing_zones').update({ is_enabled: true }).eq('id', target.id);
        setZones((zs) => zs.map((z) => ({ ...z, is_enabled: z.id === target.id })));
      } else if (activeZone) {
        lastActiveZoneId.current = activeZone.id;
        await supabase.from('grazing_zones').update({ is_enabled: false }).eq('id', activeZone.id);
        setZones((zs) => zs.map((z) => (z.id === activeZone.id ? { ...z, is_enabled: false } : z)));
      }
    } finally {
      setZoneBusy(false);
    }
  }

  function savePrefs(next: Record<string, boolean>) {
    setPrefs(next);
    localStorage.setItem('pashuguard.alertPrefs', JSON.stringify(next));
  }

  function saveQuiet(next: typeof quiet) {
    setQuiet(next);
    if (next.enabled) {
      localStorage.setItem('pashuguard.quietHours', JSON.stringify({ from: next.from, to: next.to }));
    } else {
      localStorage.removeItem('pashuguard.quietHours');
    }
  }

  async function addHelper() {
    if (!name.trim() || !phone.trim()) return;
    const { data: farmer } = await supabase.from('farmers').select('id').maybeSingle();
    if (!farmer) return;
    const { data } = await supabase.from('helpers')
      .insert({ farmer_id: farmer.id, name, phone, receives_critical: true })
      .select('*').single();
    if (data) setHelpers((h) => [...h, data as Helper]);
    setName(''); setPhone('');
  }

  return (
    <div className="h-full overflow-y-auto bg-card2 p-4">
      <h1 className="d-lg">{t('nav.settings')}</h1>

      <section className="card mt-4">
        <h2 className="mb-3 text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Language
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {(['en', 'hi', 'kn'] as const).map((l) => (
            <button key={l} onClick={() => setLanguage(l)}
                    className={`btn text-[15px] ${
                      i18n.language === l ? 'bg-green text-text' : 'bg-card2 text-text'}`}>
              {{ en: 'English', hi: 'हिंदी', kn: 'ಕನ್ನಡ' }[l]}
            </button>
          ))}
        </div>
      </section>

      <section className="card mt-4">
        <h2 className="mb-1 text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Grazing perimeter
        </h2>
        <p className="mb-3 text-[15px] font-semibold opacity-70">
          Turning this off stops the collar enforcing any fence -- for moving
          the herd between fields. It does not delete anything you drew.
        </p>

        {zones.length === 0 ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px] font-semibold opacity-70">No perimeter drawn yet.</span>
            <Link to="/fields" className="btn btn-primary shrink-0">Draw one</Link>
          </div>
        ) : (
          <>
            <label className="flex items-center justify-between">
              <span className="text-[16px] font-semibold">
                {activeZone ? `Enabled — "${activeZone.name}"` : 'Enabled'}
              </span>
              <input type="checkbox" checked={activeZone !== null} disabled={zoneBusy}
                     onChange={(e) => void toggleGeofencing(e.target.checked)}
                     className="h-7 w-7 accent-[#43A047]" />
            </label>
            {!activeZone && (
              <p className="mt-2 text-[14px] font-semibold opacity-60">
                Off. She can cross any boundary without a warning.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card mt-4">
        <h2 className="mb-3 text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Alerts
        </h2>
        {ALERT_KINDS.map((k) => (
          <label key={k} className="flex items-center justify-between gap-3
                                    border-b border-line last:border-0">
            <span className="text-[16px] font-semibold">{k.replace(/_/g, ' ')}</span>
            <input
              type="checkbox"
              checked={prefs[k] !== false}
              onChange={(e) => savePrefs({ ...prefs, [k]: e.target.checked })}
              className="h-7 w-7 accent-[#43A047]"
            />
          </label>
        ))}
      </section>

      <section className="card mt-4">
        <h2 className="mb-1 text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Quiet hours
        </h2>
        {/* Stated plainly, not buried. See the file header. */}
        <p className="mb-3 text-[15px] font-semibold opacity-70">
          Danger alerts always come through, even during quiet hours.
        </p>
        <label className="flex items-center justify-between">
          <span className="text-[16px] font-semibold">Enabled</span>
          <input type="checkbox" checked={quiet.enabled}
                 onChange={(e) => saveQuiet({ ...quiet, enabled: e.target.checked })}
                 className="h-7 w-7 accent-[#43A047]" />
        </label>
        {quiet.enabled && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-[15px] font-semibold">
              From
              <input type="number" min={0} max={23} value={quiet.from}
                     onChange={(e) => saveQuiet({ ...quiet, from: Number(e.target.value) })}
                     className="tnum mt-1 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
            </label>
            <label className="text-[15px] font-semibold">
              To
              <input type="number" min={0} max={23} value={quiet.to}
                     onChange={(e) => saveQuiet({ ...quiet, to: Number(e.target.value) })}
                     className="tnum mt-1 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
            </label>
          </div>
        )}
      </section>

      <section className="card mt-4">
        <h2 className="mb-1 text-[15px] font-extrabold uppercase tracking-wide opacity-60">
          Helpers
        </h2>
        <p className="mb-3 text-[15px] font-semibold opacity-70">
          A son, neighbour or hired hand who also gets danger alerts.
        </p>
        <ul className="mb-3 grid gap-2">
          {helpers.map((h) => (
            <li key={h.id} className="flex items-center justify-between rounded-lg bg-card2 p-3">
              <span className="text-[16px] font-bold">{h.name}</span>
              <a href={`tel:${h.phone}`} className="tnum text-[16px] font-semibold underline">
                {h.phone}
              </a>
            </li>
          ))}
        </ul>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
               className="mb-2 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone"
               inputMode="tel"
               className="mb-2 w-full rounded-lg border-2 border-line p-3 text-[17px]" />
        <button onClick={() => void addHelper()} className="btn btn-primary w-full">Add helper</button>
      </section>
    </div>
  );
}
