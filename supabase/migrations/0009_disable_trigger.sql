-- Disable the legacy trigger that enqueues a full 32-point 'set_zone' command.
-- The FieldsScreen.tsx now directly issues downsampled 8-point 'set_boundary' commands.
alter table grazing_zones disable trigger trg_enqueue_zone_command;
