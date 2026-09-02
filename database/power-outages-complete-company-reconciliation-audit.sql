select 'COLUMN' as check_type, 'company evaluation fields' as object_name,
  count(*) = 3 as is_correct
from information_schema.columns
where table_schema = 'public'
  and table_name = 'complete_power_outage_companies'
  and column_name in ('evaluation_version', 'evaluation_reasons', 'evaluated_at')
union all
select 'FUNCTION', 'merge complete company candidates',
  to_regprocedure('public.merge_complete_power_outage_company_candidates(uuid,uuid)') is not null
union all
select 'FUNCTION', 'request company reconciliation',
  to_regprocedure('public.request_complete_power_outage_company_reconciliation(integer)') is not null
union all
select 'INDEX', 'company evaluation queue',
  to_regclass('public.cpo_companies_evaluation_queue_idx') is not null;
