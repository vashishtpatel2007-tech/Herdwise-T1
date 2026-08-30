/**
 * Farm Health Ring — FARMO style.
 *
 * Large green ring with the score prominently displayed.
 * Matches the FARMO design with a thicker stroke and green gradient glow.
 */

import { useEffect, useState } from 'react';

interface Props {
  score: number;                       // 0..100
  tone: 'safe' | 'warn' | 'danger';
  size?: number;
  /** Print "/100" under the score. Off in tight spots (list rows, tiles). */
  showDenominator?: boolean;
}

/*
 * The arc reads from the palette variables, not from fixed hexes.
 *
 * Those variables are re-pointed on the storm-backed dashboard, so the deep
 * forest green — which vanishes against a dark ground — brightens there and
 * stays deep on the white screens, from one definition.
 */
const TONE = {
  safe:   { stroke: 'rgb(var(--green-rgb))', trail: '#D8F3DC', glow: 'rgb(var(--green-rgb) / .3)' },
  warn:   { stroke: 'rgb(var(--amber-rgb))', trail: '#FEF3D1', glow: 'rgb(var(--amber-rgb) / .3)' },
  danger: { stroke: 'rgb(var(--red-rgb))',   trail: '#FDEAEA', glow: 'rgb(var(--red-rgb) / .3)' },
};

export function HealthRing({ score, tone, size = 100, showDenominator = false }: Props) {
  const strokeW = 8;
  const r = (size - strokeW - 4) / 2;
  const c = 2 * Math.PI * r;

  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(id);
  }, [score]);

  const { stroke, trail, glow } = TONE[tone];

  return (
    <div style={{ width: size, height: size, position: 'relative', flex: 'none' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        {/* Background track.
            --ring-track lets a dark surface override the pale pastel, which
            on the storm-backed dashboard read as a solid light ring and made
            the score look near-full whatever it actually was. */}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={`var(--ring-track, ${trail})`} strokeWidth={strokeW} />
        {/* Active arc */}
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={stroke} strokeWidth={strokeW} strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.max(0, Math.min(100, shown)) / 100) * c}
          style={{
            transition: 'stroke-dashoffset .9s cubic-bezier(.16,1,.3,1)',
            filter: `drop-shadow(0 0 8px ${glow})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tnum" style={{
          fontFamily: 'Manrope, sans-serif',
          fontSize: size * 0.32,
          fontWeight: 800,
          color: 'var(--text)',
          lineHeight: 1,
        }}>
          {Math.round(shown)}
        </span>
        {showDenominator && (
          <span className="tnum" style={{
            fontSize: size * 0.115, fontWeight: 600,
            color: 'var(--text-faint)', lineHeight: 1, marginTop: size * 0.04,
          }}>
            /100
          </span>
        )}
      </div>
      <span className="sr-only">Farm health {score} out of 100</span>
    </div>
  );
}
