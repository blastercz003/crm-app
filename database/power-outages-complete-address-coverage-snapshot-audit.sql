select 'TABLE' as check_type, 'complete address coverage snapshot' as object_name,
  to_regclass('public.complete_power_outage_address_coverage_snapshot') is not null as is_correct
union all
select 'VIEW', 'complete address coverage reads snapshot',
  position('complete_power_outage_address_coverage_snapshot' in
    pg_get_viewdef('public.complete_power_outage_address_coverage'::regclass, true)) > 0
union all
select 'FUNCTION', 'refresh complete address coverage snapshot',
  to_regprocedure('public.refresh_complete_power_outage_address_coverage_snapshot()') is not null
union all
select 'DATA', 'snapshot contains CEZ EGD and PRE',
  (select count(*) = 3 from public.complete_power_outage_address_coverage_snapshot)
union all
select 'DATA', 'coverage counts are internally consistent',
  not exists (
    select 1 from public.complete_power_outage_address_coverage_snapshot
    where normalized_count + pending_count <> total_count
      or exact_count + broad_count + unresolved_count <> normalized_count
      or exact_target_count + street_target_count + municipality_target_count <> target_count
  )
union all
select 'SCOPE', 'coverage excludes archived outages',
  position('outage.ends_at >= now()' in
    pg_get_viewdef('public.complete_power_outage_address_coverage_live'::regclass, true)) > 0
  and position('scheduled' in
    pg_get_viewdef('public.complete_power_outage_address_coverage_live'::regclass, true)) > 0
union all
select 'LOGIC', 'ordinary pending addresses are not attention errors',
  position('normalization_version >= 2' in
    pg_get_viewdef('public.complete_power_outage_address_coverage_live'::regclass, true)) > 0
union all
select 'CRON', 'complete address coverage snapshot every minute',
  exists (select 1 from cron.job
    where jobname = 'complete_address_coverage_snapshot_every_minute' and active)
union all
select 'RLS', 'complete address coverage snapshot has RLS',
  (select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_address_coverage_snapshot'::regclass)
union all
select 'ISOLATION', 'coverage does not reference MARKET outage tables',
  position('market_power_outage' in lower(pg_get_viewdef(
    'public.complete_power_outage_address_coverage_live'::regclass, true))) = 0;

select
  source,
  total_count,
  normalized_count,
  exact_count,
  broad_count,
  unresolved_count,
  pending_count,
  error_count,
  review_count,
  attention_count,
  target_count,
  refreshed_at
from public.complete_power_outage_address_coverage
order by source;
