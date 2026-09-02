begin;

do $$
begin
  if to_regprocedure('public.publish_app_data_change(text,uuid[])') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.publish_app_data_change(text, uuid[]).';
  end if;
end
$$;

create or replace function public.publish_power_outages_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or profiles.can_view_power_outages = true;

  perform public.publish_app_data_change('power_outages', recipient_ids);
  return null;
end;
$$;

create or replace function public.publish_power_outage_preference_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
begin
  target_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  perform public.publish_app_data_change(
    'power_outages',
    array[target_user_id]::uuid[]
  );
  return null;
end;
$$;

revoke all on function public.publish_power_outages_app_change()
  from public, anon, authenticated;
revoke all on function public.publish_power_outage_preference_app_change()
  from public, anon, authenticated;

-- Starší pracovní varianta publikovala změnu po každé dávce importu či řádku
-- auditu. Pokud byla někde spuštěna, bezpečně ji odstraníme.
drop trigger if exists power_outages_publish_app_change
  on public.power_outages;
drop trigger if exists power_outage_registry_publish_app_change
  on public.power_outage_store_registry;

drop trigger if exists power_outage_matches_publish_app_change
  on public.power_outage_store_matches;
create trigger power_outage_matches_publish_app_change
after insert or update or delete on public.power_outage_store_matches
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_match_runs_publish_app_change
  on public.power_outage_match_runs;
create trigger power_outage_match_runs_publish_app_change
after insert or update or delete on public.power_outage_match_runs
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_sources_publish_app_change
  on public.power_outage_source_state;
create trigger power_outage_sources_publish_app_change
after insert or update or delete on public.power_outage_source_state
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_catalog_publish_app_change
  on public.power_outage_store_catalog_state;
create trigger power_outage_catalog_publish_app_change
after insert or update or delete on public.power_outage_store_catalog_state
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_tasks_publish_app_change
  on public.power_outage_task_state;
create trigger power_outage_tasks_publish_app_change
after insert or update or delete on public.power_outage_task_state
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_informed_publish_app_change
  on public.power_outage_informed_audit;
create trigger power_outage_informed_publish_app_change
after insert or update or delete on public.power_outage_informed_audit
for each statement execute function public.publish_power_outages_app_change();

drop trigger if exists power_outage_preferences_publish_app_change
  on public.power_outage_notification_preferences;
create trigger power_outage_preferences_publish_app_change
after insert or update or delete on public.power_outage_notification_preferences
for each row execute function public.publish_power_outage_preference_app_change();

commit;

select 'FUNCTION' as check_type,
  'publish_power_outages_app_change' as object_name,
  to_regprocedure('public.publish_power_outages_app_change()') is not null as is_correct
union all
select 'FUNCTION',
  'publish_power_outage_preference_app_change',
  to_regprocedure('public.publish_power_outage_preference_app_change()') is not null
union all
select 'TRIGGER', expected.trigger_name,
  exists (
    select 1
    from pg_trigger
    where pg_trigger.tgname = expected.trigger_name
      and not pg_trigger.tgisinternal
  )
from unnest(array[
  'power_outage_matches_publish_app_change',
  'power_outage_match_runs_publish_app_change',
  'power_outage_sources_publish_app_change',
  'power_outage_catalog_publish_app_change',
  'power_outage_tasks_publish_app_change',
  'power_outage_informed_publish_app_change',
  'power_outage_preferences_publish_app_change'
]) as expected(trigger_name)
order by check_type, object_name;
