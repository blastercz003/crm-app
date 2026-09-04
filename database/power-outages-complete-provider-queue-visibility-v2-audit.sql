-- Audit záměrně nekontroluje text SQL definice. Ověřuje nasazené objekty,
-- jejich kontrakt, oprávnění a skutečný výstup bezpečným read-only voláním.
select 'FUNCTION' as check_type, 'complete provider queue exists' as object_name,
  to_regprocedure('public.get_complete_power_outage_discovery_targets(text,integer)') is not null as is_correct
union all
select 'VIEW', 'complete provider overview exists',
  to_regclass('public.complete_power_outage_provider_overview') is not null
union all
select 'COLUMN', 'provider retryable error count',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_provider_overview'
      and column_name = 'retryable_error_count'
  )
union all
select 'COLUMN', 'provider review error count',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_provider_overview'
      and column_name = 'review_error_count'
  )
union all
select 'GRANT', 'authenticated can read provider overview',
  has_table_privilege('authenticated', 'public.complete_power_outage_provider_overview', 'SELECT')
union all
select 'ISOLATION', 'authenticated cannot claim complete provider queue',
  not has_function_privilege(
    'authenticated',
    'public.get_complete_power_outage_discovery_targets(text,integer)',
    'EXECUTE'
  )
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

select
  target_kind,
  count(*) as selected_count
from public.get_complete_power_outage_discovery_targets('mapy', 7)
group by target_kind
order by target_kind;
