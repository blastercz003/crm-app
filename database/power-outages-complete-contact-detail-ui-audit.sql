with function_contract as (
  select
    pg_get_functiondef(
      'public.get_complete_power_outage_contact_detail_v1(uuid)'::regprocedure
    ) as definition,
    pg_get_function_result(
      'public.get_complete_power_outage_contact_detail_v1(uuid)'::regprocedure
    ) as result_contract
), checks as (
  select 'FUNCTION'::text as check_type,
    'safe contact detail query version one exists'::text as object_name,
    to_regprocedure(
      'public.get_complete_power_outage_contact_detail_v1(uuid)'
    ) is not null as is_correct

  union all
  select 'GRANT', 'authenticated reads contacts only through safe detail function',
    has_function_privilege(
      'authenticated',
      'public.get_complete_power_outage_contact_detail_v1(uuid)',
      'EXECUTE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_classification_v2_shadow',
      'SELECT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_extraction_shadow_results',
      'SELECT'
    )

  union all
  select 'ISOLATION', 'contact detail stays in COMPLETE scope',
    function_contract.definition not ilike '%market_power_outage%'
  from function_contract

  union all
  select 'ISOLATION', 'contact detail is restricted to one requested candidate',
    function_contract.definition ilike '%candidate.id = requested_candidate_id%'
  from function_contract

  union all
  select 'LOGIC', 'contact detail requires a confirmed company match',
    function_contract.definition ilike '%candidate.candidate_status = ''confirmed''%'
  from function_contract

  union all
  select 'LOGIC', 'contact detail uses classification version two results',
    function_contract.definition ilike
      '%complete_power_outage_contact_classification_v2_shadow%'
  from function_contract

  union all
  select 'SAFETY', 'contact detail payload exposes no internal record identifiers',
    function_contract.result_contract not ilike '%company_profile_id%'
      and function_contract.result_contract not ilike '%shadow_contact_id%'
  from function_contract

  union all
  select 'SAFETY', 'contact detail does not activate email planning or dispatch',
    not email_planning_enabled and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'read only contact detail UI version one is active',
    ui_enabled
      and coalesce((metadata ->> 'contactDetailUiEnabled')::boolean, false)
      and metadata ->> 'contactDetailUiVersion' = '1'
      and not coalesce((metadata ->> 'contactManagementUiEnabled')::boolean, true)
      and not coalesce((metadata ->> 'contactReviewDecisionUiEnabled')::boolean, true)
  from public.complete_power_outage_contact_discovery_state
  where singleton
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
