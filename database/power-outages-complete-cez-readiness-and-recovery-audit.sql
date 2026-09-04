select 'VIEW' as check_type, 'strict complete CEZ readiness' as object_name,
  to_regclass('public.complete_power_outage_cez_new_status_v2') is not null as is_correct
union all
select 'FUNCTION', 'targeted complete CEZ recovery',
  to_regprocedure('public.recover_complete_power_outage_cez_new_stage(text)') is not null
union all
select 'FUNCTION', 'activation uses strict readiness',
  position('complete_power_outage_cez_new_status_v2' in pg_get_functiondef(
    'public.set_complete_power_outage_cez_source(text)'::regprocedure)) > 0
union all
select 'SNAPSHOT', 'no-change cycle can be projected',
  position('''no_change''' in pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure)) > 0
union all
select 'SAFETY', 'new CEZ source remains disabled',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'SAFETY', 'latest two cycles gate is available',
  coalesce((select recent_cycle_count <= 2
    from public.complete_power_outage_cez_new_status_v2), false)
union all
select 'ISOLATION', 'recovery does not reference MARKET tables',
  position('public.power_outages' in pg_get_functiondef(
    'public.recover_complete_power_outage_cez_new_stage(text)'::regprocedure)) = 0
  and position('public.power_outage_source' in pg_get_functiondef(
    'public.recover_complete_power_outage_cez_new_stage(text)'::regprocedure)) = 0
union all
select 'GRANT', 'authenticated cannot recover new CEZ',
  not has_function_privilege('authenticated',
    'public.recover_complete_power_outage_cez_new_stage(text)', 'EXECUTE')
order by check_type, object_name;
