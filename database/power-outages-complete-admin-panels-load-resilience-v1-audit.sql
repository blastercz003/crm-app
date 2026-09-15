with live_counts as materialized (
  select target.selector_key, count(*)::bigint as company_count
  from public.complete_power_outage_contact_discovery_selector_targets target
  where target.selector_key <> 'multi_select_v1'
  group by target.selector_key
)
select check_type, object_name, is_correct
from (values
  ('TABLE', 'fast selector count cache exists',
    to_regclass('public.complete_power_outage_selector_count_cache_v1') is not null),
  ('DATA', 'every active visible selector has one cached count',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_selectors selector
      left join public.complete_power_outage_selector_count_cache_v1 cache
        on cache.selector_key = selector.selector_key
      where selector.lifecycle_status = 'active'
        and selector.selector_key <> 'multi_select_v1'
        and cache.selector_key is null
    )),
  ('DATA', 'cached selector counts are nonnegative',
    not exists (
      select 1 from public.complete_power_outage_selector_count_cache_v1
      where company_count < 0
    )),
  ('DATA', 'cached selector counts equal the current selector projection',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_selectors selector
      left join live_counts
        on live_counts.selector_key = selector.selector_key
      left join public.complete_power_outage_selector_count_cache_v1 cache
        on cache.selector_key = selector.selector_key
      where selector.lifecycle_status = 'active'
        and selector.selector_key <> 'multi_select_v1'
        and coalesce(cache.company_count, -1) <> coalesce(live_counts.company_count, 0)
    )),
  ('FUNCTION', 'lightweight selector options function exists',
    to_regprocedure('public.get_cpo_multi_selector_options_v1()') is not null),
  ('FUNCTION', 'selector count refresh function exists',
    to_regprocedure('public.refresh_complete_power_outage_selector_count_cache_v1()') is not null),
  ('LOGIC', 'selector options read the cached projection',
    pg_get_functiondef('public.get_cpo_multi_selector_options_v1()'::regprocedure)
      ilike '%complete_power_outage_selector_count_cache_v1%'),
  ('LOGIC', 'selector options do not scan dynamic selector targets',
    pg_get_functiondef('public.get_cpo_multi_selector_options_v1()'::regprocedure)
      not ilike '%complete_power_outage_contact_discovery_selector_targets%'),
  ('CRON', 'selector counts refresh every five minutes',
    (select count(*) = 1 from cron.job
      where jobname = 'complete-selector-count-cache-v1-refresh'
        and schedule = '*/5 * * * *')),
  ('RLS', 'private selector count cache has RLS',
    (select relrowsecurity from pg_class
      where oid = 'public.complete_power_outage_selector_count_cache_v1'::regclass)),
  ('GRANT', 'authenticated cannot inspect selector count cache',
    not has_table_privilege('authenticated',
      'public.complete_power_outage_selector_count_cache_v1', 'SELECT')),
  ('GRANT', 'authenticated cannot refresh selector count cache',
    not has_function_privilege('authenticated',
      'public.refresh_complete_power_outage_selector_count_cache_v1()', 'EXECUTE')),
  ('GRANT', 'authenticated can use guarded selector options',
    has_function_privilege('authenticated',
      'public.get_cpo_multi_selector_options_v1()', 'EXECUTE')),
  ('SAFETY', 'count refresh performs no external request or email action',
    not (pg_get_functiondef('public.refresh_complete_power_outage_selector_count_cache_v1()'::regprocedure)
      ilike any (array['%http%','%net.%','%email%','%dispatch%','%planning_enabled%']))),
  ('ISOLATION', 'selector cache remains in COMPLETE scope',
    pg_get_functiondef('public.refresh_complete_power_outage_selector_count_cache_v1()'::regprocedure)
      not ilike '%market%')
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
