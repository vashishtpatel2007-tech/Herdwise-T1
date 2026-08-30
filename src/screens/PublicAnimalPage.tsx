/**
 * §9.7 — /a/:public_slug. No auth, no app, no collar required.
 *
 * What a bystander sees after scanning the ear tag. This is the part of the
 * system that actually scales: it works on the animals that will never wear
 * electronics, and it needs nothing installed.
 *
 * Must load in under 2 s on 3G, so this route pulls one RPC and no map, no
 * realtime socket, and no herd state.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase.ts';

interface PublicAnimal {
  found: boolean;
  name?: string;
  photo_url?: string | null;
  breed?: string | null;
  tag?: string | null;
  is_active?: boolean;
  owner_name?: string | null;
  village?: string | null;
  owner_phone_masked?: string | null;
  owner_phone_tel?: string | null;
}

/** Municipal animal-welfare contact. Configured per district in production. */
const AUTHORITY_TEL = '1962'; // India's national animal-ambulance helpline

export function PublicAnimalPage() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();
  const [data, setData] = useState<PublicAnimal | null>(null);
  const [logged, setLogged] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data: d } = await supabase.rpc('public_animal', { p_slug: slug });
      setData((d ?? { found: false }) as PublicAnimal);
    })();
  }, [slug]);

  /** Log the scan, attaching location only if the bystander permits it. */
  async function logScan(outcome: 'owner_contacted' | 'routed_to_authority') {
    if (logged) return;
    setLogged(true);

    const write = (lat: number | null, lon: number | null) =>
      supabase.rpc('log_scan', { p_slug: slug, p_lat: lat, p_lon: lon, p_outcome: outcome });

    if (!('geolocation' in navigator)) { void write(null, null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => void write(p.coords.latitude, p.coords.longitude),
      () => void write(null, null), // refused — still log the scan itself
      { timeout: 4000 },
    );
  }

  if (!data) {
    return <main className="p-6 text-[18px] font-semibold">{t('public.loading')}</main>;
  }

  // Unregistered or flagged abandoned → route to the authority either way.
  if (!data.found || data.is_active === false) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="d-lg">{t('public.unknown')}</h1>
        <a
          href={`tel:${AUTHORITY_TEL}`}
          role="button"
          onClick={() => void logScan('routed_to_authority')}
          className="btn btn-danger mt-6 w-full text-[18px]"
        >
          {t('public.contact_authority')}
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md pb-10">
      {data.photo_url
        ? <img src={data.photo_url} alt="" className="h-64 w-full object-cover" />
        : <div className="flex h-48 w-full items-center justify-center bg-card2
                          font-display text-6xl font-extrabold">
            {data.name?.slice(0, 1)}
          </div>}

      <div className="p-6">
        <h1 className="font-display text-[34px] font-extrabold leading-tight">{data.name}</h1>
        <p className="mt-1 text-[17px] font-semibold opacity-70">
          {data.breed} · {t('public.tag')} {data.tag}
        </p>

        <div className="card mt-5">
          <p className="text-[15px] font-semibold opacity-60">{t('public.owner')}</p>
          <p className="text-[19px] font-bold">{data.owner_name}</p>
          {data.village && (
            <p className="text-[16px] font-semibold opacity-70">
              {t('public.village')}: {data.village}
            </p>
          )}
          {/* Masked: enough to confirm the right person, not enough to harvest. */}
          <p className="tnum mt-2 text-[17px] font-bold">{data.owner_phone_masked}</p>
        </div>

        <a
          href={`tel:${data.owner_phone_tel}`}
          role="button"
          onClick={() => void logScan('owner_contacted')}
          className="btn btn-primary mt-5 w-full text-[19px] font-extrabold"
        >
          {t('public.call_owner')}
        </a>

        {/* Escalates either way — a hurt animal is urgent whether or not the
            owner picks up. */}
        <a
          href={`tel:${AUTHORITY_TEL}`}
          role="button"
          onClick={() => void logScan('routed_to_authority')}
          className="btn btn-danger mt-3 w-full"
        >
          {t('public.injured')}
        </a>
      </div>
    </main>
  );
}
