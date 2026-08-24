-- Živá aktualizace ručních i automatických aktivit.
-- Změnu obdrží vlastník aktivity a všichni administrátoři.

begin;

create or replace function public.publish_activity_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[] := array[]::uuid[];
  admin_ids uuid[] := array[]::uuid[];
begin
  if tg_op = 'INSERT' then
    recipient_ids := array[new.user_id];
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.user_id];
  else
    recipient_ids := array[old.user_id, new.user_id];
  end if;

  select coalesce(array_agg(profile.id), array[]::uuid[])
    into admin_ids
  from public.profiles as profile
  where profile.role = 'admin';

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
    into recipient_ids
  from unnest(recipient_ids || admin_ids) as recipient_id
  where recipient_id is not null;

  perform public.publish_app_data_change('activities', recipient_ids);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.publish_activity_app_change()
  from public, anon, authenticated;

drop trigger if exists activities_publish_app_change on public.activities;
create trigger activities_publish_app_change
after insert or update or delete on public.activities
for each row execute function public.publish_activity_app_change();

commit;

-- Kontrolní výstup: oba řádky musí vrátit true.
select 'FUNCTION' as check_type,
       'publish_activity_app_change' as object_name,
       to_regprocedure('public.publish_activity_app_change()') is not null as is_correct
union all
select 'TRIGGER',
       'activities_publish_app_change',
       exists (
         select 1
         from pg_trigger
         where tgrelid = 'public.activities'::regclass
           and tgname = 'activities_publish_app_change'
           and not tgisinternal
       );
