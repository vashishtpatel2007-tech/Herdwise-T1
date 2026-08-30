/**
 * Profile — FARMO style.
 *
 * Matches the reference: centered circular avatar, name prominent,
 * clean menu list (Farm Details, My Animals, Notifications, Settings),
 * red "Logout" button at bottom.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';
import { AUTO_LOGIN, useAuth } from '../lib/auth.tsx';
import { setLanguage } from '../i18n/index.ts';
import { useHerd } from '../lib/useHerd.tsx';
import {
  IconFarm, IconCow, IconBell, IconSettings,
  IconChevron, IconLogout, IconFields,
} from '../components/Icons.tsx';

export function ProfileScreen() {
  const { i18n } = useTranslation();
  const { farmer, signOut } = useAuth();
  const { herd } = useHerd();
  const [openAlerts, setOpenAlerts] = useState(0);
  const [fields, setFields] = useState(0);

  useEffect(() => {
    void (async () => {
      const [a, z] = await Promise.all([
        supabase.from('alerts').select('id', { count: 'exact', head: true }).is('resolved_at', null),
        supabase.from('grazing_zones').select('id', { count: 'exact', head: true }),
      ]);
      setOpenAlerts(a.count ?? 0);
      setFields(z.count ?? 0);
    })();
  }, []);

  const initial = (farmer?.name ?? 'F').trim().slice(0, 1).toUpperCase();
  const name = farmer?.name ?? 'Your Farm';

  return (
    <div className="h-full overflow-y-auto pb-6" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-6 pb-2">
        <h1 className="d-lg">Profile</h1>
        <Link to="/settings" className="grid place-items-center"
              style={{ width: 42, height: 42, borderRadius: 14,
                       background: 'var(--card)', border: '1px solid var(--line-soft)',
                       boxShadow: 'var(--sh)' }}>
          <IconSettings size={19} />
        </Link>
      </header>

      {/* Profile card — centered avatar */}
      <section className="rise mx-5 mt-2 flex flex-col items-center py-5"
               style={{ background: 'var(--card)', borderRadius: 'var(--r)',
                        boxShadow: 'var(--sh)', border: '1px solid var(--line-soft)' }}>
        <span className="grid place-items-center overflow-hidden"
              style={{ width: 80, height: 80, borderRadius: 999,
                       background: 'var(--green-soft)', border: '3px solid var(--green)',
                       fontSize: '1.8rem', fontFamily: 'Manrope, sans-serif',
                       fontWeight: 800, color: 'var(--green)' }}>
          {initial}
        </span>
        <p className="d-lg mt-3">{name}</p>
        {farmer?.village && <p className="t-meta mt-0.5">{farmer.village}</p>}
        {farmer?.phone && <p className="t-meta tnum mt-0.5">{farmer.phone}</p>}
      </section>

      {/* Menu list */}
      <div className="mx-5 mt-3 overflow-hidden"
           style={{ borderRadius: 'var(--r)', border: '1px solid var(--line-soft)',
                    boxShadow: 'var(--sh)' }}>
        <ProfileRow to="/animals" Icon={IconFarm} title="Farm Details"
                    sub={`${herd.length} animals · ${fields} field${fields !== 1 ? 's' : ''}`} />
        <ProfileRow to="/animals" Icon={IconCow} title="My Animals"
                    sub={`${herd.length} total`} />
        <ProfileRow to="/alerts" Icon={IconBell} title="Notifications"
                    sub={openAlerts ? `${openAlerts} unread` : 'All caught up'}
                    badge={openAlerts || undefined} />
        <ProfileRow to="/fields" Icon={IconFields} title="Grazing Areas"
                    sub={fields ? `${fields} area${fields > 1 ? 's' : ''} set up` : 'No areas yet'} />
        <ProfileRow to="/settings" Icon={IconSettings} title="Settings"
                    sub="Alerts, language, helpers" />
      </div>

      {/* Language quick-switch */}
      <section className="rise rise-3 card mx-5 mt-3">
        <p className="t-label">Language</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([['en', 'English'], ['hi', 'हिंदी'], ['kn', 'ಕನ್ನಡ']] as const).map(([c, l]) => (
            <button key={c} onClick={() => setLanguage(c)} aria-pressed={i18n.language === c}
              className="btn"
              style={{
                minHeight: 42, fontSize: '.85rem', paddingInline: '.5rem',
                background: i18n.language === c ? 'var(--green)' : 'var(--card-2)',
                color: i18n.language === c ? '#fff' : 'var(--text)',
                border: '1px solid ' + (i18n.language === c ? 'var(--green)' : 'var(--line-soft)'),
              }}>
              {l}
            </button>
          ))}
        </div>
      </section>

      {/* Sign out */}
      {!AUTO_LOGIN && (
        <div className="px-5 pt-3">
          <button onClick={() => void signOut()} className="btn w-full"
                  style={{ background: 'var(--red)', color: '#fff',
                           boxShadow: '0 4px 12px -3px rgba(214,40,40,.35)' }}>
            <IconLogout size={18} /> Logout
          </button>
        </div>
      )}

      <p className="t-meta px-5 pt-4 text-center" style={{ fontSize: '.74rem' }}>
        Herdwise — Smart Livestock Management
      </p>
    </div>
  );
}

function ProfileRow({ to, Icon, title, sub, badge }: {
  to: string; Icon: (p: { size?: number }) => JSX.Element;
  title: string; sub: string; badge?: number;
}) {
  return (
    <Link to={to} className="profile-row">
      <span className="row-icon"><Icon size={18} /></span>
      <span className="row-text">
        <span className="row-title">{title}</span>
        <span className="row-sub block">{sub}</span>
      </span>
      {badge !== undefined && (
        <span className="tnum grid shrink-0 place-items-center"
              style={{ minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999,
                       background: 'var(--red)', color: '#fff',
                       fontWeight: 800, fontSize: '.72rem' }}>
          {badge}
        </span>
      )}
      <span aria-hidden className="shrink-0" style={{ color: 'var(--text-faint)' }}>
        <IconChevron size={16} />
      </span>
    </Link>
  );
}
