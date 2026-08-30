/**
 * Alerts — FARMO style.
 *
 * Matches the reference: clean alert cards with colored icons,
 * "Today" section grouping, "Road Not Detected", "Leaving Grazing Area",
 * "Low Battery" style alerts.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { ageLabel } from '../lib/format.ts';
import { EmptyState } from '../components/EmptyState.tsx';
import { IconBell, IconPin, IconCollar, IconShield, IconWarning, IconCheck } from '../components/Icons.tsx';
import { SwipeableList, SwipeableListItem, SwipeAction, TrailingActions, Type as ListType } from 'react-swipeable-list';
import 'react-swipeable-list/dist/styles.css';

interface AlertRow {
  id: string; animal_id: string; kind: string;
  severity: 'warning' | 'high' | 'critical';
  road_name: string | null; distance_m: number | null;
  message: string | null; escalated_from: string | null;
  resolved_at: string | null; created_at: string;
}

type Filter = 'all' | 'critical' | 'warning' | 'resolved';

function toneOf(a: AlertRow) {
  if (a.resolved_at) return 'safe' as const;
  return a.severity === 'critical' || a.severity === 'high' ? 'danger' as const : 'warn' as const;
}

function iconFor(kind: string) {
  if (kind === 'on_road' || kind === 'road_risk') return IconPin;
  if (kind === 'gps_fault' || kind === 'low_battery' || kind === 'offline') return IconCollar;
  if (kind === 'outside_zone' || kind === 'geofence_breach') return IconWarning;
  if (kind === 'steered_safe') return IconCheck;
  return IconShield;
}

function alertTitle(kind: string): string {
  const map: Record<string, string> = {
    'on_road': 'Road Not Detected',
    'road_risk': 'Approaching Road',
    'outside_zone': 'Leaving Grazing Area',
    'geofence_breach': 'Left Grazing Area',
    'low_battery': 'Low Battery',
    'gps_fault': 'GPS Signal Lost',
    'offline': 'Collar Offline',
    'fall': 'Fall Detected',
    'steered_safe': 'Steered to Safety',
  };
  return map[kind] ?? kind.replace(/_/g, ' ');
}

export function AlertsScreen() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const [a, an] = await Promise.all([
        supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('animals').select('id, name'),
      ]);
      setRows((a.data ?? []) as AlertRow[]);
      setNames(Object.fromEntries((an.data ?? []).map((x) => [x.id, x.name as string])));
      setLoading(false);
    })();
  }, []);

  // A real alert (boundary crossed, road approached) must appear while this
  // screen is open, not only after leaving and coming back to it.
  useEffect(() => {
    const ch = supabase
      .channel('alerts-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, () => {
        void supabase.from('alerts').select('*')
          .order('created_at', { ascending: false }).limit(200)
          .then(({ data }) => setRows((data ?? []) as AlertRow[]));
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const threads = useMemo(() => {
    const superseded = new Set(rows.map((r) => r.escalated_from).filter(Boolean) as string[]);
    return rows
      .filter((r) => !superseded.has(r.id))
      .map((r) => {
        let steps = 1, cur: AlertRow | undefined = r;
        while (cur?.escalated_from) {
          cur = rows.find((x) => x.id === cur!.escalated_from);
          if (!cur) break;
          steps++;
        }
        return { row: r, steps };
      });
  }, [rows]);

  const shown = useMemo(() => threads.filter(({ row }) => {
    if (filter === 'all') return !row.resolved_at;
    if (filter === 'resolved') return Boolean(row.resolved_at);
    if (filter === 'critical') return !row.resolved_at && ['critical', 'high'].includes(row.severity);
    return !row.resolved_at && row.severity === 'warning';
  }), [threads, filter]);

  const openN = threads.filter((x) => !x.row.resolved_at).length;
  const critN = threads.filter((x) => !x.row.resolved_at && ['critical', 'high'].includes(x.row.severity)).length;
  const warnN = threads.filter((x) => !x.row.resolved_at && x.row.severity === 'warning').length;
  const doneN = threads.filter((x) => x.row.resolved_at).length;

  async function resolveAlert(id: string) {
    setRows((prev) => prev.map(r => r.id === id ? { ...r, resolved_at: new Date().toISOString() } : r));
    await supabase.from('alerts').update({ resolved_at: new Date().toISOString() }).eq('id', id);
  }

  const trailingActions = (id: string) => (
    <TrailingActions>
      <SwipeAction
        destructive={true}
        onClick={() => resolveAlert(id)}
      >
        <div style={{
          background: 'var(--green)', color: 'white', display: 'flex', alignItems: 'center', 
          justifyContent: 'center', padding: '0 20px', borderRadius: '14px', margin: '0 0 10px 10px',
          fontWeight: 600, fontSize: '0.9rem'
        }}>
          Dismiss
        </div>
      </SwipeAction>
    </TrailingActions>
  );


  if (loading) {
    return (
      <div className="h-full px-5 pt-6" style={{ background: 'var(--bg)' }}>
        <div className="skeleton mb-3" style={{ height: 34, width: '45%', borderRadius: 10 }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton mb-2.5" style={{ height: 100, borderRadius: 20 }} />
        ))}
      </div>
    );
  }

  const FILTERS: Array<[Filter, string, number]> = [
    ['all', 'Open', openN],
    ['critical', 'Critical', critN],
    ['warning', 'Warning', warnN],
    ['resolved', 'Resolved', doneN],
  ];

  return (
    <div className="h-full overflow-y-auto pb-4" style={{ background: 'var(--bg)' }}>
      <header className="flex items-center justify-between px-5 pt-6 pb-3">
        <div>
          <h1 className="d-lg">Alerts</h1>
          <p className="t-meta mt-0.5">
            {openN === 0 ? 'Nothing needs you right now' : `${openN} still open`}
          </p>
        </div>
        <span className="grid place-items-center"
              style={{ width: 42, height: 42, borderRadius: 14,
                       background: 'var(--card)', border: '1px solid var(--line-soft)',
                       boxShadow: 'var(--sh)', color: 'var(--text-faint)' }}>
          <IconBell size={19} />
        </span>
      </header>

      <div className="flex gap-2 overflow-x-auto px-5 pb-3">
        {FILTERS.map(([k, label, n]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className="shrink-0 px-3.5"
            style={{
              minHeight: 34, borderRadius: 999, fontSize: '.8rem', fontWeight: 700,
              background: filter === k ? 'var(--green)' : 'var(--card)',
              color: filter === k ? '#fff' : 'var(--text-dim)',
              border: '1px solid ' + (filter === k ? 'var(--green)' : 'var(--line-soft)'),
              boxShadow: filter === k ? 'none' : 'var(--sh)',
            }}>
            {label} <span className="tnum" style={{ opacity: .65 }}>{n}</span>
          </button>
        ))}
      </div>

      {/* section label */}
      {shown.length > 0 && (
        <p className="t-label px-5 mt-1 mb-2">Today</p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon={<IconBell size={28} />}
          title={filter === 'all' ? 'All quiet' : 'Nothing here'}
          body={filter === 'all'
            ? 'No open alerts. You will get a call, not just a notification, if an animal reaches a road.'
            : 'Try another filter.'}
        />
      ) : (
        <div className="px-5">
        <SwipeableList type={ListType.IOS} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {shown.map(({ row }, i) => {
            const k = toneOf(row);
            const Icon = iconFor(row.kind);
            const name = names[row.animal_id] ?? 'An animal';
            const colorMap = { danger: 'var(--red)', warn: 'var(--amber)', safe: 'var(--green)' };
            const bgMap = { danger: 'var(--red-soft)', warn: 'var(--amber-soft)', safe: 'var(--green-soft)' };

            return (
              <div key={row.id} className="rise" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
                <SwipeableListItem trailingActions={trailingActions(row.id)}>
                <article className="card card-lit" style={{ padding: '.9rem' }}>
                  <div className="flex items-start gap-3">
                    <span className="grid shrink-0 place-items-center"
                          style={{ width: 42, height: 42, borderRadius: 14,
                                   background: bgMap[k], color: colorMap[k] }}>
                      <Icon size={20} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="d-sm">{alertTitle(row.kind)}</p>
                      <p className="t-meta mt-0.5">
                        {name} · {row.distance_m != null ? `${row.distance_m}m from highway` : ageLabel(row.created_at, t)}
                      </p>
                      {row.resolved_at && (
                        <p className="t-meta mt-1 txt-safe" style={{ fontWeight: 700 }}>
                          ✓ Resolved
                        </p>
                      )}
                    </div>
                  </div>

                  {!row.resolved_at && (
                    <div className="mt-3 flex gap-2">
                      <Link to={`/animal/${row.animal_id}`}
                            className="btn flex-1"
                            style={{
                              minHeight: 40, fontSize: '.84rem',
                              background: k === 'danger' ? 'var(--red)' : 'var(--green)',
                              color: '#fff',
                            }}>
                        {k === 'danger' ? 'View Now' : 'View Details'}
                      </Link>
                      <Link to="/map" className="btn btn-ghost shrink-0"
                            style={{ minHeight: 40, paddingInline: '.8rem' }}
                            aria-label="Show on map">
                        <IconPin size={17} />
                      </Link>
                    </div>
                  )}
                </article>
                </SwipeableListItem>
              </div>
            );
          })}
        </SwipeableList>
        </div>
      )}
    </div>
  );
}
