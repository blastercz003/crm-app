select 'FUNCTION' as check_type,
       'TOP page preserves job link badge data' as object_name,
       position('get_complete_power_outage_company_page_v5' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
       and position('complete_power_outage_job_links' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
       and position('has_linked_job' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0 as is_correct
union all
select 'GRANT',
       'authenticated can read enriched TOP pages only',
       has_function_privilege(
         'authenticated',
         'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'job badge enrichment stays in COMPLETE scope',
       position('power_outage_matches' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
       and position('power_outage_stores' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
union all
select 'LOGIC',
       'job badge is available in every AI SELECT filter',
       position('p_commercial_filter' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
       and position('has_linked_job' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
union all
select 'SAFETY',
       'job badge payload exposes no job identifiers',
       position('linked_job_id' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
       and position('linked_job_number' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
union all
select 'SAFETY',
       'job badge enrichment does not mutate records',
       position('insert into' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
       and position('update public' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
       and position('delete from' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
order by check_type, object_name;
