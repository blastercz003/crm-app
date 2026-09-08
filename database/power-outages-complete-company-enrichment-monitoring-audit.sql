select 'COLUMN' as check_type,
  'ARES RES worker runtime state' as object_name,
  (
    select count(*) = 8
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_commercial_selection_state'
      and column_name in (
        'enrichment_worker_status', 'enrichment_run_token', 'enrichment_run_expires_at',
        'enrichment_last_started_at', 'enrichment_last_finished_at',
        'enrichment_last_success_at', 'enrichment_last_processed_count',
        'enrichment_consecutive_failure_count'
      )
  ) as is_correct
union all
select 'DATA', 'ARES RES queue counts are internally consistent',
  exists (
    select 1
    from public.complete_power_outage_company_enrichment_overview
    where total_count = pending_count + processing_count + ready_count
      + not_found_count + retry_count + review_count
      and progress_percent between 0 and 100
  )
union all
select 'FUNCTION', 'ARES RES worker run lifecycle',
  to_regprocedure('public.begin_complete_power_outage_company_enrichment_run()') is not null
  and to_regprocedure('public.finish_complete_power_outage_company_enrichment_run(uuid,text,integer,text,text)') is not null
union all
select 'GRANT', 'authenticated cannot mutate ARES RES worker runtime',
  not has_function_privilege('authenticated', 'public.begin_complete_power_outage_company_enrichment_run()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_complete_power_outage_company_enrichment_run(uuid,text,integer,text,text)', 'EXECUTE')
union all
select 'ISOLATION', 'ARES RES monitoring stays in COMPLETE scope',
  position('public.power_outages' in pg_get_viewdef('public.complete_power_outage_company_enrichment_overview'::regclass, true)) = 0
  and position('public.stores' in pg_get_viewdef('public.complete_power_outage_company_enrichment_overview'::regclass, true)) = 0
union all
select 'LOGIC', 'ARES RES retry and review errors remain separate',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_company_enrichment_overview'
      and column_name = 'retry_count'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_company_enrichment_overview'
      and column_name = 'review_count'
  )
union all
select 'SAFETY', 'commercial scoring and AI selection remain disabled',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and not scoring_enabled and not ui_enabled
  )
union all
select 'STATE', 'ARES RES monitoring reports active enrichment',
  exists (
    select 1 from public.complete_power_outage_company_enrichment_overview
    where res_enrichment_enabled and status in ('waiting', 'processing', 'current', 'partial', 'error')
  )
union all
select 'VIEW', 'ARES RES enrichment operational overview',
  to_regclass('public.complete_power_outage_company_enrichment_overview') is not null
order by check_type, object_name;
