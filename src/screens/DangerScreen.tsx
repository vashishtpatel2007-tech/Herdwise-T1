/**
 * §9.3 — takes over the display, not a dismissible toast.
 *
 * Two distinct modes, because they are different kinds of statement:
 *   approaching     — a warning about the FUTURE
 *   stationary_on_road — a report about NOW: "Lakshmi is standing on NH-48."
 *
 * The probability appears as a plain sentence, never a raw decimal (§9.3), and
 * only when a simulation actually ran (§13.3).
 */

import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { distanceWords, probabilitySentence, ttrWords } from '../lib/format.ts';

export interface DangerInfo {
  animalId: string;
  animalName: string;
  situation: 'approaching_road' | 'on_road' | 'stationary_on_road' | 'outside_zone';
  roadName: string | null;
  distanceM: number | null;
  ttrSeconds: number | null;
  probability: number | null;
  /** Bearing from the farmer to the animal, for the direction arrow. */
  bearingDeg: number | null;
  trafficFast: boolean;
  trafficFallback: boolean;
  helperPhone: string | null;
}

export function DangerScreen({ info, onDismiss }: { info: DangerInfo; onDismiss: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isNow = info.situation === 'on_road' || info.situation === 'stationary_on_road';
  const headline = t(`alert.${info.situation}`, {
    name: info.animalName,
    road: info.roadName ?? t('road.generic'),
  });
  const sentence = probabilitySentence(info.probability, info.roadName, t);

  return (
    <div className="fixed inset-0 z-[3000] flex flex-col bg-danger text-white">
      <div className="flex-1 overflow-y-auto px-6 pt-10">
        <h1 className="font-display text-[34px] font-extrabold leading-[1.1]">
          {headline}
        </h1>

        {/* Direction arrow toward the animal/road. */}
        {info.bearingDeg !== null && (
          <div className="my-6 flex justify-center" aria-hidden>
            <svg width="120" height="120" viewBox="0 0 100 100"
                 style={{ transform: `rotate(${info.bearingDeg}deg)` }}>
              <path d="M50 8 L74 78 L50 62 L26 78 Z" fill="#FFFFFF" />
            </svg>
          </div>
        )}

        <dl className="mt-6 space-y-4 text-[19px]">
          <div className="flex items-baseline justify-between border-b border-white/25 pb-2">
            <dt className="font-semibold opacity-90">{t('danger.distance_to_road')}</dt>
            <dd className="tnum font-display text-[26px] font-extrabold">
              {distanceWords(info.distanceM, t)}
            </dd>
          </div>

          {/* A future-tense warning gets a time estimate. A report about now
              does not — she has already arrived.
              Only show it when we actually HAVE one: printing "not heading
              toward the road" directly under a headline that says she is
              heading toward the road made the screen contradict itself. */}
          {!isNow && info.ttrSeconds !== null && (
            <div className="border-b border-white/25 pb-2">
              <dd className="font-semibold">{ttrWords(info.ttrSeconds, t)}</dd>
            </div>
          )}

          {info.roadName && (
            <div className="flex items-baseline justify-between border-b border-white/25 pb-2">
              <dt className="font-semibold opacity-90">{t('danger.traffic_now')}</dt>
              <dd className="font-bold">
                {info.trafficFast ? t('danger.traffic_fast') : t('danger.traffic_slow')}
              </dd>
            </div>
          )}

          {sentence && <p className="pt-1 text-[20px] font-bold leading-snug">{sentence}</p>}
        </dl>

        {/* §13.4 — say so when the risk is running on the fallback model. */}
        {info.trafficFallback && (
          <p className="mt-4 rounded-xl bg-white/15 p-3 text-[15px] font-semibold">
            {t('map.fallback_traffic')}
          </p>
        )}

        {/* The farmer must know the system is already acting (§9.3). */}
        <p className="mt-6 inline-block rounded-xl bg-white px-4 py-3 text-[18px]
                      font-extrabold text-red">
          {t('danger.collar_alarm_on')}
        </p>
      </div>

      <div className="grid gap-2 bg-danger p-5 pb-8">
        <button
          onClick={() => { onDismiss(); navigate(`/animal/${info.animalId}`); }}
          className="btn w-full bg-white text-[18px] font-extrabold text-red"
        >
          {t('danger.see_her_live')}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn border-2 border-white/70 text-white">
            {t('animal.make_beep')}
          </button>
          <a
            href={info.helperPhone ? `tel:${info.helperPhone}` : undefined}
            role="button"
            className="btn border-2 border-white/70 text-center text-white"
          >
            {t('danger.call_for_help')}
          </a>
        </div>
        {/* This dismisses a danger warning. It was mistakenly wired to the
            zone-drawing "undo" string, which said the wrong thing entirely. */}
        <button onClick={onDismiss} className="btn text-white/80 underline">
          {t('danger.dismiss')}
        </button>
      </div>
    </div>
  );
}
