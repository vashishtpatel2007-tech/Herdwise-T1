/**
 * Error boundary.
 *
 * Without one, React 18 unmounts the entire tree when any render throws — the
 * farmer gets a blank white screen with no way back, and the cause is visible
 * only in a console he will never open. A blank screen is the worst possible
 * failure for an app whose whole job is telling him something is wrong.
 *
 * This shows what broke, offers the one action that usually fixes it, and
 * keeps the message in plain words.
 */

import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // Keep the technical detail where a developer can find it, not on screen.
    console.error('[PashuGuard] render failed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full flex-col justify-center gap-4 p-6"
           style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <h1 className="d-lg">Something went wrong</h1>
        <p className="t-body" style={{ color: 'var(--text-dim)' }}>
          The app could not draw this screen. Your animals are still being
          watched — this is a problem with the display only.
        </p>

        <button onClick={() => location.reload()} className="btn btn-primary w-full">
          Try again
        </button>
        <button onClick={() => { location.href = '/'; }} className="btn btn-ghost w-full">
          Go to the map
        </button>

        <details className="card mt-2" style={{ background: 'var(--card-2)' }}>
          <summary className="t-label" style={{ cursor: 'pointer' }}>Technical detail</summary>
          <pre className="mt-2" style={{
            fontSize: '.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            color: 'var(--text-dim)', fontFamily: 'ui-monospace, monospace',
          }}>{error.message}</pre>
        </details>
      </div>
    );
  }
}
