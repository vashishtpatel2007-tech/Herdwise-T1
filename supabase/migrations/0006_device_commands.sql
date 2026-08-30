-- ---------------------------------------------------------------------------
-- Command Queue (Downlink)
--
-- Farmers queue commands (e.g. beep, steer) from the app. The gateway polls 
-- for these via the ingest edge function, popping them so they only deliver once.
-- ---------------------------------------------------------------------------

create table device_commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid references devices(id) on delete cascade,
  command      text not null,
  payload      jsonb not null default '{}'::jsonb,
  issued_by    uuid references farmers(id) on delete set null,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  acked_at     timestamptz,
  expires_at   timestamptz not null default (now() + interval '2 minutes')
);
create index on device_commands (device_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table device_commands enable row level security;

-- A farmer can view commands for devices attached to their animals
create policy "device_commands_select" on device_commands
  for select using (
    issued_by = current_farmer_id() or exists (
      select 1 from devices d
      join animals a on a.id = d.animal_id
      where d.id = device_commands.device_id
        and a.farmer_id = current_farmer_id()
    )
  );

-- A farmer can insert commands for devices attached to their animals
create policy "device_commands_insert" on device_commands
  for insert with check (
    exists (
      select 1 from devices d
      join animals a on a.id = d.animal_id
      where d.id = device_id
        and a.farmer_id = current_farmer_id()
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: pop_commands
-- Called by the ingest edge function to atomically fetch and mark delivered.
-- ---------------------------------------------------------------------------
create or replace function pop_commands(p_device_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  with popped as (
    update device_commands
    set delivered_at = now()
    where device_id = p_device_id
      and delivered_at is null
      and expires_at > now()
    returning command, payload
  )
  select coalesce(jsonb_agg(jsonb_build_object('command', command, 'payload', payload)), '[]'::jsonb)
  into result
  from popped;

  return result;
end;
$$;

-- Security Grants: Only the service_role (edge function) can pop commands
revoke all on function pop_commands(uuid) from public, anon, authenticated;
grant execute on function pop_commands(uuid) to service_role;
