select 'FUNCTION' as check_type, 'Mapy batch reserves street targets' as object_name,
  pg_get_functiondef('public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure)
    like '%source_street_position%' as is_correct
union all
select 'FUNCTION', 'provider queue stays isolated from MARKET tables',
  pg_get_functiondef('public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure)
    not ilike '%power_outage_store%'
union all
select 'VIEW', 'provider overview includes targets without lookup',
  pg_get_viewdef('public.complete_power_outage_provider_overview'::regclass, true)
    like '%complete_power_outage_source_provider_overview%'
union all
select 'VIEW', 'provider errors split into retry and review',
  pg_get_viewdef('public.complete_power_outage_provider_overview'::regclass, true)
    like '%retryable_error_count%'
union all
select 'GRANT', 'authenticated can read provider overview',
  has_table_privilege('authenticated', 'public.complete_power_outage_provider_overview', 'SELECT')
order by check_type, object_name;

select
  provider,
  ready_count,
  pending_count,
  not_found_count,
  error_count,
  retryable_error_count,
  review_error_count,
  last_request_at
from public.complete_power_outage_provider_overview
order by provider;
