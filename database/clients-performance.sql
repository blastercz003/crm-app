create index if not exists clients_name_order_idx
  on public.clients (name);

create index if not exists clients_created_by_name_idx
  on public.clients (created_by, name);

create index if not exists client_contacts_client_sort_idx
  on public.client_contacts (client_id, is_primary desc, name);

create index if not exists meetings_client_datetime_idx
  on public.meetings (client_id, meeting_datetime desc);

create index if not exists tasks_client_created_idx
  on public.tasks (client_id, created_at desc);

create index if not exists offers_client_updated_idx
  on public.offers (client_id, updated_at desc);

create index if not exists jobs_client_start_idx
  on public.jobs (client_id, start_at desc);

create or replace function public.record_user_activity(
  p_user_id uuid,
  p_route text,
  p_section text,
  p_action text,
  p_created_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Activity can only be recorded for the current user.';
  end if;

  insert into public.user_activity_log (
    user_id,
    route,
    section,
    action,
    created_at
  )
  values (
    p_user_id,
    p_route,
    p_section,
    p_action,
    p_created_at
  );

  update public.user_presence
  set
    last_route = p_route,
    last_section = p_section,
    last_action = p_action,
    last_action_at = p_created_at
  where user_id = p_user_id;
end;
$$;

revoke all on function public.record_user_activity(uuid, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.record_user_activity(uuid, text, text, text, timestamptz)
  to authenticated;
