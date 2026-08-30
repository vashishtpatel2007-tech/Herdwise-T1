/**
 * Intro — the sea-storm opening.
 *
 * A shaft of light finds one small boat on a dark sea. It is the product in
 * one image: the thing you were about to lose, found.
 *
 * Plays ONCE on app launch and never again in the session (App.tsx keeps that
 * flag), because a video you cannot skip is charming the first time and an
 * obstacle every time after.
 *
 * Three ways out, so this screen can never trap the farmer behind a video:
 *   1. the clip ends
 *   2. a hard ceiling of MAX_MS, in case `ended` never fires
 *   3. a tap
 * Plus: autoplay refused, a decode failure, or reduced-motion all fall back to
 * the poster still rather than a black rectangle.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props { onDone: () => void }

const VIDEO = '/media/sea-storm.mp4';
const POSTER = '/media/sea-storm.jpg';

/*
 * Three seconds, DOOR TO DOOR.
 *
 * The dissolve is part of the wait, not extra: holding the clip for a full
 * 3s and then dissolving for another 0.6 put the dashboard 3.6s away. The
 * hold is shortened so that hold + fade lands on 3.0s exactly.
 */
const MAX_MS = 2400;
/**
 * The cross-dissolve into the dashboard.
 *
 * The intro sits ON TOP of the app, so fading it out reveals the home screen
 * underneath — which is showing the same photograph, framed identically. Long
 * enough to read as a deliberate dissolve rather than a cut, which matters
 * because the clip is graded brighter than the still and lands on an
 * unpredictable frame.
 */
const FADE_MS = 600;

export function IntroScreen({ onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  const [still, setStill] = useState(false);   // video unavailable -> poster
  const video = useRef<HTMLVideoElement | null>(null);
  const finished = useRef(false);

  const finish = useCallback(() => {
    if (finished.current) return;              // `ended` + timeout can race
    finished.current = true;
    setLeaving(true);
    setTimeout(onDone, FADE_MS);
  }, [onDone]);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setStill(true);
      const t = setTimeout(finish, 1400);      // still frame, then move on
      return () => clearTimeout(t);
    }

    const el = video.current;
    if (!el) return;

    /*
     * A rejected play() is NOT a broken video.
     *
     * Under StrictMode React mounts, unmounts and remounts in development, so
     * the first play() lands on an element that is already being torn down and
     * rejects with AbortError. Treating that as failure swapped in the poster
     * every single time and the clip never ran once. Autoplay policies reject
     * here too, and in both cases the <video> is still showing its poster
     * frame — so there is nothing to fall back TO. Only a real `error` event
     * (see onError) means the file itself is unusable.
     *
     * Retry once the browser says it has frames, which also covers the case
     * where play() was refused because nothing had buffered yet.
     */
    const attempt = () => { void el.play().catch(() => {}); };
    attempt();
    el.addEventListener('canplay', attempt);

    const ceiling = setTimeout(finish, MAX_MS);
    return () => {
      clearTimeout(ceiling);
      el.removeEventListener('canplay', attempt);
    };
  }, [finish]);

  return (
    <div
      onClick={finish}
      role="button"
      tabIndex={0}
      aria-label="Skip intro"
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') finish(); }}
      className="relative h-full w-full overflow-hidden"
      style={{
        background: '#0B0D10',
        cursor: 'pointer',
        opacity: leaving ? 0 : 1,
        /*
         * Opacity ONLY. A push-in scale on the way out looked good in
         * isolation but it slides this photograph against the identical
         * photograph underneath it, so the seam it was meant to hide became
         * the most visible thing on screen.
         */
        transition: `opacity ${FADE_MS}ms ease`,
        willChange: 'opacity',
      }}
    >
      {still ? (
        <img src={POSTER} alt="" className="absolute inset-0 h-full w-full"
             style={{ objectFit: 'cover' }} />
      ) : (
        <video
          ref={video}
          src={VIDEO}
          poster={POSTER}
          muted
          playsInline
          autoPlay
          preload="auto"
          onEnded={finish}
          onError={() => setStill(true)}
          className="absolute inset-0 h-full w-full"
          style={{ objectFit: 'cover' }}
        />
      )}

      {/*
        Two overlays, both needed.

        The vignette alone was not enough: the clip is graded much brighter
        than the poster still, and mid-shot the whole frame lifts to a pale
        haze — white letters on it went soft even with a text-shadow. The
        second gradient lays a dark base under the lower third, where the
        wordmark sits, so it holds through the bright frames without dulling
        the shaft of light above it.
      */}
      <div aria-hidden className="absolute inset-0" style={{
        background:
          'radial-gradient(120% 80% at 50% 38%, rgba(0,0,0,0) 30%, rgba(6,8,11,.72) 100%)',
      }} />
      <div aria-hidden className="absolute inset-x-0 bottom-0" style={{
        height: '52%',
        background:
          'linear-gradient(180deg, rgba(6,8,11,0) 0%, rgba(6,8,11,.34) 42%, rgba(6,8,11,.62) 78%, rgba(6,8,11,.72) 100%)',
      }} />

      {/* ---- wordmark ----
          Sits above the boat, not across it. At 13% the tagline landed
          straight on the hull, and the boat in the light is the whole
          picture — it is the one thing on this screen you must not cover. */}
      <div className="absolute inset-x-0 flex flex-col items-center"
           style={{ bottom: '24%' }}>
        <h1 className="intro-word" style={{
          fontFamily: 'Manrope, sans-serif',
          fontSize: 'clamp(2.1rem, 11vw, 3.1rem)',
          fontWeight: 800,
          letterSpacing: '.16em',
          color: '#FFFFFF',
          textShadow: '0 2px 26px rgba(0,0,0,.65)',
          margin: 0,
        }}>
          HERDWISE
        </h1>
        <p className="intro-sub" style={{
          marginTop: '.7rem',
          fontFamily: 'Inter, sans-serif',
          fontSize: '.82rem',
          fontWeight: 500,
          letterSpacing: '.28em',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,.76)',
          textShadow: '0 1px 14px rgba(0,0,0,.7)',
        }}>
          Never lose her
        </p>

        {/* A hairline that draws itself, so the wait reads as progress. */}
        <span aria-hidden className="intro-rule" />
      </div>
    </div>
  );
}
