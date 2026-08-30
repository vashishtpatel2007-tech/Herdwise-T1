/**
 * Animals — FARMO 2-column photo grid.
 *
 * Matches the FARMO reference: header "Animals" with "+" add button,
 * 2-column grid of animal photo cards with names and status below.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useHerd, type HerdMember } from '../lib/useHerd.tsx';
import { EmptyState } from '../components/EmptyState.tsx';
import { IconCow, IconSearch, IconPlus } from '../components/Icons.tsx';
import { freshness, ageLabel } from '../lib/format.ts';

const SEVERITY: Record<string, number> = {
  critical: 4, high: 3, warning: 2, watch: 1, safe: 0,
};

/**
 * One state -> one tone.
 *
 * `device_fault` (no GPS fix) is red, not amber: a red cow means "I do not
 * know where she is right now", which is a bigger unknown than a normal
 * risk warning. It clears back to green the moment a fresh fix restores
 * `situation` to anything else.
 */
export function toneOf(state: string, situation?: string) {
  if (state === 'critical' || state === 'high' || situation === 'device_fault') return 'danger' as const;
  if (state === 'warning' || state === 'watch' || situation === 'outside_zone') return 'warn' as const;
  return 'safe' as const;
}

type Filter = 'all' | 'alert' | 'safe';

export function AnimalsScreen() {
  const { t } = useTranslation();
  const { herd, counts, loading } = useHerd();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const sorted = useMemo(() => {
    const term = q.trim().toLowerCase();
    return [...herd]
      .filter((m) => !term
        || m.animal.name.toLowerCase().includes(term)
        || (m.animal.pashu_aadhaar_tag ?? '').includes(term))
      .filter((m) => {
        if (filter === 'all') return true;
        const k = toneOf(m.risk?.state ?? 'safe', m.risk?.situation);
        return filter === 'alert' ? k !== 'safe' : k === 'safe';
      })
      .sort((a, b) => {
        const d = (SEVERITY[b.risk?.state ?? 'safe'] ?? 0) - (SEVERITY[a.risk?.state ?? 'safe'] ?? 0);
        if (d !== 0) return d;
        const at = a.position?.recorded_at ? new Date(a.position.recorded_at).getTime() : 0;
        const bt = b.position?.recorded_at ? new Date(b.position.recorded_at).getTime() : 0;
        return at - bt;
      });
  }, [herd, q, filter]);

  if (loading) {
    return (
      <div className="h-full px-5 pt-6" style={{ background: 'var(--bg)' }}>
        <div className="skeleton mb-3" style={{ height: 34, width: '55%', borderRadius: 10 }} />
        <div className="animal-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: '1', borderRadius: 20 }} />
          ))}
        </div>
      </div>
    );
  }

  if (herd.length === 0) {
    return (
      <div className="h-full overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <header className="flex items-center justify-between px-5 pt-6">
          <h1 className="d-lg">Animals</h1>
          <Link to="/animals/new" className="grid place-items-center"
                style={{ width: 42, height: 42, borderRadius: 14,
                         background: 'var(--green)', color: '#fff',
                         boxShadow: '0 4px 12px -3px rgba(45,106,79,.4)' }}>
            <IconPlus size={20} />
          </Link>
        </header>
        <EmptyState
          icon={<IconCow size={30} />}
          title="No animals yet"
          body="Add your first animal with her ear-tag number. You will get a printable tag anyone can scan to reach you."
          actionLabel="Add an animal"
          actionTo="/animals/new"
        />
      </div>
    );
  }

  const FILTERS: Array<[Filter, string, number]> = [
    ['all', 'All', herd.length],
    ['alert', 'Needs you', counts.danger + counts.out],
    ['safe', 'Safe', counts.safe],
  ];

  return (
    <div className="h-full overflow-y-auto pb-4" style={{ background: 'var(--bg)' }}>
      {/* header */}
      <header className="flex items-center justify-between px-5 pt-6 pb-3">
        <div>
          <h1 className="d-lg">Animals</h1>
          <p className="t-meta mt-0.5">
            {counts.danger + counts.out === 0
              ? `All ${herd.length} are fine`
              : `${counts.danger + counts.out} of ${herd.length} need you`}
          </p>
        </div>
        <Link to="/animals/new" className="grid place-items-center"
              style={{ width: 42, height: 42, borderRadius: 14,
                       background: 'var(--green)', color: '#fff',
                       boxShadow: '0 4px 12px -3px rgba(45,106,79,.4)' }}>
          <IconPlus size={20} />
        </Link>
      </header>

      {/* search */}
      <div className="px-5">
        <div className="flex items-center gap-2.5 px-3.5"
             style={{ background: 'var(--card)', borderRadius: 14,
                      border: '1px solid var(--line-soft)', height: 44,
                      boxShadow: 'var(--sh)' }}>
          <span style={{ color: 'var(--text-faint)' }}><IconSearch size={17} /></span>
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or tag"
            aria-label="Search animals"
            className="min-w-0 flex-1 bg-transparent outline-none"
            style={{ color: 'var(--text)', fontSize: '.9rem' }}
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search"
                    style={{ color: 'var(--text-faint)', minHeight: 0, fontSize: '1.1rem' }}>×</button>
          )}
        </div>
      </div>

      {/* filters */}
      <div className="flex gap-2 overflow-x-auto px-5 py-3">
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

      {/* 2-column animal grid */}
      <div className="animal-grid px-5">
        {sorted.map((m, i) => (
          <AnimalCard key={m.animal.id} member={m} t={t} index={i} />
        ))}
      </div>
      {sorted.length === 0 && (
        <p className="t-meta py-8 text-center px-5">No animal matches that.</p>
      )}

      <div className="px-5 pt-4">
        <Link to="/animals/new" className="btn btn-ghost w-full">+ Add an animal</Link>
      </div>
    </div>
  );
}

/** 2-column grid card for each animal — photo + name + status. */
function AnimalCard({ member, t, index }: { member: HerdMember; t: any; index: number }) {
  const { animal, risk, position } = member;
  const state = risk?.state ?? 'safe';
  const k = toneOf(state, risk?.situation);
  const fresh = freshness(position?.recorded_at);
  const noSignal = fresh === 'stale' || fresh === 'unknown';

  return (
    <Link to={`/animal/${animal.id}`}
          className="animal-grid-card rise"
          style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}>
      {animal.photo_url ? (
        <img src={animal.photo_url} alt={animal.name} className="animal-photo" />
      ) : (
        <div className="animal-photo grid place-items-center"
             style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
          <IconCow size={42} />
        </div>
      )}
      <div className="animal-info">
        <p className="animal-name">{animal.name}</p>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`pill pill-${k}`} style={{ fontSize: '.62rem', padding: '.15rem .45rem' }}>
            {t(`status.${state}`)}
          </span>
          {noSignal && (
            <span style={{ fontSize: '.62rem', fontWeight: 700, color: 'var(--danger)' }}>
              {fresh === 'unknown' ? 'No signal' : `No signal · ${ageLabel(position?.recorded_at, t)}`}
            </span>
          )}
        </div>
        {animal.pashu_aadhaar_tag && (
          <p className="animal-tag">#{animal.pashu_aadhaar_tag.slice(-4)}</p>
        )}
      </div>
    </Link>
  );
}
