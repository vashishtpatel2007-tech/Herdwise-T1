/**
 * The side drawer behind the hamburger.
 *
 * The tab bar holds the five screens he opens every day. Everything else —
 * fields, insights, adding an animal, settings — lives here, so the hamburger
 * is a real door rather than decoration copied from a screenshot.
 *
 * Escape closes it, focus is not trapped (there are only links), and the
 * scrim swallows taps so the map underneath cannot be dragged by accident.
 */

import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { useAuth } from '../lib/auth.tsx';
import { useHerd } from '../lib/useHerd.tsx';
import {
  IconLeaf, IconFields, IconInsights, IconPlus, IconCollar,
  IconSettings, IconChevron, IconProfile,
} from './Icons.tsx';

interface Props { open: boolean; onClose: () => void }

const LINKS: Array<[string, (p: { size?: number }) => JSX.Element, string, string]> = [
  ['/fields',      IconFields,   'Grazing Areas', 'Draw and edit the fence'],
  ['/insights',    IconInsights, 'Insights',      'Grazing, distance, alerts'],
  ['/animals/new', IconPlus,     'Add an Animal', 'Pair a new collar'],
  ['/profile',     IconProfile,  'Profile',       'Your farm details'],
  ['/settings',    IconSettings, 'Settings',      'Alerts, language, helpers'],
];

export function SideDrawer({ open, onClose }: Props) {
  const { farmer } = useAuth();
  const { herd } = useHerd();
  const { pathname } = useLocation();

  // Closing on navigation matters: without it the drawer stays open on top of
  // the screen it just pushed.
  useEffect(() => { onClose(); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // "Reporting" means a collar has actually sent a fix. Counting rows in the
  // animals table would claim coverage the hardware has not proved.
  const reporting = herd.filter((m) => m.position != null).length;

  return (
    <>
      <div
        className="drawer-scrim"
        data-open={open || undefined}
        onClick={onClose}
        aria-hidden
      />
      <aside className="drawer" data-open={open || undefined}
             role="dialog" aria-label="Menu" aria-hidden={!open}>
        <div className="flex items-center gap-2.5 px-5 pt-6 pb-4">
          <span className="grid place-items-center shrink-0"
                style={{ width: 40, height: 40, borderRadius: 13,
                         background: 'var(--green)', color: '#fff' }}>
            <IconLeaf size={22} />
          </span>
          <span className="min-w-0">
            <span className="d-sm block truncate" style={{ fontSize: '1.05rem' }}>
              {farmer?.name ?? 'Your Farm'}
            </span>
            <span className="t-meta block truncate">
              {farmer?.village ? `${farmer.village} · ` : ''}{herd.length} animals
            </span>
          </span>
        </div>

        <nav className="px-3">
          {LINKS.map(([to, Icon, title, sub]) => (
            <Link key={to} to={to} className="drawer-row" onClick={onClose}>
              <span className="row-icon"><Icon size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="row-title block truncate">{title}</span>
                <span className="row-sub block truncate">{sub}</span>
              </span>
              <span style={{ color: 'var(--text-faint)' }}><IconChevron size={16} /></span>
            </Link>
          ))}
        </nav>

        <div className="mx-5 mt-3 flex items-center gap-2.5 px-3.5 py-3"
             style={{ background: 'var(--green-soft)', borderRadius: 'var(--r-sm)' }}>
          <span style={{ color: 'var(--green)' }}><IconCollar size={19} /></span>
          <span className="min-w-0">
            <span className="d-sm block" style={{ fontSize: '.85rem' }}>
              {reporting} of {herd.length} collars reporting
            </span>
            <span className="t-meta block">
              {reporting === herd.length
                ? 'Every animal is being tracked'
                : `${herd.length - reporting} have not sent a fix`}
            </span>
          </span>
        </div>

        <p className="t-meta px-5 pt-5" style={{ fontSize: '.72rem' }}>
          Herdwise — Smart Livestock Management
        </p>
      </aside>
    </>
  );
}
