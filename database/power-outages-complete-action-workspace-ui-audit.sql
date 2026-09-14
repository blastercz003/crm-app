with checks as (
  select 'FUNCTION'::text as check_type,
    'guarded COMPLETE communication action workspace remains available'::text as object_name,
    to_regprocedure('public.get_complete_power_outage_action_workspace_v1(uuid)') is not null as is_correct
  union all
  select 'STATE',
    'communication action workspace UI shell is enabled',
    coalesce((select state.ui_enabled from public.complete_power_outage_action_workspace_state state where state.singleton), false)
  union all
  select 'LOGIC',
    'new client task meeting offer and job mutations remain disabled',
    coalesce((select state.metadata ->> 'newWorkItemMutationsEnabled' = 'false' from public.complete_power_outage_action_workspace_state state where state.singleton), false)
  union all
  select 'SAFETY',
    'stage two enables no direct email action',
    coalesce((select state.metadata ->> 'directEmailEnabled' = 'false' from public.complete_power_outage_action_workspace_state state where state.singleton), false)
  union all
  select 'SAFETY',
    'stage two enables no external request',
    coalesce((select state.metadata ->> 'externalRequestsEnabled' = 'false' from public.complete_power_outage_action_workspace_state state where state.singleton), false)
  union all
  select 'DATA',
    'UI installation creates no work item links',
    not exists (select 1 from public.complete_power_outage_work_item_links)
  union all
  select 'GRANT',
    'authenticated still cannot enumerate private work item links',
    not has_table_privilege('authenticated', 'public.complete_power_outage_work_item_links', 'SELECT')
  union all
  select 'ISOLATION',
    'stage two remains in COMPLETE scope',
    pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
      !~* '(market_power_outage|power_outage_store|store_power_outage)'
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
