select 'FUNCTION' as check_type,
  'inactive ARES RES enrichment claim' as object_name,
  to_regprocedure('public.claim_complete_power_outage_company_enrichment(integer)') is not null as is_correct
union all
select 'FUNCTION', 'ARES RES enrichment claim release',
  to_regprocedure('public.release_complete_power_outage_company_enrichment_claim(text,uuid,integer)') is not null
union all
select 'FUNCTION', 'ARES RES enrichment completion',
  to_regprocedure('public.finish_complete_power_outage_company_enrichment(text,uuid,text,uuid,text,text,boolean)') is not null
union all
select 'GRANT', 'authenticated cannot run ARES RES enrichment worker',
  not has_function_privilege('authenticated', 'public.claim_complete_power_outage_company_enrichment(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.release_complete_power_outage_company_enrichment_claim(text,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_complete_power_outage_company_enrichment(text,uuid,text,uuid,text,text,boolean)', 'EXECUTE')
union all
select 'ISOLATION', 'ARES RES enrichment functions stay in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef('public.claim_complete_power_outage_company_enrichment(integer)'::regprocedure)) = 0
  and position('public.stores' in pg_get_functiondef('public.claim_complete_power_outage_company_enrichment(integer)'::regprocedure)) = 0
union all
select 'LOGIC', 'enrichment queue accepts public RES only',
  pg_get_constraintdef((
    select oid from pg_constraint where conname = 'cpo_company_enrichment_sources_check'
  )) like '%requested_sources = ARRAY[''res''%'
union all
select 'SAFETY', 'ARES RES enrichment remains disabled',
  exists (select 1 from public.complete_power_outage_commercial_selection_state where singleton and not res_enrichment_enabled)
union all
select 'SAFETY', 'disabled worker cannot claim a queue item',
  not exists (select 1 from public.claim_complete_power_outage_company_enrichment(1))
union all
select 'SAFETY', 'no ARES RES enrichment cron exists',
  not exists (
    select 1 from cron.job
    where active and (jobname ilike '%enrichment%' or command ilike '%company_enrichment%')
  )
union all
select 'SAFETY', 'step created no profiles contacts or queue items',
  (select count(*) from public.complete_power_outage_company_profiles) = 0
  and (select count(*) from public.complete_power_outage_company_contacts) = 0
  and (select count(*) from public.complete_power_outage_company_enrichment_queue) = 0
union all
select 'VIEW', 'ARES RES enrichment diagnostic overview',
  to_regclass('public.complete_power_outage_company_enrichment_overview') is not null
order by check_type, object_name;
