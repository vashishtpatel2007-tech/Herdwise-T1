-- SECURITY FIX — function-level grants.
--
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Because every
-- helper in 0003 is SECURITY DEFINER, that made all of them callable by `anon`
-- through /rest/v1/rpc/*. Anyone holding the (public, embedded-in-the-bundle)
-- anon key could therefore:
--
--   * read ANY farmer's grazing-zone boundaries      (zones_geojson)
--   * read ANY farmer's herd centroid                (herd_context)
--   * enumerate enrichment geography for any animal  (enrich_context)
--   * DELETE traffic history                         (prune_traffic_snapshots)
--
-- RLS on the tables did not save us: SECURITY DEFINER runs as the owner and
-- bypasses it, which is the whole reason those functions exist. The fix is to
-- revoke first and grant back the minimum, per function, per role.
--
-- PostGIS's own functions are deliberately untouched: RLS policies and the
-- security_invoker view `latest_positions` call st_x/st_y AS THE QUERYING USER,
-- so revoking those would break reads for legitimate signed-in farmers.

-- ---- Engine-internal: service_role ONLY ---------------------------------
-- Called exclusively by the ingest / traffic-refresh Edge Functions. No
-- browser needs them, and each one exposes another farmer's geography.
revoke all on function enrich_context(uuid, double precision, double precision) from public, anon, authenticated;
revoke all on function separation_rate(uuid)                    from public, anon, authenticated;
revoke all on function herd_context(uuid)                       from public, anon, authenticated;
revoke all on function nearest_road_to(double precision, double precision) from public, anon, authenticated;
revoke all on function zone_centre_for_device(text)             from public, anon, authenticated;
revoke all on function segments_near_active_zones(integer)      from public, anon, authenticated;
revoke all on function prune_traffic_snapshots(integer)         from public, anon, authenticated;

grant execute on function enrich_context(uuid, double precision, double precision) to service_role;
grant execute on function separation_rate(uuid)                 to service_role;
grant execute on function herd_context(uuid)                    to service_role;
grant execute on function nearest_road_to(double precision, double precision) to service_role;
grant execute on function zone_centre_for_device(text)          to service_role;
grant execute on function segments_near_active_zones(integer)   to service_role;
grant execute on function prune_traffic_snapshots(integer)      to service_role;

-- ---- Client-facing: authenticated only ----------------------------------
revoke all on function road_line(bigint)              from public, anon;
revoke all on function roads_near_zones(uuid, integer) from public, anon;
revoke all on function zones_geojson(uuid)            from public, anon;
revoke all on function cone_for_animal(uuid)          from public, anon;
revoke all on function animal_track_today(uuid)       from public, anon;
revoke all on function packet_counts(uuid)            from public, anon;
revoke all on function generate_public_slug(text)     from public, anon;
revoke all on function current_farmer_id()            from public, anon;

grant execute on function road_line(bigint)              to authenticated, service_role;
grant execute on function roads_near_zones(uuid, integer) to authenticated;
grant execute on function zones_geojson(uuid)            to authenticated;
grant execute on function cone_for_animal(uuid)          to authenticated;
grant execute on function animal_track_today(uuid)       to authenticated;
grant execute on function packet_counts(uuid)            to authenticated;
grant execute on function generate_public_slug(text)     to authenticated;
grant execute on function current_farmer_id()            to authenticated, service_role;

-- ---- Defence in depth ---------------------------------------------------
-- Grants alone are insufficient for these two: they take a farmer_id as an
-- ARGUMENT, so any signed-in farmer could pass a neighbour's id and read their
-- land. Pin the argument to the caller's own farmer row.
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

-- CREATE OR REPLACE resets grants to the default, so re-apply them.
revoke all on function roads_near_zones(uuid, integer) from public, anon;
revoke all on function zones_geojson(uuid)            from public, anon;
grant execute on function roads_near_zones(uuid, integer) to authenticated;
grant execute on function zones_geojson(uuid)            to authenticated;

-- ---- The two genuinely public endpoints (§9.7) --------------------------
-- A bystander who scanned an ear tag has no account. These stay open by
-- design; both return a deliberately narrow result with the phone masked.
revoke all on function public_animal(text) from public;
grant execute on function public_animal(text) to anon, authenticated;
revoke all on function log_scan(text, double precision, double precision, text) from public;
grant execute on function log_scan(text, double precision, double precision, text) to anon, authenticated;

-- Verified after applying: as `anon`, all nine internal functions return
-- 401 / SQLSTATE 42501, while public_animal and log_scan still return 200.
