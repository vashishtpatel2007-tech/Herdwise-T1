-- ---------------------------------------------------------------------------
-- Telemetry Deduplication Fix
--
-- The ingest Edge Function passes { onConflict: 'device_id,seq,recorded_at' }
-- because `seq` alone is not unique across collar reboots. The previous 
-- migration created the index on just (device_id, seq), which causes Postgres
-- to reject the ON CONFLICT clause entirely.
-- ---------------------------------------------------------------------------

drop index if exists telemetry_device_seq_uniq;
create unique index telemetry_device_seq_uniq on telemetry (device_id, seq, recorded_at);
