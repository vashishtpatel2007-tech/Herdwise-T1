/**
 * First run — name the farm.
 *
 * Every RLS policy resolves ownership through a `farmers` row keyed to the
 * auth uid. Without it the app signs in successfully and then shows an empty
 * herd, which reads as data loss. So this is not optional polish; it is the
 * step that makes the account mean anything.
 *
 * Three fields, and only the name is required.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createFarmProfile, useAuth } from '../lib/auth.tsx';
import { setLanguage } from '../i18n/index.ts';

export function OnboardingScreen() {
  const { i18n } = useTranslation();
  const { session, refreshFarmer, signOut } = useAuth();
  const [name, setName] = useState('');
  const [village, setVillage] = useState('');
  const [phone, setPhone] = useState(session?.user?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true); setErr(null);
    const { error } = await createFarmProfile({
      name, village, phone, language: i18n.language,
    });
    if (error) { setErr(error); setBusy(false); return; }
    await refreshFarmer();
    setBusy(false);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-5 p-6">
        <div>
          <p className="t-label">Welcome</p>
          <h1 className="d-lg mt-1">Tell us about your farm</h1>
          <p className="t-body mt-1.5" style={{ color: 'var(--text-dim)' }}>
            This is how anyone who finds a lost animal will know who to call.
          </p>
        </div>

        <label className="grid gap-1.5">
          <span className="t-label">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
                 autoComplete="name" placeholder="Ramesh Gowda"
                 className="w-full rounded-2xl px-4"
                 style={{ minHeight: 56, fontSize: '1.1rem', fontWeight: 600,
                          border: '2px solid var(--line)', background: 'var(--card)' }} />
        </label>

        <label className="grid gap-1.5">
          <span className="t-label">Village</span>
          <input value={village} onChange={(e) => setVillage(e.target.value)}
                 placeholder="Hoskote"
                 className="w-full rounded-2xl px-4"
                 style={{ minHeight: 56, fontSize: '1.1rem',
                          border: '2px solid var(--line)', background: 'var(--card)' }} />
        </label>

        <label className="grid gap-1.5">
          <span className="t-label">Phone people should call</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)}
                 inputMode="tel" autoComplete="tel" placeholder="98765 43210"
                 className="tnum w-full rounded-2xl px-4"
                 style={{ minHeight: 56, fontSize: '1.1rem',
                          border: '2px solid var(--line)', background: 'var(--card)' }} />
        </label>

        <div className="grid grid-cols-3 gap-2">
          {([['en', 'English'], ['hi', 'हिंदी'], ['kn', 'ಕನ್ನಡ']] as const).map(([c, l]) => (
            <button key={c} onClick={() => setLanguage(c)} aria-pressed={i18n.language === c}
              className="btn"
              style={{ minHeight: 48, fontSize: '.9rem',
                       background: i18n.language === c ? 'var(--green)' : 'var(--card-2)',
                       color: 'var(--text)' }}>
              {l}
            </button>
          ))}
        </div>

        {err && (
          <p className="card t-body" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
            {err}
          </p>
        )}

        <button onClick={() => void save()} disabled={busy || name.trim().length < 2}
                className="btn btn-primary w-full" style={{ opacity: busy ? .5 : 1 }}>
          {busy ? 'Saving…' : 'Start'}
        </button>

        <button onClick={() => void signOut()} className="btn btn-ghost w-full">
          Sign out
        </button>
      </div>
    </div>
  );
}
