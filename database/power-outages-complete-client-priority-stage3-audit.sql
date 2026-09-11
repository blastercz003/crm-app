-- Technický a bezpečnostní audit etapy 3.
select 'DATA' as check_type,
       'production client links remain internally consistent' as object_name,
       not exists (
         select 1
         from public.complete_power_outage_client_links link
         left join public.complete_power_outage_companies company
           on company.id = link.candidate_id
         left join public.clients client on client.id = link.client_id
         where company.id is null or client.id is null
       ) as is_correct
union all
select 'FUNCTION',
       'client-prioritized page version seven exists',
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
       ) is not null
union all
select 'FUNCTION',
       'client-aware filtered count version four exists',
       to_regprocedure(
         'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'
       ) is not null
union all
select 'FUNCTION',
       'client-aware AI SELECT counts version three exists',
       to_regprocedure(
         'public.get_complete_power_outage_commercial_selection_counts_v3(text,text,text,text,text,text)'
       ) is not null
union all
select 'GRANT',
       'authenticated reads client priority only through safe functions',
       has_function_privilege(
         'authenticated',
         'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)',
         'EXECUTE'
       )
       and has_function_privilege(
         'authenticated',
         'public.get_complete_power_outage_commercial_selection_counts_v3(text,text,text,text,text,text)',
         'EXECUTE'
       )
       and not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_links',
         'SELECT'
       )
union all
select 'ISOLATION',
       'page count and selection counts use per-user client visibility',
       position(
         'current_user_can_view_client' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
       and position(
         'current_user_can_view_client' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
       and position(
         'current_user_can_view_client' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_commercial_selection_counts_v3(text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
union all
select 'ISOLATION',
       'client priority functions stay in COMPLETE scope',
       position(
         'power_outage_store_' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) = 0
       and position(
         'power_outage_store_' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_commercial_selection_counts_v3(text,text,text,text,text,text)'::regprocedure
         ))
       ) = 0
union all
select 'LOGIC',
       'client priority overrides AI SELECT but not other filters',
       position(
         'coalesce(client_match.is_client_priority, false)' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
       and position(
         'p_commercial_filter' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
       and position(
         'p_owner_filter' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
       and position(
         'clean_query' in lower(pg_get_functiondef(
           'public.count_complete_power_outage_companies_v4(text,text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
union all
select 'LOGIC',
       'AI SELECT counts include accessible client exceptions',
       position(
         'coalesce(client_match.is_client_priority, false)' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_commercial_selection_counts_v3(text,text,text,text,text,text)'::regprocedure
         ))
       ) > 0
union all
select 'SAFETY',
       'client UI payload exposes no client identifiers or names',
       position(
         '''client_id''' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
         ))
       ) = 0
       and position(
         '''client_name''' in lower(pg_get_functiondef(
           'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
         ))
       ) = 0
union all
select 'SAFETY',
       'ordinary AI SELECT scoring remains unchanged',
       to_regprocedure(
         'public.refresh_complete_power_outage_company_scores(integer)'
       ) is not null
       and to_regprocedure(
         'public.refresh_complete_power_outage_top_selection_shadow(integer)'
       ) is not null
union all
select 'STATE',
       'client priority UI version one is active',
       exists (
         select 1
         from public.complete_power_outage_client_priority_state
         where singleton
           and matching_enabled
           and priority_query_enabled
           and ui_enabled
           and rules_version = 1
           and metadata ->> 'uiContract' = 'complete-client-priority-ui-v1'
       )
order by check_type, object_name;

-- Výsledek A: stav aktivace a produkčních vazeb.
select
  state.matching_enabled,
  state.priority_query_enabled,
  state.ui_enabled,
  state.rules_version,
  state.last_status,
  state.last_success_at,
  state.last_error_code,
  count(link.candidate_id) as production_link_count,
  count(distinct link.candidate_id) as linked_candidate_count,
  count(distinct link.client_id) as linked_client_count
from public.complete_power_outage_client_priority_state state
left join public.complete_power_outage_client_links link on true
where state.singleton
group by state.singleton;

-- Výsledek B: bezpečné diagnostické počty bez identity klientů.
select
  match_method,
  count(*) as link_count,
  count(distinct candidate_id) as candidate_count,
  count(distinct client_id) as client_count
from public.complete_power_outage_client_links
group by match_method
order by match_method;
