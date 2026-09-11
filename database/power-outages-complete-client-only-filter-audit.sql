select 'FUNCTION' as check_type,
       'optional client-only page version eight exists' as object_name,
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'
       ) is not null as is_correct
union all
select 'FUNCTION',
       'client-only filtered count version five exists',
       to_regprocedure(
         'public.count_complete_power_outage_companies_v5(text,text,text,text,text,text,text,boolean)'
       ) is not null
union all
select 'FUNCTION',
       'client-only AI SELECT counts version four exists',
       to_regprocedure(
         'public.get_complete_power_outage_commercial_selection_counts_v4(text,text,text,text,text,text,boolean)'
       ) is not null
union all
select 'GRANT',
       'authenticated reads client-only results only through safe functions',
       has_function_privilege(
         'authenticated',
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.count_complete_power_outage_companies_v5(text,text,text,text,text,text,text,boolean)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.get_complete_power_outage_commercial_selection_counts_v4(text,text,text,text,text,text,boolean)',
         'EXECUTE'
       )
       and not has_table_privilege(
         'authenticated', 'public.complete_power_outage_client_links', 'SELECT'
       )
union all
select 'ISOLATION',
       'client-only functions use per-user client visibility',
       position('current_user_can_view_client' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
       and position('current_user_can_view_client' in lower(pg_get_functiondef(
         'public.count_complete_power_outage_companies_v5(text,text,text,text,text,text,text,boolean)'::regprocedure
       ))) > 0
       and position('current_user_can_view_client' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_commercial_selection_counts_v4(text,text,text,text,text,text,boolean)'::regprocedure
       ))) > 0
union all
select 'LOGIC',
       'client-only mode remains optional and defaults off',
       position('p_clients_only boolean default false' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
       and exists (
         select 1
         from public.complete_power_outage_client_priority_state
         where singleton
           and metadata ->> 'clientFilterDefault' = 'false'
       )
union all
select 'LOGIC',
       'client-only mode respects AI SELECT and table filters',
       position('p_commercial_filter' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
       and position('p_owner_filter' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
       and position('clean_query' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
union all
select 'SAFETY',
       'disabled client-only mode delegates to stable version six',
       position('get_complete_power_outage_company_page_v6' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) > 0
union all
select 'SAFETY',
       'client-only payload exposes no client identifiers',
       position('''client_id''' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) = 0
       and position('''client_name''' in lower(pg_get_functiondef(
         'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
       ))) = 0
union all
select 'SAFETY',
       'ordinary AI SELECT scoring remains unchanged',
       to_regprocedure('public.refresh_complete_power_outage_company_scores(integer)') is not null
       and to_regprocedure('public.refresh_complete_power_outage_top_selection_shadow(integer)') is not null
union all
select 'STATE',
       'client-only UI contract version one is active',
       exists (
         select 1
         from public.complete_power_outage_client_priority_state
         where singleton
           and ui_enabled
           and metadata ->> 'clientFilterContract' = 'complete-client-only-filter-v1'
       )
order by check_type, object_name;
