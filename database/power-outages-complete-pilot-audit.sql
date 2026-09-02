-- Spusťte po dokončení jednorázového pilotního běhu runtime pipeline.

with latest_pipeline_activity as (
  select max(last_finished_at) as finished_at
  from public.complete_power_outage_task_state
  where task_key in (
    'normalize_addresses',
    'discover_ares',
    'discover_mapy',
    'discover_google',
    'reconcile_companies'
  )
), duplicate_candidates as (
  select count(*) as duplicate_count
  from (
    select outage_address_id, candidate_key
    from public.complete_power_outage_companies
    group by outage_address_id, candidate_key
    having count(*) > 1
  ) duplicates
)
select 'PIPELINE' as check_type,
  'normalization completed a recent batch' as object_name,
  exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'normalize_addresses'
      and last_status in ('succeeded', 'skipped')
      and last_finished_at >= now() - interval '1 hour'
      and last_processed_count > 0
  ) as is_correct
union all
select 'PIPELINE', 'company reconciliation completed recently',
  exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'reconcile_companies'
      and last_status in ('succeeded', 'skipped')
      and last_finished_at >= now() - interval '1 hour'
  )
union all
select 'DATA', 'normalized addresses exist',
  exists (
    select 1 from public.complete_power_outage_addresses
    where normalization_version >= 2
  )
union all
select 'DATA', 'address targets exist',
  exists (select 1 from public.complete_power_outage_address_targets)
union all
select 'PROVIDER', 'ARES pilot completed or quota stopped it safely',
  exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'discover_ares'
      and last_status in ('succeeded', 'skipped')
      and last_finished_at >= now() - interval '1 hour'
  )
union all
select 'PROVIDER', 'Mapy.com pilot completed or quota stopped it safely',
  exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'discover_mapy'
      and last_status in ('succeeded', 'skipped')
      and last_finished_at >= now() - interval '1 hour'
  )
union all
select 'SAFETY', 'no expired task locks',
  not exists (
    select 1
    from public.complete_power_outage_task_state
    where lock_token is not null
      and lock_expires_at <= now()
  )
union all
select 'SAFETY', 'no failed pilot tasks',
  not exists (
    select 1
    from public.complete_power_outage_task_state, latest_pipeline_activity
    where task_key in (
      'normalize_addresses', 'discover_ares', 'discover_mapy',
      'reconcile_companies'
    )
      and last_status in ('failed', 'partial')
      and last_finished_at >= coalesce(
        latest_pipeline_activity.finished_at - interval '10 minutes',
        now() - interval '1 hour'
      )
  )
union all
select 'SAFETY', 'company deduplication constraint holds',
  duplicate_count = 0
from duplicate_candidates
order by check_type, object_name;

-- Podrobný provozní výpis pro interpretaci případných neúspěšných kontrol.
select
  task_key,
  last_status,
  last_started_at,
  last_finished_at,
  last_processed_count,
  consecutive_failure_count,
  last_error_code,
  last_error_message,
  cursor
from public.complete_power_outage_task_state
where task_key in (
  'normalize_addresses',
  'discover_ares',
  'discover_mapy',
  'discover_google',
  'reconcile_companies'
)
order by task_key;

select
  provider,
  lookup_status,
  count(*) as lookup_count,
  max(last_attempt_at) as last_attempt_at
from public.complete_power_outage_target_lookups
group by provider, lookup_status
order by provider, lookup_status;

select
  candidate_status,
  count(*) as company_count
from public.complete_power_outage_companies
group by candidate_status
order by candidate_status;
