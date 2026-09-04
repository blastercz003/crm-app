select 'FUNCTION' as check_type, 'fast complete outage page' as object_name,
  to_regprocedure('public.get_complete_power_outage_company_page_v2(text,integer,timestamptz,uuid,text,text,text,text,text)') is not null as is_correct
union all
select 'FUNCTION', 'separate complete outage count',
  to_regprocedure('public.count_complete_power_outage_companies(text,text,text,text,text,text)') is not null
union all
select 'FUNCTION', 'page does not calculate total count',
  position('count(*) from filtered' in pg_get_functiondef('public.get_complete_power_outage_company_page_v2(text,integer,timestamptz,uuid,text,text,text,text,text)'::regprocedure)) = 0
union all
select 'INDEX', 'current complete outage sorting',
  to_regclass('public.cpo_outages_current_sort_idx') is not null
union all
select 'INDEX', 'visible complete company paging',
  to_regclass('public.cpo_companies_visible_page_idx') is not null
union all
select 'GRANT', 'authenticated can read page and count',
  has_function_privilege('authenticated', 'public.get_complete_power_outage_company_page_v2(text,integer,timestamptz,uuid,text,text,text,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.count_complete_power_outage_companies(text,text,text,text,text,text)', 'EXECUTE')
union all
select 'ISOLATION', 'progressive loading does not reference MARKET tables',
  position('public.power_outages' in pg_get_functiondef('public.get_complete_power_outage_company_page_v2(text,integer,timestamptz,uuid,text,text,text,text,text)'::regprocedure)) = 0
  and position('public.power_outage_matches' in pg_get_functiondef('public.count_complete_power_outage_companies(text,text,text,text,text,text)'::regprocedure)) = 0
order by check_type, object_name;
