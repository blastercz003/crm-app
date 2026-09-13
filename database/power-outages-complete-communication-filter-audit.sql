with checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'communication filtered page count and selection counts exist',
    to_regprocedure('public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean)') is not null
    and to_regprocedure('public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)') is not null),
  ('GRANT', 'authenticated cannot query private communication filter scope',
    not has_function_privilege('authenticated', 'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)', 'EXECUTE')),
  ('GRANT', 'authenticated uses communication filters only through safe functions',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)', 'EXECUTE')),
  ('LOGIC', 'all seven communication states are supported by filter',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%closed_no_job%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%job_won%'),
  ('LOGIC', 'missing workflow state is treated as not contacted',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%coalesce(communication.communication_status, ''not_contacted'')%'),
  ('LOGIC', 'page and count share one communication filter scope',
    pg_get_functiondef('public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure) ilike '%get_cpo_communication_filtered_scope_v1%'
    and pg_get_functiondef('public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean)'::regprocedure) ilike '%get_cpo_communication_filtered_scope_v1%'),
  ('LOGIC', 'communication filter preserves client priority and commercial selection',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%is_client%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%p_commercial_filter%'),
  ('ISOLATION', 'communication filter stays in COMPLETE scope',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) not ilike '%power_outage_client_email%'),
  ('SAFETY', 'communication filtering is read only',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) not ilike '%insert into%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) not ilike '%update public%')
)
select check_type, object_name, is_correct from checks order by check_type, object_name;
