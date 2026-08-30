/**
 * §9.1 — tap an animal, a card slides up.
 *
 * Collar charge is words, not a percentage (§9.4). Buttons name what happens
 * (§10). Every reading carries its age (§13.1).
 */

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { HerdMember } from '../lib/useHerd.tsx';
import { ageLabel, batteryWords, freshness, STATE_COLOR } from '../lib/format.ts';

export function AnimalSheet({ member, onClose }: { member: HerdMember; onClose: () => void }) {
  const { t } = useTranslation();
  const { animal, position, risk } = member;
  const state = risk?.state ?? 'safe';
  const stale = freshness(position?.recorded_at) === 'stale';

  return (
    <>
      <div
        className="absolute inset-0 z-[1400] bg-ink/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="absolute bottom-0 left-0 right-0 z-[1500] rounded-t-3xl bg-card p-5 pb-7
                   shadow-[0_-4px_24px_rgba(0,0,0,0.25)]"
        role="dialog"
        aria-label={animal.name}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-ink/20" />

        <div className="flex items-center gap-4">
          {animal.photo_url
            ? <img src={animal.photo_url} alt="" className="h-16 w-16 rounded-2xl object-cover" />
            : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-card2
                              font-display text-2xl font-extrabold">
                {animal.name.slice(0, 1)}
              </div>}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="dot" style={{ background: STATE_COLOR[state] }} />
              <h2 className="d-lg truncate">{animal.name}</h2>
            </div>
            <div className="text-[15px] font-semibold opacity-70">
              {t(`status.${state}`)}
              {animal.breed ? ` · ${animal.breed}` : ''}
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="card">
            <dt className="text-[14px] font-semibold opacity-60">{t('animal.speed')}</dt>
            <dd className="tnum font-display text-xl font-extrabold">
              {position?.speed_kmh != null ? `${position.speed_kmh.toFixed(1)} km/h` : '—'}
            </dd>
          </div>
          <div className="card">
            <dt className="text-[14px] font-semibold opacity-60">{t('animal.last_update')}</dt>
            {/* Never a bare timestamp: always the age, and flagged when stale. */}
            <dd className={`text-[15px] font-bold ${stale ? 'text-red' : ''}`}>
              {ageLabel(position?.recorded_at, t)}
            </dd>
          </div>
          <div className="card col-span-2">
            <dd className="text-[16px] font-bold">
              {batteryWords(position?.battery_pct, t)}
            </dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-2">
          <Link to={`/animal/${animal.id}`} className="btn btn-primary w-full">
            {t('animal.see_live')}
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn btn-ghost">{t('animal.make_beep')}</button>
            <button className="btn btn-ghost">{t('animal.call_helper')}</button>
          </div>
        </div>
      </div>
    </>
  );
}
