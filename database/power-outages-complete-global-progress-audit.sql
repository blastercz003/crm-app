select 'TABLE' as check_type, 'complete global progress snapshot' as object_name,
  to_regclass('public.complete_power_outage_global_progress_snapshot') is not null as is_correct
union all
select 'FUNCTION', 'refresh complete global progress snapshot',
  to_regprocedure('public.refresh_complete_power_outage_global_progress_snapshot()') is not null
union all
select 'CRON', 'global progress snapshot every minute',
  exists (select 1 from cron.job
    where jobname = 'complete_global_progress_snapshot_every_minute' and active)
union all
select 'DATA', 'global progress snapshot is populated',
  exists (select 1 from public.complete_power_outage_global_progress_snapshot
    where singleton and refreshed_at > now() - interval '3 minutes')
union all
select 'GRANT', 'authenticated reads global progress only',
  has_table_privilege('authenticated', 'public.complete_power_outage_global_progress_snapshot', 'SELECT')
  and not has_function_privilege('authenticated',
    'public.refresh_complete_power_outage_global_progress_snapshot()', 'EXECUTE')
union all
select 'ISOLATION', 'global progress does not reference MARKET outage tables',
  position('power_outage_store' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure))) = 0
union all
select 'LOGIC', 'inactive Google is excluded from aggregate progress',
  position('provider = ''google''' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure))) = 0
union all
select 'LOGIC', 'municipality-only targets are excluded from provider progress',
  position('municipality_target_count' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure))) = 0
union all
select 'LOGIC', 'full Mapy address queue contributes to global progress',
  position('complete_power_outage_provider_overview_snapshot' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure))) > 0;
