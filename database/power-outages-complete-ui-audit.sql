select 'VIEW' as check_type, 'complete company overview' as object_name,
  to_regclass('public.complete_power_outage_company_overview') is not null as is_correct
union all
select 'SECURITY', 'complete company overview uses invoker rights',
  coalesce((select reloptions @> array['security_invoker=true']
    from pg_class where oid = 'public.complete_power_outage_company_overview'::regclass), false)
union all
select 'GRANT', 'authenticated can read complete company overview',
  has_table_privilege('authenticated', 'public.complete_power_outage_company_overview', 'SELECT')
union all
select 'VIEW', 'complete provider overview',
  to_regclass('public.complete_power_outage_provider_overview') is not null
union all
select 'SECURITY', 'complete provider overview uses invoker rights',
  coalesce((select reloptions @> array['security_invoker=true']
    from pg_class where oid = 'public.complete_power_outage_provider_overview'::regclass), false)
union all
select 'GRANT', 'authenticated can read complete provider overview',
  has_table_privilege('authenticated', 'public.complete_power_outage_provider_overview', 'SELECT');
