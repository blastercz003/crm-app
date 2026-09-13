with checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'shared communication filter scope exists',
      to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)') is not null),
    ('LOGIC', 'standard AI SELECT no longer contains a client membership override',
      position(
        'or not coalesce(p_clients_only, false)' in lower(pg_get_functiondef(
          'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
        ))
      ) > 0
      and position(
        'coalesce(client_match.is_client, false) or p_commercial_filter' in lower(pg_get_functiondef(
          'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
        ))
      ) = 0),
    ('LOGIC', 'client only mode is an independent accessible client scope',
      position(
        'coalesce(p_clients_only, false)' in lower(pg_get_functiondef(
          'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
        ))
      ) > 0
      and position(
        'and coalesce(client_match.is_client, false)' in lower(pg_get_functiondef(
          'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
        ))
      ) > 0),
    ('LOGIC', 'AI SELECT counts contain no client exception',
      position(
        'scope.is_client_priority' in lower(pg_get_functiondef(
          'public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)'::regprocedure
        ))
      ) = 0),
    ('LOGIC', 'large companies still require the ARES backed eligibility function',
      position(
        'complete_power_outage_is_large_company_v1(company.ico)' in lower(pg_get_functiondef(
          'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
        ))
      ) > 0),
    ('DATA', 'missing ICO can never qualify as a large company',
      public.complete_power_outage_is_large_company_v1(null) = false),
    ('DATA', 'no current large company candidate has a missing ICO',
      not exists (
        select 1
        from public.complete_power_outage_companies company
        where company.candidate_status = 'confirmed'
          and public.complete_power_outage_is_large_company_v1(company.ico)
          and (company.ico is null or company.ico !~ '^[0-9]{8}$')
      )),
    ('GRANT', 'authenticated cannot execute private filter scope directly',
      not has_function_privilege(
        'authenticated',
        'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)',
        'EXECUTE'
      )),
    ('SAFETY', 'filter correction performs no external request or write',
      lower(pg_get_functiondef(
        'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
      )) not like '%http%'
      and lower(pg_get_functiondef(
        'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
      )) not like '%insert %'
      and lower(pg_get_functiondef(
        'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure
      )) not like '%update %')
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
