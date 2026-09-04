select 'VIEW' as check_type,
  'complete CEZ retry-aware status' as object_name,
  to_regclass('public.complete_power_outage_cez_new_status_v3') is not null as is_correct
union all
select 'FUNCTION', 'targeted CEZ scan recovery',
  to_regprocedure('public.recover_complete_power_outage_cez_scan_errors()') is not null
union all
select 'FUNCTION', 'failed CEZ municipalities have priority',
  position('case when municipality.scan_status = ''error'' then 0 else 1 end' in
    pg_get_functiondef('public.claim_complete_power_outage_cez_scan_batch(integer,boolean)'::regprocedure)) > 0
union all
select 'ISOLATION', 'retry migration does not reference MARKET tables',
  position('power_outage_store' in lower(
    pg_get_functiondef('public.recover_complete_power_outage_cez_scan_errors()'::regprocedure))) = 0
union all
select 'SAFETY', 'recovery preserves running immutable cycle',
  position('cycle_running' in
    pg_get_functiondef('public.recover_complete_power_outage_cez_scan_errors()'::regprocedure)) > 0
union all
select 'STATE', 'new CEZ source remains shadow',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
order by check_type, object_name;
