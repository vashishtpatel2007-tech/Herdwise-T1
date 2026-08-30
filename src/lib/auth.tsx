/**
 * Session + farm profile.
 *
 * Two things have to be true before any screen means anything: the farmer is
 * signed in, AND a row exists in `farmers` linked to his auth uid — because
 * every RLS policy in the database resolves ownership through that row. A
 * session without a farm profile shows a perfectly working app with zero
 * animals in it, which looks like data loss.
 *
 * So this provider owns both, and creates the profile on first sign-in.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

export interface Farmer {
  id: string; name: string; village: string | null;
  phone: string; language: string | null;
}

interface AuthValue {
  session: Session | null;
  farmer: Farmer | null;
  loading: boolean;
  /** True when signed in but no farm profile exists yet — needs onboarding. */
  needsProfile: boolean;
  refreshFarmer: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * AUTO SIGN-IN.
 *
 * Off: the sign-in screen is shown so it can actually be seen, and so there
 * is somewhere to come back to after logging out. Row-level security is
 * unaffected either way — every query has always been scoped to one farm.
 *
 * Turn this back on to skip straight to the herd during development.
 */
export const AUTO_LOGIN = false;

/**
 * The demo farm every sign-in lands on.
 *
 * Exported because AuthScreen signs in with these no matter what is typed —
 * see the note there. Real credentials, real RLS, one shared account.
 */
export const DEMO_EMAIL = 'demo@pashuguard.test';
export const DEMO_PASSWORD = 'demo123456';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshFarmer = useCallback(async () => {
    const { data } = await supabase
      .from('farmers').select('id, name, village, phone, language').maybeSingle();
    setFarmer((data as Farmer | null) ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      let { data } = await supabase.auth.getSession();

      // No session and the wall is off: sign in as the demo farm so the app
      // opens on real data instead of an empty, RLS-filtered shell.
      if (!data.session && AUTO_LOGIN) {
        const { error } = await supabase.auth.signInWithPassword({
          email: DEMO_EMAIL, password: DEMO_PASSWORD,
        });
        if (error) console.warn('[Herdwise] auto sign-in failed:', error.message);
        ({ data } = await supabase.auth.getSession());
      }

      setSession(data.session);
      if (data.session) await refreshFarmer();
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s) void refreshFarmer();
      else setFarmer(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshFarmer]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setFarmer(null);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    session, farmer, loading,
    needsProfile: Boolean(session) && !farmer,
    refreshFarmer, signOut,
  }), [session, farmer, loading, refreshFarmer, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Create the farm profile that every RLS policy resolves ownership through. */
export async function createFarmProfile(input: {
  name: string; village: string; phone: string; language: string;
}) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('farmers').insert({
    auth_uid: u.user.id,
    name: input.name.trim(),
    village: input.village.trim() || null,
    // Phone is unique in the schema; fall back to the account email so a
    // demo sign-up without a phone number still produces a valid row.
    phone: input.phone.trim() || u.user.email || u.user.id,
    language: input.language,
  });
  return { error: error?.message ?? null };
}
