select 'TABLE' as check_type, 'complete CEZ projection runs' as object_name,
  to_regclass('public.complete_power_outage_cez_projection_runs') is not null as is_correct
union all
select 'TABLE', 'complete CEZ projection outages',
  to_regclass('public.complete_power_outage_cez_projection_outages') is not null
union all
select 'TABLE', 'complete CEZ projection addresses',
  to_regclass('public.complete_power_outage_cez_projection_addresses') is not null
union all
select 'STATE', 'complete CEZ projection stays legacy',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'PIPELINE', 'partial CEZ cycle can be projected progressively',
  position('cycle.status in (''running'', ''succeeded'')' in pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure)) > 0
union all
select 'CRON', 'complete CEZ shadow projection every five minutes',
  exists (select 1 from cron.job
    where jobname = 'complete_cez_shadow_projection_every_five_minutes'
      and active)
union all
select 'SAFETY', 'only complete snapshot can mark missing outages',
  position('selected_cycle.snapshot_status = ''complete''' in pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure)) > 0
  and position('selected_cycle.snapshot_publishable' in pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure)) > 0
union all
select 'ISOLATION', 'projection builder does not write MARKET tables',
  position('power_outage_store_matches' in lower(pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure))) = 0
  and position('public.power_outages' in lower(pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure))) = 0
union all
select 'ISOLATION', 'projection builder does not write live COMPLETE catalog',
  position('public.complete_power_outages' in lower(pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure))) = 0
  and position('public.complete_power_outage_addresses' in lower(pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure))) = 0
union all
select 'GRANT', 'authenticated cannot build projection',
  not has_function_privilege('authenticated',
    'public.build_complete_power_outage_cez_shadow_projection()', 'EXECUTE')
order by check_type, object_name;
