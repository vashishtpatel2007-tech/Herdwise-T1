-- Fixes for defects found by the adversarial audit. Each block names the bug.

-- ---------------------------------------------------------------------------
-- 1. Cooldown needs the severity we last NOTIFIED at.
--
-- The engine compared against the previous STATE, which by the time the
-- cooldown check runs has always just risen — so the guard was always false
-- and the §7.9 180 s cooldown was dead code.
-- ---------------------------------------------------------------------------
alter table risk_state
  add column if not exists last_alert_severity text
  check (last_alert_severity in ('warning','high','critical'));

-- ---------------------------------------------------------------------------
-- 2. CRITICAL: the Monte Carlo cone never ran in production.
--
-- PostgREST serialises a geography column through the type's output function,
-- which emits hex EWKB (0101000020E610...), NOT 'POINT(x y)'. The ingest
-- function parsed it with /POINT\(([-\d.]+) ([-\d.]+)\)/, which never matched,
-- so recent_fixes was ALWAYS empty, trajectoryCone always returned
-- computed:false, and p_reaches_road_5min was always null. The headline
-- feature was dead and the unit tests could not see it, because they feed the
-- engine fixtures directly and never cross the database boundary.
--
-- Return real numbers instead of asking the caller to parse geometry.
-- ---------------------------------------------------------------------------
create or replace function recent_fixes(p_animal_id uuid, p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', f.lat, 'lon', f.lon, 'recorded_at', f.recorded_at
         ) order by f.recorded_at), '[]'::jsonb)
  from (
    select st_y(t.position::geometry) as lat,
           st_x(t.position::geometry) as lon,
           t.recorded_at
    from telemetry t
    where t.animal_id = p_animal_id and t.poor_fix = false
    order by t.recorded_at desc
    limit greatest(1, least(p_limit, 50))
  ) f;
$$;
revoke all on function recent_fixes(uuid, integer) from public, anon, authenticated;
grant execute on function recent_fixes(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 3. ON CONFLICT cannot infer a PARTIAL unique index.
--
-- PostgREST emits ON CONFLICT (device_id, seq); Postgres refuses to match that
-- to an index carrying WHERE (seq IS NOT NULL), so EVERY ingest upsert would
-- have failed. The predicate was never needed — Postgres already treats NULLs
-- as distinct in a unique index, so rows with seq IS NULL never collide.
-- ---------------------------------------------------------------------------
drop index if exists telemetry_device_seq_uniq;
create unique index telemetry_device_seq_uniq on telemetry (device_id, seq);

-- ---------------------------------------------------------------------------
-- 4. PRIVACY: the phone mask failed OPEN.
--
-- regexp_replace returns its INPUT UNCHANGED when the pattern does not match.
-- The old mask needed >=5 trailing digits, so any number stored with an
-- extension, odd spacing, or fewer digits was emitted IN FULL from the
-- anon-callable public page. Build the masked string from digits explicitly so
-- it cannot fall through to the raw value.
-- ---------------------------------------------------------------------------
create or replace function mask_phone(p_phone text)
returns text language plpgsql immutable
-- Pinned so a caller-controlled schema cannot shadow regexp_replace.
set search_path = pg_catalog, public
as $$
declare d text;
begin
  if p_phone is null then return null; end if;
  d := regexp_replace(p_phone, '\D', '', 'g');
  if length(d) < 4 then return '••••'; end if;   -- fail CLOSED, never raw
  return '••••••' || right(d, 3);
end; $$;
revoke all on function mask_phone(text) from public, anon;
grant execute on function mask_phone(text) to authenticated, service_role;

create or replace function public_animal(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare a record; f record;
begin
  select id, name, photo_url, breed, pashu_aadhaar_tag, farmer_id, is_active
  into a from animals where public_slug = p_slug;
  if not found then return jsonb_build_object('found', false); end if;
  select name, phone, village into f from farmers where id = a.farmer_id;
  return jsonb_build_object(
    'found', true, 'name', a.name, 'photo_url', a.photo_url, 'breed', a.breed,
    'tag', a.pashu_aadhaar_tag, 'is_active', a.is_active,
    'owner_name', f.name, 'village', f.village,
    'owner_phone_masked', mask_phone(f.phone),
    -- Still returned because the page exists to give a working "Call owner"
    -- button and tel: needs a real number. Mitigations: unguessable slugs
    -- (below) and scan logging. The production answer is a masked-calling
    -- proxy so the raw number never leaves the server — a telephony task.
    'owner_phone_tel', f.phone
  );
end; $$;
revoke all on function public_animal(text) from public;
grant execute on function public_animal(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Slugs were derived from the animal's NAME, so they were guessable
-- ('demo-lakshmi'). Combined with an anon-callable RPC returning a phone
-- number, that is a harvesting endpoint. Add 8 hex chars of entropy.
-- ---------------------------------------------------------------------------
create or replace function generate_public_slug(p_name text)
returns text language plpgsql volatile security definer set search_path = public, extensions
as $$
declare base text; candidate text;
begin
  base := regexp_replace(lower(coalesce(nullif(trim(p_name), ''), 'animal')), '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  if base = '' then base := 'animal'; end if;
  loop
    candidate := base || '-' || encode(extensions.gen_random_bytes(4), 'hex');
    exit when not exists (select 1 from animals where public_slug = candidate);
  end loop;
  return candidate;
end; $$;
revoke all on function generate_public_slug(text) from public, anon;
grant execute on function generate_public_slug(text) to authenticated, service_role;
