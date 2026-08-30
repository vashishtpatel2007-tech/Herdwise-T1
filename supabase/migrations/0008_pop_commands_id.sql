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
    returning id, command, payload
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'command', command, 'payload', payload)), '[]'::jsonb)
  into result
  from popped;

  return result;
end;
$$;
