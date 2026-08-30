/**
 * Live herd state — subscribed ONCE, shared by everyone.
 *
 * This used to be a plain hook. The moment two components wanted it (the tab
 * bar needs the alert count; the screen needs the animals) it opened a second
 * Supabase Realtime channel with the same name and threw:
 *   "cannot add postgres_changes callbacks for realtime:herd after subscribe()"
 * — which unmounted the whole app into a blank screen.
 *
 * One provider owns the socket and every consumer reads the same state. That
 * is also the right shape on a village connection: one websocket, not one per
 * component that happens to care.
 *
 * `lastSyncAt` is deliberately exposed and deliberately honest. When the
 * connection drops we keep rendering the last known positions, but the UI must
 * be able to say how old they are. Silently showing stale dots as live is the
 * single most damaging thing this app could do.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';
import { supabase, type AnimalRow, type LivePosition, type RiskRow } from './supabase.ts';

export interface HerdMember {
  animal: AnimalRow;
  position: LivePosition | null;
  risk: RiskRow | null;
}

interface HerdValue {
  herd: HerdMember[];
  counts: { safe: number; out: number; danger: number };
  loading: boolean;
  error: string | null;
  online: boolean;
  lastSyncAt: number | null;
  refresh: () => Promise<void>;
}

const HerdContext = createContext<HerdValue | null>(null);

export function HerdProvider({ children }: { children: ReactNode }) {
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [positions, setPositions] = useState<Record<string, LivePosition>>({});
  const [risks, setRisks] = useState<Record<string, RiskRow>>({});
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, p, r] = await Promise.all([
        supabase.from('animals').select('*').eq('is_active', true).order('name'),
        supabase.from('latest_positions').select('*'),
        supabase.from('risk_state').select('*'),
      ]);
      if (a.error) throw a.error;

      setAnimals(a.data ?? []);
      setPositions(Object.fromEntries((p.data ?? []).map((x) => [x.animal_id, x as LivePosition])));
      setRisks(Object.fromEntries((r.data ?? []).map((x) => [x.animal_id, x as RiskRow])));
      setLastSyncAt(Date.now());
      setError(null);
    } catch (e) {
      // Keep whatever is already on screen. An empty map is a lie of omission;
      // the banner tells the farmer the data has stopped moving.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const on = () => { setOnline(true); void load(); };
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('herd')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'risk_state' }, (payload) => {
        const row = payload.new as RiskRow;
        if (row?.animal_id) {
          setRisks((prev) => ({ ...prev, [row.animal_id]: row }));
          setLastSyncAt(Date.now());
        }
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telemetry' }, () => {
        // Positions arrive as PostGIS geography; re-read the view rather than
        // parsing binary geometry in the browser.
        void load();
      })
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, [load]);

  const herd = useMemo<HerdMember[]>(
    () => animals.map((animal) => ({
      animal,
      position: positions[animal.id] ?? null,
      risk: risks[animal.id] ?? null,
    })),
    [animals, positions, risks],
  );

  const counts = useMemo(() => {
    let safe = 0, out = 0, danger = 0;
    for (const m of herd) {
      const s = m.risk?.state ?? 'safe';
      const sit = m.risk?.situation;
      if (s === 'high' || s === 'critical') danger++;
      // device_fault must NOT count as safe: the poor-fix path leaves `state`
      // untouched, so a collar that cannot see the sky would otherwise be
      // reported as fine about an animal whose position is unknown.
      else if (sit === 'device_fault' || sit === 'outside_zone'
               || s === 'warning' || s === 'watch') out++;
      else safe++;
    }
    return { safe, out, danger };
  }, [herd]);

  const value = useMemo<HerdValue>(
    () => ({ herd, counts, loading, error, online, lastSyncAt, refresh: load }),
    [herd, counts, loading, error, online, lastSyncAt, load],
  );

  return <HerdContext.Provider value={value}>{children}</HerdContext.Provider>;
}

export function useHerd(): HerdValue {
  const ctx = useContext(HerdContext);
  if (!ctx) throw new Error('useHerd must be used inside <HerdProvider>');
  return ctx;
}
