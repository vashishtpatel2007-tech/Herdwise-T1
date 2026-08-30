/**
 * Empty state.
 *
 * A blank screen tells the farmer nothing and looks broken. Worse, a summary
 * computed over nothing can actively mislead: "All animals safe" is literally
 * true when you own zero animals, and it is the opposite of what this app is
 * supposed to guarantee. Nothing is not the same as fine.
 *
 * So every empty screen says what is missing, why the screen is blank, and
 * gives the one action that fills it.
 */

import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  body: string;
  actionLabel?: string;
  actionTo?: string;
}

export function EmptyState({ icon, title, body, actionLabel, actionTo }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      {icon && (
        <span className="grid place-items-center"
              style={{ width: 64, height: 64, borderRadius: 20,
                       background: 'var(--card-2)', color: 'var(--text-dim)' }}>
          {icon}
        </span>
      )}
      <h2 className="t-name" style={{ marginTop: '.25rem' }}>{title}</h2>
      <p className="t-body" style={{ color: 'var(--text-dim)', maxWidth: '30ch' }}>{body}</p>
      {actionLabel && actionTo && (
        <Link to={actionTo} className="btn btn-primary mt-2" style={{ minWidth: '14rem' }}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
