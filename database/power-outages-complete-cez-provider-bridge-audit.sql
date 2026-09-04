select 'FUNCTION' as check_type,
  'advance complete CEZ projection' as object_name,
  to_regprocedure('public.advance_complete_power_outage_cez_projection()') is not null as is_correct
union all
select 'CRON', 'complete CEZ projection bridge every five minutes',
  exists (
    select 1 from cron.job
    where jobname = 'complete_cez_shadow_projection_every_five_minutes'
      and schedule = '3-59/5 * * * *'
      and command like '%advance_complete_power_outage_cez_projection%'
      and active
  )
union all
select 'STATE', 'provider bridge remains disabled',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'SAFETY', 'provider bridge requires complete cycle',
  position('complete_cycle_id is null' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
union all
select 'ISOLATION', 'provider bridge targets only COMPLETE endpoint',
  position('/api/power-outages/complete/sync?source=cez' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
  and position('/api/power-outages/sync' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) = 0
union all
select 'GRANT', 'authenticated cannot advance CEZ projection',
  not has_function_privilege('authenticated',
    'public.advance_complete_power_outage_cez_projection()', 'EXECUTE')
order by check_type, object_name;
