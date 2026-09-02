begin;

do $$
begin
  if to_regprocedure('public.publish_power_outages_app_change()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.publish_power_outages_app_change().';
  end if;
end
$$;

-- Průběžný stav se ukládá do metadata existujícího auditního běhu. Trigger
-- pošle uživatelům bezpečný signál k obnovení serverových dat; externí zdroje
-- distributorů tím nejsou znovu dotazovány.
drop trigger if exists power_outage_match_runs_publish_app_change
  on public.power_outage_match_runs;
create trigger power_outage_match_runs_publish_app_change
after insert or update or delete on public.power_outage_match_runs
for each statement execute function public.publish_power_outages_app_change();

commit;

select 'TRIGGER' as check_type,
  'power_outage_match_runs_publish_app_change' as object_name,
  exists (
    select 1
    from pg_trigger
    where tgname = 'power_outage_match_runs_publish_app_change'
      and tgrelid = 'public.power_outage_match_runs'::regclass
      and not tgisinternal
  ) as is_correct
union all
select 'RLS', 'authenticated cannot update matching progress',
  not has_table_privilege('authenticated', 'public.power_outage_match_runs', 'UPDATE')
order by check_type, object_name;
