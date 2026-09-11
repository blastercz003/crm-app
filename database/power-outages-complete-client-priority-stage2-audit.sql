-- Technický a bezpečnostní audit etapy 2. UI stále používá v6.
select 'CRON' as check_type,
       'client matching reconciliation every five minutes' as object_name,
       exists (
         select 1
         from cron.job
         where jobname = 'complete-power-outage-client-links'
           and active
           and schedule = '*/5 * * * *'
           and command = 'select public.reconcile_complete_power_outage_client_links();'
       ) as is_correct
union all
select 'DATA',
       'production links contain only existing candidates and clients',
       not exists (
         select 1
         from public.complete_power_outage_client_links link
         left join public.complete_power_outage_companies company
           on company.id = link.candidate_id
         left join public.clients client on client.id = link.client_id
         where company.id is null or client.id is null
       )
union all
select 'DATA',
       'approved stage one matches are represented in production links',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit audit
         where audit.automatic_match_recommended
           and not exists (
             select 1
             from public.complete_power_outage_client_links link
             where link.candidate_id = audit.candidate_id
               and link.client_id = audit.client_id
           )
       )
union all
select 'FUNCTION',
       'client link reconciliation exists',
       to_regprocedure(
         'public.reconcile_complete_power_outage_client_links()'
       ) is not null
union all
select 'FUNCTION',
       'client-prioritized keyset page version seven exists',
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
       ) is not null
union all
select 'GRANT',
       'authenticated cannot mutate or enumerate global client links',
       not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_links',
         'SELECT'
       )
       and not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_links',
         'INSERT'
       )
       and not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_links',
         'UPDATE'
       )
       and not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_links',
         'DELETE'
       )
       and not has_function_privilege(
         'authenticated',
         'public.reconcile_complete_power_outage_client_links()',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'client priority query uses per-user client visibility',
       position(
         'current_user_can_view_client' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) > 0
union all
select 'ISOLATION',
       'client priority remains in COMPLETE scope',
       position(
         'power_outage_store_' in lower(
           pg_get_functiondef(
             'public.reconcile_complete_power_outage_client_links()'::regprocedure
           )
         )
       ) = 0
       and position(
         'market' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) = 0
union all
select 'LOGIC',
       'client rows override every commercial selection only',
       position(
         'coalesce(client_match.is_client_priority, false)' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) > 0
       and position(
         'p_commercial_filter' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) > 0
union all
select 'LOGIC',
       'different nonempty ICO blocks name-only production links',
       not exists (
         select 1
         from public.complete_power_outage_client_links link
         join public.complete_power_outage_companies company
           on company.id = link.candidate_id
         join public.clients client on client.id = link.client_id
         where link.match_method <> 'ico_exact'
           and public.complete_power_outage_normalize_client_ico(company.ico) is not null
           and public.complete_power_outage_normalize_client_ico(client.ico) is not null
           and public.complete_power_outage_normalize_client_ico(company.ico)
             <> public.complete_power_outage_normalize_client_ico(client.ico)
       )
union all
select 'LOGIC',
       'fuzzy production links respect strict threshold',
       not exists (
         select 1
         from public.complete_power_outage_client_links link
         join public.complete_power_outage_client_priority_state state
           on state.singleton
         where link.match_method = 'name_fuzzy'
           and link.name_similarity < state.fuzzy_similarity_threshold
       )
union all
select 'LOGIC',
       'priority cursor is part of version seven contract',
       position(
         'p_cursor_client_priority' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) > 0
       and position(
         '''clientpriority''' in lower(
           pg_get_functiondef(
             'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
           )
         )
       ) > 0
union all
select 'SAFETY',
       'current application page version six remains available',
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'
       ) is not null
union all
select 'SAFETY',
       'matching does not mutate COMPLETE source records',
       position(
         'update public.complete_power_outage_companies' in lower(
           pg_get_functiondef(
             'public.reconcile_complete_power_outage_client_links()'::regprocedure
           )
         )
       ) = 0
       and position(
         'delete from public.complete_power_outage_companies' in lower(
           pg_get_functiondef(
             'public.reconcile_complete_power_outage_client_links()'::regprocedure
           )
         )
       ) = 0
union all
select 'STATE',
       'client matching active while UI remains disabled',
       exists (
         select 1
         from public.complete_power_outage_client_priority_state
         where singleton
           and matching_enabled
           and priority_query_enabled
           and not ui_enabled
           and rules_version = 1
           and fuzzy_similarity_threshold = 0.9200
           and metadata ->> 'contract' = 'complete-client-priority-v1'
       )
union all
select 'STATE',
       'client reconciliation last run succeeded',
       exists (
         select 1
         from public.complete_power_outage_client_priority_state
         where singleton
           and last_status = 'succeeded'
           and last_success_at is not null
           and last_error_code is null
       )
union all
select 'TABLE',
       'production COMPLETE client links exist',
       to_regclass('public.complete_power_outage_client_links') is not null
order by check_type, object_name;

-- Výsledek A: stav živého přepočtu a velikost vazeb.
select
  state.last_status,
  state.last_started_at,
  state.last_finished_at,
  state.last_success_at,
  state.last_processed_count,
  state.last_inserted_count,
  state.last_removed_count,
  state.last_error_code,
  state.last_error_message,
  count(link.candidate_id) as production_link_count,
  count(distinct link.candidate_id) as linked_candidate_count,
  count(distinct link.client_id) as linked_client_count
from public.complete_power_outage_client_priority_state state
left join public.complete_power_outage_client_links link on true
where state.singleton
group by state.singleton;

-- Výsledek B: rozdělení produkčních vazeb podle metody.
select
  match_method,
  count(*) as link_count,
  count(distinct candidate_id) as candidate_count,
  count(distinct client_id) as client_count,
  min(name_similarity) as minimum_name_similarity,
  max(name_similarity) as maximum_name_similarity
from public.complete_power_outage_client_links
group by match_method
order by match_method;

-- Výsledek C: potvrzení, že v7 nevrací identifikátor cizího klienta.
select
  position(
    '''client_id''' in lower(
      pg_get_functiondef(
        'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
      )
    )
  ) = 0 as page_payload_contains_no_client_id,
  position(
    '''client_name''' in lower(
      pg_get_functiondef(
        'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'::regprocedure
      )
    )
  ) = 0 as page_payload_contains_no_client_name;
