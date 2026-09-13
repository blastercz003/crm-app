begin;

create or replace function public.profiles_protect_markets_access_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.can_view_markets is distinct from old.can_view_markets
    and auth.role() is not null
    and auth.role() <> 'service_role'
    and not public.current_user_is_admin()
  then
    raise exception 'Přístup do režimu MARKETY může měnit pouze administrátor.';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_protect_markets_access_flag()
  from public, anon, authenticated;

drop trigger if exists profiles_protect_markets_access_flag
  on public.profiles;
create trigger profiles_protect_markets_access_flag
before update of can_view_markets on public.profiles
for each row
execute function public.profiles_protect_markets_access_flag();

commit;

select
  'FUNCTION'::text as check_type,
  'MARKETY access can be changed in Supabase Table Editor while app writes stay admin guarded'::text as object_name,
  to_regprocedure('public.profiles_protect_markets_access_flag()') is not null
  and pg_get_functiondef(
    'public.profiles_protect_markets_access_flag()'::regprocedure
  ) ilike '%auth.role() is not null%'
  and pg_get_functiondef(
    'public.profiles_protect_markets_access_flag()'::regprocedure
  ) ilike '%not public.current_user_is_admin()%'
  and exists (
    select 1
    from pg_trigger trigger_definition
    join pg_class target_table
      on target_table.oid = trigger_definition.tgrelid
    join pg_namespace target_schema
      on target_schema.oid = target_table.relnamespace
    where target_schema.nspname = 'public'
      and target_table.relname = 'profiles'
      and trigger_definition.tgname = 'profiles_protect_markets_access_flag'
      and not trigger_definition.tgisinternal
  ) as is_correct;
