select 'FUNCTION' as check_type,
  'claim_complete_power_outage_provider_quota' as object_name,
  to_regprocedure('public.claim_complete_power_outage_provider_quota(text,integer,integer)') is not null as is_correct
union all
select 'FUNCTION', 'request_complete_power_outage_company_discovery',
  to_regprocedure('public.request_complete_power_outage_company_discovery(text,integer)') is not null
union all
select 'POLICY', 'complete target lookups authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'complete_power_outage_target_lookups'
      and policyname = 'cpo_target_lookups_authorized_read'
  )
union all
select 'RLS', 'complete_power_outage_provider_quota',
  coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_provider_quota'::regclass), false)
union all
select 'RLS', 'complete_power_outage_target_lookups',
  coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_target_lookups'::regclass), false)
union all
select 'TABLE', 'complete_power_outage_provider_quota',
  to_regclass('public.complete_power_outage_provider_quota') is not null
union all
select 'TABLE', 'complete_power_outage_target_lookups',
  to_regclass('public.complete_power_outage_target_lookups') is not null
order by check_type, object_name;

select provider, minute_window_started_at, minute_request_count,
  day_window_started_at, day_request_count, last_request_at
from public.complete_power_outage_provider_quota
order by provider;

select provider, lookup_status, count(*) as lookup_count,
  sum(result_count) as result_count
from public.complete_power_outage_target_lookups
group by provider, lookup_status
order by provider, lookup_status;

select provider, lookup_status, count(*) as cache_count,
  sum(response_count) as response_count
from public.complete_power_outage_lookup_cache
where provider in ('ares', 'mapy', 'google')
group by provider, lookup_status
order by provider, lookup_status;
