select 'VIEW' as check_type, 'complete CEZ NEW status' as object_name,
  to_regclass('public.complete_power_outage_cez_new_status') is not null as is_correct
union all
select 'FUNCTION', 'reversible complete CEZ source switch',
  to_regprocedure('public.set_complete_power_outage_cez_source(text)') is not null
union all
select 'STATE', 'new CEZ source remains disabled',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'REALTIME', 'new CEZ progress publishes complete updates',
  (select count(*) = 6 from pg_trigger
   where tgname in (
     'cpo_cez_new_ruian_publish_app_change',
     'cpo_cez_new_mapping_publish_app_change',
     'cpo_cez_new_scan_runner_publish_app_change',
     'cpo_cez_new_scan_cycle_publish_app_change',
     'cpo_cez_new_projection_run_publish_app_change',
     'cpo_cez_new_projection_state_publish_app_change'
   ) and not tgisinternal)
union all
select 'SAFETY', 'activation requires two publishable cycles',
  position('publishable_cycle_count < 2' in pg_get_functiondef(
    'public.set_complete_power_outage_cez_source(text)'::regprocedure)) > 0
union all
select 'SAFETY', 'activation requires finished normalization',
  position('normalization_remaining > 0' in pg_get_functiondef(
    'public.set_complete_power_outage_cez_source(text)'::regprocedure)) > 0
union all
select 'ROLLBACK', 'legacy rollback remains available',
  position('safe_source not in (''legacy'', ''shadow'')' in pg_get_functiondef(
    'public.set_complete_power_outage_cez_source(text)'::regprocedure)) > 0
union all
select 'GRANT', 'authenticated cannot switch CEZ source',
  not has_function_privilege('authenticated',
    'public.set_complete_power_outage_cez_source(text)', 'EXECUTE')
order by check_type, object_name;
