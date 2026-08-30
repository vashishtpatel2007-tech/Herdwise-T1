import { createClient } from '@supabase/supabase-js';

/**
 * §1.5 — missing key fails loudly naming the variable. Never silently fall
 * back: a client pointed at nothing will render an empty, confident map, which
 * is worse than an error.
 */
function requireEnv(name: string): string {
  const v = import.meta.env[name as keyof ImportMetaEnv] as string | undefined;
  if (!v) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
      `Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_ANON_KEY'),
  {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 5 } },
  },
);

export interface LivePosition {
  animal_id: string;
  lat: number;
  lon: number;
  speed_kmh: number | null;
  heading_deg: number | null;
  battery_pct: number | null;
  recorded_at: string;
}

export interface AnimalRow {
  id: string;
  name: string;
  photo_url: string | null;
  breed: string | null;
  pashu_aadhaar_tag: string | null;
  public_slug: string;
  is_active: boolean;
}

export interface RiskRow {
  animal_id: string;
  state: 'safe' | 'watch' | 'warning' | 'high' | 'critical';
  situation: string;
  road_risk: number;
  p_reaches_road_5min: number | null;
  components: Record<string, unknown> | null;
  updated_at: string;
}
