begin;

alter table public.profiles
  add column if not exists can_view_markets boolean not null default false;

update public.profiles
set can_view_markets = true
where role = 'admin'
  and can_view_markets = false;

create or replace function public.current_user_can_view_power_outage_markets()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or profiles.can_view_markets = true
      )
  )
$$;

revoke all on function public.current_user_can_view_power_outage_markets()
  from public, anon;
grant execute on function public.current_user_can_view_power_outage_markets()
  to authenticated;

create or replace function public.profiles_enforce_admin_markets_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'admin' then
    new.can_view_markets := true;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_enforce_admin_markets_access()
  from public, anon, authenticated;

drop trigger if exists profiles_enforce_admin_markets_access_on_insert
  on public.profiles;
create trigger profiles_enforce_admin_markets_access_on_insert
before insert on public.profiles
for each row
execute function public.profiles_enforce_admin_markets_access();

drop trigger if exists profiles_enforce_admin_markets_access_on_update
  on public.profiles;
create trigger profiles_enforce_admin_markets_access_on_update
before update of role, can_view_markets on public.profiles
for each row
execute function public.profiles_enforce_admin_markets_access();

create or replace function public.profiles_protect_markets_access_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.can_view_markets is distinct from old.can_view_markets
    and coalesce(auth.role(), '') <> 'service_role'
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

select 'COLUMN' as check_type,
       'profiles.can_view_markets' as object_name,
       exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'profiles'
           and column_name = 'can_view_markets'
           and data_type = 'boolean'
           and is_nullable = 'NO'
           and column_default like 'false%'
       ) as is_correct
union all
select 'DATA', 'administrators can view MARKETY',
       not exists (
         select 1 from public.profiles
         where role = 'admin' and can_view_markets is not true
       )
union all
select 'FUNCTION', 'current user MARKETY access',
       to_regprocedure('public.current_user_can_view_power_outage_markets()') is not null
union all
select 'TRIGGER', 'MARKETY access flag is administrator-managed',
       exists (
         select 1 from pg_trigger
         where tgrelid = 'public.profiles'::regclass
           and tgname = 'profiles_protect_markets_access_flag'
           and not tgisinternal
       )
union all
select 'TRIGGER', 'administrators always retain MARKETY access',
       2 = (
         select count(*)
         from pg_trigger
         where tgrelid = 'public.profiles'::regclass
           and tgname in (
             'profiles_enforce_admin_markets_access_on_insert',
             'profiles_enforce_admin_markets_access_on_update'
           )
           and not tgisinternal
       )
order by check_type, object_name;
