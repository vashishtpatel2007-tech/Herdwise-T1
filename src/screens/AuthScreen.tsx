/**
 * Sign in.
 *
 * DEMO SIGN-IN — READ THIS BEFORE SHIPPING.
 *
 * Whatever is typed here, the app signs into one shared demo farm. There is
 * no account lookup, no password check and no per-user data: the field exists
 * so the screen behaves like a login, not because it authenticates anybody.
 * Row-level security is untouched — the session is a real Supabase session
 * and every query is still scoped to that one farm — but this must be
 * replaced with the phone-OTP flow before a second farmer ever uses it.
 *
 * The screen says so out loud, because a login box that quietly accepts
 * anything is the kind of thing that survives to production by looking
 * finished.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { supabase } from '../lib/supabase.ts';
import { DEMO_EMAIL, DEMO_PASSWORD } from '../lib/auth.tsx';
import { setLanguage } from '../i18n/index.ts';

const POSTER = '/media/sea-storm.jpg';

export function AuthScreen() {
  const { i18n } = useTranslation();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: DEMO_EMAIL, password: DEMO_PASSWORD,
    });
    setBusy(false);
    // The only failure that can happen here is the demo account missing or
    // the project being unreachable, so say that rather than "wrong password".
    if (error) setMsg(`Could not open the demo farm — ${error.message}`);
  }

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: '#0B0D10' }}>
      {/* The art. Same frame as the intro and the dashboard backdrop. */}
      <img src={POSTER} alt="" aria-hidden
           className="absolute inset-0 h-full w-full"
           style={{ objectFit: 'cover', objectPosition: '50% 50%' }} />
      <div aria-hidden className="absolute inset-0" style={{
        background:
          'radial-gradient(120% 80% at 50% 34%, rgba(0,0,0,0) 28%, rgba(6,8,11,.7) 100%)',
      }} />
      <div aria-hidden className="absolute inset-x-0 bottom-0" style={{
        height: '62%',
        background:
          'linear-gradient(180deg, rgba(6,8,11,0) 0%, rgba(6,8,11,.55) 46%, rgba(6,8,11,.9) 100%)',
      }} />

      <div className="relative flex h-full flex-col justify-end px-6 pb-9">
        <h1 style={{
          fontFamily: 'Manrope, sans-serif',
          fontSize: 'clamp(1.9rem, 9.5vw, 2.6rem)',
          fontWeight: 800,
          letterSpacing: '.14em',
          color: '#FFFFFF',
          textShadow: '0 2px 24px rgba(0,0,0,.7)',
          margin: 0,
        }}>
          HERDWISE
        </h1>
        <p style={{
          marginTop: '.5rem',
          fontSize: '.95rem',
          color: 'rgba(255,255,255,.74)',
          textShadow: '0 1px 14px rgba(0,0,0,.7)',
        }}>
          Know before she reaches the road.
        </p>

        <label className="mt-7 block">
          <span className="sr-only">Phone number</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void signIn(); }}
            inputMode="tel"
            placeholder="Phone number"
            className="w-full px-4"
            style={{
              height: 54, borderRadius: 16,
              background: 'rgba(255,255,255,.1)',
              border: '1px solid rgba(255,255,255,.2)',
              color: '#FFFFFF', fontSize: '1rem',
              WebkitBackdropFilter: 'blur(14px)', backdropFilter: 'blur(14px)',
              outline: 'none',
            }}
          />
        </label>

        <button onClick={() => void signIn()} disabled={busy}
                className="btn mt-3 w-full"
                style={{
                  minHeight: 54, background: '#FFFFFF', color: '#11150F',
                  fontSize: '1rem', opacity: busy ? .6 : 1,
                }}>
          {busy ? 'Opening…' : 'Continue'}
        </button>

        {msg && (
          <p className="mt-3 text-center" style={{ fontSize: '.85rem', color: '#FFB4AE' }}>
            {msg}
          </p>
        )}

        {/* Not fine print. Anyone looking at this screen should know the
            field is decorative before they trust it with anything. */}
        <p className="mt-4 text-center" style={{
          fontSize: '.76rem', lineHeight: 1.5, color: 'rgba(255,255,255,.58)',
        }}>
          Demo sign-in — any number opens the same example farm.
        </p>

        <div className="mt-5 flex justify-center gap-2">
          {([['en', 'English'], ['hi', 'हिंदी'], ['kn', 'ಕನ್ನಡ']] as const).map(([c, l]) => (
            <button key={c} onClick={() => setLanguage(c)} aria-pressed={i18n.language === c}
              className="px-3.5"
              style={{
                minHeight: 38, borderRadius: 999, fontSize: '.82rem', fontWeight: 600,
                background: i18n.language === c ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.1)',
                color: i18n.language === c ? '#11150F' : 'rgba(255,255,255,.8)',
                border: '1px solid rgba(255,255,255,.18)',
              }}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
