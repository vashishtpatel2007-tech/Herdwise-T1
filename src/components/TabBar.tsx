/**
 * FARMO bottom navigation bar.
 *
 * Clean white background with green active indicators.
 * Five tabs matching the FARMO design: Home, Animals, Map, Alerts, Profile.
 */

import { NavLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useHerd } from '../lib/useHerd.tsx';
import {
  IconHome, IconCow, IconMapTab, IconBell, IconProfile,
} from './Icons.tsx';

interface Tab {
  to: string;
  key: 'home' | 'animals' | 'map' | 'alerts' | 'profile';
  label: string;
  Icon: (p: { size?: number }) => JSX.Element;
}

const TABS: Tab[] = [
  { to: '/',        key: 'home',    label: 'Home',    Icon: IconHome },
  { to: '/animals', key: 'animals', label: 'Animals', Icon: IconCow },
  { to: '/map',     key: 'map',     label: 'Map',     Icon: IconMapTab },
  { to: '/alerts',  key: 'alerts',  label: 'Alerts',  Icon: IconBell },
  { to: '/profile', key: 'profile', label: 'Profile', Icon: IconProfile },
];

export function TabBar() {
  const { t } = useTranslation();
  const { counts } = useHerd();
  const needsYou = counts.danger + counts.out;

  /*
   * On Home the bar sits over the photograph, so it takes the same smoked
   * glass as the cards. Elsewhere it is the solid card colour.
   */
  const onHome = useLocation().pathname === '/';

  return (
    <nav
      className={`relative z-[2000] grid grid-cols-5${onHome ? ' tabbar-dark' : ''}`}
      style={{
        // Was hard-coded white, which stayed white when the app went dark.
        background: 'var(--card)',
        borderTop: '1px solid var(--line-soft)',
        paddingTop: '.5rem',
        paddingBottom: 'max(.5rem, env(safe-area-inset-bottom))',
        boxShadow: '0 -2px 16px rgb(0 0 0 / .4)',
      }}
    >
      {TABS.map(({ to, key, label, Icon }) => (
        <NavLink key={to} to={to} end={to === '/'}
                 className="relative flex flex-col items-center gap-0.5 pb-0.5"
                 style={{ minHeight: 52 }}>
          {({ isActive }) => (
            <>
              <span className="relative grid place-items-center transition-all"
                    style={{
                      width: 48, height: 30, borderRadius: 999,
                      background: isActive ? 'var(--green-soft)' : 'transparent',
                      color: isActive ? 'var(--green)' : 'var(--text-faint)',
                    }}>
                <Icon size={20} />

                {key === 'alerts' && needsYou > 0 && (
                  <span className="tnum absolute grid place-items-center"
                        style={{
                          top: -4, right: 2, minWidth: 16, height: 16, padding: '0 4px',
                          borderRadius: 999,
                          background: counts.danger ? 'var(--red)' : 'var(--amber)',
                          color: '#fff',
                          fontSize: '.58rem', fontWeight: 800,
                          border: '2px solid #fff',
                        }}>
                    {needsYou}
                  </span>
                )}
              </span>

              <span style={{
                fontSize: '.62rem',
                fontWeight: isActive ? 700 : 500,
                letterSpacing: '.01em',
                color: isActive ? 'var(--green)' : 'var(--text-faint)',
              }}>
                {t(`tab.${key}`, label)}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
