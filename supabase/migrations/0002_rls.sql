-- PashuGuard — Row Level Security (§4)
-- A farmer reads/writes only rows where farmer_id resolves to their auth uid.
-- road_segments + traffic_snapshots: readable by any authenticated user.
-- The public animal page is the ONLY unauthenticated read path, and it goes
-- through a SECURITY DEFINER function (0003) that returns a narrow column set —
-- the tables themselves stay closed.

alter table farmers         enable row level security;
alter table helpers         enable row level security;
alter table animals         enable row level security;
alter table devices         enable row level security;
alter table telemetry       enable row level security;
alter table grazing_zones   enable row level security;
alter table road_segments   enable row level security;
alter table traffic_snapshots enable row level security;
alter table risk_state      enable row level security;
alter table alerts          enable row level security;
alter table scan_events     enable row level security;

-- Resolve the caller's farmer row once. STABLE so the planner caches it per
-- statement instead of re-running the subquery for every row.
create or replace function current_farmer_id()
returns uuid
language sql stable security definer
set search_path = public
as $$ select id from farmers where auth_uid = auth.uid() $$;

-- farmers ------------------------------------------------------------------
create policy farmers_self_read on farmers
  for select using (auth_uid = auth.uid());
create policy farmers_self_write on farmers
  for update using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());
create policy farmers_self_insert on farmers
  for insert with check (auth_uid = auth.uid());

-- Generic owner policies ---------------------------------------------------
create policy helpers_owner on helpers
  for all using (farmer_id = current_farmer_id())
  with check (farmer_id = current_farmer_id());

create policy animals_owner on animals
  for all using (farmer_id = current_farmer_id())
  with check (farmer_id = current_farmer_id());

create policy zones_owner on grazing_zones
  for all using (farmer_id = current_farmer_id())
  with check (farmer_id = current_farmer_id());

create policy alerts_owner on alerts
  for all using (farmer_id = current_farmer_id())
  with check (farmer_id = current_farmer_id());

-- Ownership reached through animals ----------------------------------------
create policy devices_owner on devices
  for all using (
    animal_id in (select id from animals where farmer_id = current_farmer_id())
  );

create policy telemetry_owner on telemetry
  for select using (
    animal_id in (select id from animals where farmer_id = current_farmer_id())
  );

create policy risk_state_owner on risk_state
  for select using (
    animal_id in (select id from animals where farmer_id = current_farmer_id())
  );

create policy scan_events_owner on scan_events
  for select using (
    animal_id in (select id from animals where farmer_id = current_farmer_id())
  );

-- Shared reference data ----------------------------------------------------
create policy roads_read_authed on road_segments
  for select to authenticated using (true);
create policy traffic_read_authed on traffic_snapshots
  for select to authenticated using (true);

-- NOTE: no INSERT/UPDATE policy exists for telemetry, risk_state or
-- road_segments. Those are written exclusively by Edge Functions and scripts
-- holding the service role key, which bypasses RLS. A compromised browser
-- token therefore cannot forge a position or silence a risk state.
