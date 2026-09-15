with definition as (
  select lower(pg_get_functiondef(
    'public.get_complete_power_outage_company_page_v12(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
  )) as body
)
select check_type, object_name, is_correct
from (
  select 'FUNCTION'::text as check_type,
    'strictly sorted COMPLETE page version twelve exists'::text as object_name,
    to_regprocedure(
      'public.get_complete_power_outage_company_page_v12(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'
    ) is not null as is_correct

  union all
  select 'GRANT', 'authenticated can use safe page version twelve',
    has_function_privilege(
      'authenticated',
      'public.get_complete_power_outage_company_page_v12(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)',
      'EXECUTE'
    )

  union all
  select 'LOGIC', 'nearest outage ordering no longer prioritizes clients',
    body not ilike '%order by scope.is_client_priority desc%'
      and body not ilike '%order by visible.is_client_priority desc%'
  from definition

  union all
  select 'LOGIC', 'current records are ordered by outage start ascending',
    body ilike '%case when p_mode = ''current'' then scope.sort_at end asc%'
      and body ilike '%case when p_mode = ''current'' then visible.sort_at end asc%'
  from definition

  union all
  select 'LOGIC', 'archive records remain ordered newest first',
    body ilike '%case when p_mode = ''archive'' then scope.sort_at end desc%'
      and body ilike '%case when p_mode = ''archive'' then visible.sort_at end desc%'
  from definition

  union all
  select 'LOGIC', 'score ordering uses score before outage date',
    position('case when p_sort = ''score'' then scope.sort_score end desc' in body)
      < position('case when p_mode = ''current'' then scope.sort_at end asc' in body)
  from definition

  union all
  select 'LOGIC', 'date cursor follows the same chronological tuple',
    body ilike '%(scope.sort_at, scope.candidate_id) > (p_cursor_at, p_cursor_id)%'
      and body ilike '%(scope.sort_at, scope.candidate_id) < (p_cursor_at, p_cursor_id)%'
  from definition

  union all
  select 'LOGIC', 'pagination no longer branches by client priority',
    body not ilike '%scope.is_client_priority < p_cursor_client_priority%'
      and body not ilike '%scope.is_client_priority = p_cursor_client_priority%'
  from definition

  union all
  select 'LOGIC', 'all current AI SELECT filters remain delegated to shared scope',
    body ilike '%get_cpo_communication_filtered_scope_v1%'
  from definition

  union all
  select 'SAFETY', 'sorting correction is read only',
    not (body ilike any(array[
      '%insert into %', '%update public.%', '%delete from %',
      '%http%', '%net.%', '%email_planning%', '%dispatch_enabled%'
    ]))
  from definition

  union all
  select 'ISOLATION', 'sorting correction remains in COMPLETE scope',
    body not ilike '%market%'
  from definition
) checks
order by check_type, object_name;
