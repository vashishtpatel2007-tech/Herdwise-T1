-- ---------------------------------------------------------------------------
-- 0009: Unassigned Devices RLS Policy
--
-- The devices_owner policy in 0002_rls.sql only allowed operations on rows
-- where `animal_id in (select id from animals where farmer_id = current_farmer_id())`.
--
-- This blocked farmers from viewing unassigned collars (`animal_id is null`)
-- in the Add Animal flow (`AddAnimalScreen.tsx`), making it impossible to pair
-- new collars to newly added animals.
--
-- This migration allows authenticated farmers to view unassigned devices and
-- claim/pair them to one of their own registered animals.
-- ---------------------------------------------------------------------------

drop policy if exists devices_unassigned_read on devices;
create policy devices_unassigned_read on devices
  for select using (animal_id is null);

drop policy if exists devices_unassigned_pair on devices;
create policy devices_unassigned_pair on devices
  for update using (animal_id is null)
  with check (animal_id in (select id from animals where farmer_id = current_farmer_id()));
