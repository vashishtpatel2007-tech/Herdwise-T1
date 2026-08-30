-- Additional RPCs.
--
-- Named 0003b so it sorts BEFORE 0004_security_grants.sql, which revokes and
-- re-grants every function defined here. A fresh replay in filename order must
-- create them first or 0004 fails on "function does not exist".

-- Road geometry as [[lat,lon], ...] for the Monte Carlo crossing test (§7.7).
create or replace function road_line(p_road_id bigint)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_agg(jsonb_build_array(st_y(g.geom), st_x(g.geom)) order by g.idx)
  from road_segments r,
       lateral (
         select (dp).geom as geom, (dp).path[1] as idx
         from st_dumppoints(r.geom::geometry) dp
       ) g
  where r.id = p_road_id;
$$;

-- Dangerous roads near a farmer's zones, as GeoJSON, for the map layer (§9.1).
create or replace function roads_near_zones(p_farmer_id uuid, p_radius_m integer default 3000)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'base_risk', r.base_risk,
           'highway_class', r.highway_class,
           'geom', st_asgeojson(r.geom::geometry)::jsonb
         )), '[]'::jsonb)
  from road_segments r
  where p_farmer_id = current_farmer_id()
    and exists (
      select 1 from grazing_zones z
      where z.farmer_id = p_farmer_id and z.is_enabled
        and st_dwithin(r.geom, z.boundary, p_radius_m)
    );
$$;

-- Simulator helpers (§8).
create or replace function nearest_road_to(p_lat double precision, p_lon double precision)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'name', r.name, 'base_risk', r.base_risk, 'line', road_line(r.id)
  )
  from road_segments r
  order by r.geom <-> st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
  limit 1;
$$;

create or replace function zone_centre_for_device(p_device_key text)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'lat', st_y(st_centroid(z.boundary::geometry)),
    'lon', st_x(st_centroid(z.boundary::geometry)),
    'radius', greatest(120, sqrt(st_area(z.boundary) / pi()))
  )
  from devices d
  join animals a on a.id = d.animal_id
  join grazing_zones z on z.farmer_id = a.farmer_id and z.is_enabled
  where d.device_key = p_device_key
  limit 1;
$$;

-- The Monte Carlo endpoints are computed on ingest; persist them so the map
-- draws the cone without re-running 500 simulations in the browser (§7.7).
alter table risk_state add column if not exists cone jsonb;

create or replace function cone_for_animal(p_animal_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select rs.cone from risk_state rs
  join animals a on a.id = rs.animal_id
  where rs.animal_id = p_animal_id and a.farmer_id = current_farmer_id();
$$;

create or replace function zones_geojson(p_farmer_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', z.id, 'name', z.name, 'buffer_m', z.buffer_m,
    'ring', (
      select jsonb_agg(jsonb_build_array(st_y(g.geom), st_x(g.geom)) order by g.idx)
      from lateral (
        select (dp).geom as geom, (dp).path[2] as idx
        from st_dumppoints(st_exteriorring(z.boundary::geometry)) dp
      ) g
    )
  )), '[]'::jsonb)
  from grazing_zones z
  where z.farmer_id = p_farmer_id
    and p_farmer_id = current_farmer_id()
    and z.is_enabled;
$$;

-- §6.1 — segments within N metres of an active zone, with a midpoint to sample.
create or replace function segments_near_active_zones(p_radius_m integer default 3000)
returns table (id bigint, lat double precision, lon double precision)
language sql stable security definer set search_path = public
as $$
  select distinct r.id,
         st_y(st_lineinterpolatepoint(r.geom::geometry, 0.5)),
         st_x(st_lineinterpolatepoint(r.geom::geometry, 0.5))
  from road_segments r
  where exists (
    select 1 from grazing_zones z
    where z.is_enabled and st_dwithin(r.geom, z.boundary, p_radius_m)
  );
$$;

create or replace function prune_traffic_snapshots(p_keep_hours integer default 24)
returns integer language plpgsql security definer set search_path = public
as $$
declare n integer;
begin
  delete from traffic_snapshots
  where fetched_at < now() - (p_keep_hours || ' hours')::interval;
  get diagnostics n = row_count;
  return n;
end; $$;

-- §9.4 — today's track. Poor fixes are excluded: a rejected fix must never be
-- drawn as a place the animal actually was.
create or replace function animal_track_today(p_animal_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lat', st_y(t.position::geometry),
           'lon', st_x(t.position::geometry),
           'recorded_at', t.recorded_at
         ) order by t.recorded_at), '[]'::jsonb)
  from telemetry t
  join animals a on a.id = t.animal_id
  where t.animal_id = p_animal_id
    and a.farmer_id = current_farmer_id()
    and t.poor_fix = false
    and t.recorded_at > now() - interval '24 hours';
$$;

-- §9.6 — packet counts for the device page. The poor/total ratio is the
-- evidence behind a gps_fault alert.
create or replace function packet_counts(p_animal_id uuid)
returns jsonb language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', count(*),
    'poor', count(*) filter (where t.poor_fix)
  )
  from telemetry t
  join animals a on a.id = t.animal_id
  where t.animal_id = p_animal_id
    and a.farmer_id = current_farmer_id()
    and t.recorded_at > now() - interval '7 days';
$$;

-- Superseded by the entropy-bearing version in 0005; kept here so a replay in
-- filename order has the function to grant on.
create or replace function generate_public_slug(p_name text)
returns text language plpgsql volatile security definer set search_path = public
as $$
declare base text; candidate text;
begin
  base := regexp_replace(lower(coalesce(nullif(trim(p_name), ''), 'animal')), '[^a-z0-9]+', '-', 'g');
  base := trim(both '-' from base);
  if base = '' then base := 'animal'; end if;
  loop
    candidate := base || '-' || encode(gen_random_bytes(4), 'hex');
    exit when not exists (select 1 from animals where public_slug = candidate);
  end loop;
  return candidate;
end; $$;
