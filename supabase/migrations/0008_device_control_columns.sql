-- ---------------------------------------------------------------------------
-- Missing Device Control Columns
--
-- The `devices` table in 0001_init.sql only defined: id, device_key, animal_id,
-- battery_pct, last_seen_at, firmware.
--
-- But the ingest Edge Function (line 72) SELECTs:
--   is_enabled, steering_on, mute_until, live_until
--
-- And the frontend collar.ts UPDATEs:
--   is_enabled, steering_on, mute_until, live_until
--
-- These 4 columns were never created by any migration. On a fresh Supabase
-- deploy, every SELECT and UPDATE touching them would fail with
-- "column does not exist", silently breaking:
--   - Collar on/off toggle
--   - Steering on/off toggle
--   - Mute functionality
--   - Live tracking (5-second reporting)
-- ---------------------------------------------------------------------------

alter table devices add column if not exists is_enabled  boolean default true;
alter table devices add column if not exists steering_on boolean default true;
alter table devices add column if not exists mute_until  timestamptz;
alter table devices add column if not exists live_until  timestamptz;
