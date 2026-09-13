begin;

-- Supabase Table Editor runs without an application JWT. In that trusted
-- database context auth.role() is null, so direct profile maintenance must be
-- allowed. Requests coming through the application still carry a JWT and are
-- restricted to administrators (or the server-side service role).
create or replace function public.profiles_protect_power_outages_access_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_role text := auth.role();
begin
  if new.can_view_power_outages is distinct from old.can_view_power_outages
    and request_role is not null
    and request_role <> 'service_role'
    and not public.current_user_is_admin()
  then
    raise exception 'Přístup do sekce Odstávky může měnit pouze administrátor.';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_protect_power_outages_access_flag()
  from public, anon, authenticated;

commit;

select
  'FUNCTION'::text as check_type,
  'Supabase Table Editor can maintain power outage access while application requests remain guarded'::text as object_name,
  (
    to_regprocedure('public.profiles_protect_power_outages_access_flag()') is not null
    and pg_get_functiondef(
      'public.profiles_protect_power_outages_access_flag()'::regprocedure
    ) ilike '%request_role is not null%'
    and pg_get_functiondef(
      'public.profiles_protect_power_outages_access_flag()'::regprocedure
    ) ilike '%not public.current_user_is_admin()%'
  ) as is_correct;
