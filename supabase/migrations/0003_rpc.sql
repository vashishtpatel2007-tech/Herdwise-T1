-- PashuGuard — geometry helpers (§7.10 "Engine B enriches from the database")
-- All distance/bearing math lives here in PostGIS rather than in TypeScript.
-- The engine stays pure and testable; the database stays authoritative on geometry.

-- Latest fix per animal, ignoring rows that failed the §7.2 GPS veto.
-- A poor fix must never become the position we reason about or display.
-- security_invoker is REQUIRED. Without it the view runs as its owner and the
-- telemetry_owner RLS policy does not apply, so any authenticated caller would
-- read every farmer's positions.
create or replace view latest_positions
with (security_invoker = on) as
select distinct on (t.animal_id)
  t.animal_id,
  t.device_id,
  t.position,
  st_y(t.position::geometry) as lat,
  st_x(t.position::geometry) as lon,
  t.speed_kmh,
  t.heading_deg,
  t.fix_quality,
  t.hdop,
  t.sats,
  t.battery_pct,
  t.movement_state,
  t.recorded_at
from telemetry t
where t.poor_fix = false
order by t.animal_id, t.recorded_at desc;

-- Herd centroid + spread (§7.5). Cattle are herd animals; separation is the
-- single strongest straying predictor and every position is already stored,
-- so this costs nothing.
create or replace function herd_context(p_farmer_id uuid)
returns table (centroid geography, median_dist double precision)
language sql stable
as $$
  with pts as (
    select lp.position
    from latest_positions lp
    join animals a on a.id = lp.animal_id
    where a.farmer_id = p_farmer_id
      and a.is_active
      and lp.recorded_at > now() - interval '30 minutes'
  ),
  c as (
    select st_centroid(st_collect(position::geometry))::geography as centroid from pts
  )
  select
    c.centroid,
    coalesce(
      percentile_cont(0.5) within group (order by st_distance(p.position, c.centroid)),
      0
    )
  from c left join pts p on true
  group by c.centroid;
$$;

-- Everything Engine B needs about one position, in a single round trip.
create or replace function enrich_context(
  p_animal_id uuid,
  p_lat double precision,
  p_lon double precision
)
returns jsonb
language plpgsql stable
as $$
declare
  pt          geography := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;
  v_farmer    uuid;
  road        record;
  zone        record;
  herd        record;
  traffic     record;
  v_prior     integer;
begin
  select farmer_id into v_farmer from animals where id = p_animal_id;

  -- Nearest dangerous road. KNN (<->) uses the GiST index instead of scanning.
  select r.id, r.name, r.highway_class, r.base_risk,
         st_distance(r.geom, pt) as dist,
         degrees(st_azimuth(
           pt,
           st_closestpoint(r.geom::geometry, pt::geometry)::geography
         )) as bearing
  into road
  from road_segments r
  order by r.geom <-> pt
  limit 1;

  -- Owning zone, plus signed distance to the buffered edge.
  -- Positive distance_to_edge = still inside the buffer (safe margin left).
  select z.id, z.name, z.buffer_m, z.is_enabled, z.active_from, z.active_to,
         st_intersects(z.boundary, pt) as inside,
         st_distance(st_exteriorring(z.boundary::geometry)::geography, pt) as edge_dist
  into zone
  from grazing_zones z
  where z.farmer_id = v_farmer and z.is_enabled
  order by z.boundary <-> pt
  limit 1;

  select * into herd from herd_context(v_farmer);

  -- Freshest traffic sample for that road, only if recent enough to trust.
  select ts.current_speed_kmh, ts.free_flow_kmh, ts.confidence, ts.fetched_at
  into traffic
  from traffic_snapshots ts
  where ts.road_segment_id = road.id
    and ts.fetched_at > now() - interval '45 minutes'
  order by ts.fetched_at desc
  limit 1;

  -- How often this animal has approached this specific road before.
  select count(*) into v_prior
  from alerts al
  where al.animal_id = p_animal_id
    and al.road_name is not distinct from road.name
    and al.created_at > now() - interval '30 days';

  return jsonb_build_object(
    'nearest_road_id',    road.id,
    'road_name',          road.name,
    'road_class',         road.highway_class,
    'base_risk',          coalesce(road.base_risk, 0),
    'distance_to_road',   road.dist,
    'bearing_to_road',    road.bearing,
    'inside_zone',        coalesce(zone.inside, true),
    'zone_id',            zone.id,
    'zone_buffer_m',      coalesce(zone.buffer_m, 30),
    'distance_to_zone_edge', zone.edge_dist,
    'herd_centroid_lat',  st_y(herd.centroid::geometry),
    'herd_centroid_lon',  st_x(herd.centroid::geometry),
    'herd_median_dist',   herd.median_dist,
    'distance_from_centroid', case when herd.centroid is null then null
                                   else st_distance(pt, herd.centroid) end,
    'current_traffic_speed', traffic.current_speed_kmh,
    'free_flow_speed',    traffic.free_flow_kmh,
    'traffic_confidence', traffic.confidence,
    'traffic_is_stale',   traffic.fetched_at is null,
    'prior_approaches_to_this_road', coalesce(v_prior, 0)
  );
end;
$$;

-- Separation rate (§7.5): change in distance-from-centroid over ~10 min, m/min.
create or replace function separation_rate(p_animal_id uuid)
returns double precision
language sql stable
as $$
  with c as (select centroid from herd_context(
      (select farmer_id from animals where id = p_animal_id))),
  window_fixes as (
    select t.position, t.recorded_at
    from telemetry t
    where t.animal_id = p_animal_id
      and t.poor_fix = false
      and t.recorded_at > now() - interval '10 minutes'
    order by t.recorded_at
  ),
  bounds as (
    select
      (select st_distance(position, (select centroid from c))
         from window_fixes order by recorded_at limit 1)      as d_first,
      (select st_distance(position, (select centroid from c))
         from window_fixes order by recorded_at desc limit 1) as d_last,
      (select extract(epoch from (max(recorded_at) - min(recorded_at)))/60.0
         from window_fixes)                                   as minutes
  )
  select case when minutes is null or minutes < 1 then 0
              else (d_last - d_first) / minutes end
  from bounds;
$$;

-- Public animal page (§9.7). The ONLY unauthenticated read path.
-- SECURITY DEFINER so the underlying tables stay closed behind RLS; this
-- returns a deliberately narrow column set with the owner phone masked.
create or replace function public_animal(p_slug text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare a record; f record;
begin
  select id, name, photo_url, breed, pashu_aadhaar_tag, farmer_id, is_active
  into a from animals where public_slug = p_slug;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select name, phone, village into f from farmers where id = a.farmer_id;

  return jsonb_build_object(
    'found',  true,
    'name',   a.name,
    'photo_url', a.photo_url,
    'breed',  a.breed,
    'tag',    a.pashu_aadhaar_tag,
    'is_active', a.is_active,
    'owner_name', f.name,
    'village',    f.village,
    -- Masked: enough to confirm you have the right person, not enough to harvest.
    'owner_phone_masked',
      case when f.phone is null then null
           else regexp_replace(f.phone, '(\+?\d{2})(\d+)(\d{2})$', '\1••••••\3') end,
    'owner_phone_tel', f.phone   -- consumed by tel: link only
  );
end;
$$;

revoke all on function public_animal(text) from public;
grant execute on function public_animal(text) to anon, authenticated;

-- A bystander must be able to log a scan without an account (§9.7).
create or replace function log_scan(
  p_slug text, p_lat double precision, p_lon double precision, p_outcome text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_animal uuid; v_id uuid;
begin
  select id into v_animal from animals where public_slug = p_slug;
  insert into scan_events (animal_id, scanned_tag, scanner_position, outcome)
  values (
    v_animal, p_slug,
    case when p_lat is null then null
         else st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography end,
    coalesce(p_outcome, case when v_animal is null then 'unknown_tag' else 'owner_contacted' end)
  ) returning id into v_id;
  return v_id;
end;
$$;
grant execute on function log_scan(text, double precision, double precision, text) to anon, authenticated;
