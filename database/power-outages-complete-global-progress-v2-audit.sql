with definition as (
  select coalesce(pg_get_functiondef(
    to_regprocedure('public.refresh_complete_power_outage_global_progress_snapshot()')
  ), '') as body
), checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'global progress uses commercial selection queues',
      (select position('complete_power_outage_company_enrichment_overview' in body) > 0
          and position('complete_power_outage_company_scoring_overview' in body) > 0
       from definition)),
    ('LOGIC', 'global progress includes ARES RES enrichment',
      (select position('enrichment_remaining' in body) > 0 from definition)),
    ('LOGIC', 'global progress includes local commercial scoring',
      (select position('scoring_remaining' in body) > 0 from definition)),
    ('LOGIC', 'global ETA uses candidate evaluation throughput only',
      (select position('metadata ->> ''queueMode'' = ''candidate''' in body) > 0 from definition)),
    ('GRANT', 'authenticated cannot refresh global progress',
      not has_function_privilege('authenticated',
        'public.refresh_complete_power_outage_global_progress_snapshot()', 'EXECUTE')),
    ('ISOLATION', 'global progress remains in COMPLETE scope',
      (select position('public.power_outages' in body) = 0
          and position('public.stores' in body) = 0
       from definition)),
    ('DATA', 'global progress metadata exposes commercial queues',
      exists (
        select 1
        from public.complete_power_outage_global_progress_snapshot snapshot
        where snapshot.singleton
          and snapshot.metadata -> 'remaining' ? 'enrichment'
          and snapshot.metadata -> 'remaining' ? 'scoring'
          and snapshot.metadata ->> 'calculation' = 'critical-path-v2-commercial-selection'
      )),
    ('SAFETY', 'global progress remains read only for authenticated',
      not has_table_privilege('authenticated',
        'public.complete_power_outage_global_progress_snapshot', 'INSERT')
      and not has_table_privilege('authenticated',
        'public.complete_power_outage_global_progress_snapshot', 'UPDATE')
      and not has_table_privilege('authenticated',
        'public.complete_power_outage_global_progress_snapshot', 'DELETE'))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
