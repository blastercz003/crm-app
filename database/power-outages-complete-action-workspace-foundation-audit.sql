with checks(check_type, object_name, is_correct) as (
  values
    ('TABLE', 'COMPLETE communication action workspace state exists',
      to_regclass('public.complete_power_outage_action_workspace_state') is not null),
    ('TABLE', 'COMPLETE communication work item links exist',
      to_regclass('public.complete_power_outage_work_item_links') is not null),
    ('FUNCTION', 'guarded COMPLETE communication action workspace exists',
      to_regprocedure('public.get_complete_power_outage_action_workspace_v1(uuid)') is not null),
    ('RLS', 'COMPLETE communication action workspace tables have RLS',
      (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_action_workspace_state'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_work_item_links'::regclass)),
    ('GRANT', 'authenticated cannot enumerate or mutate private action workspace tables',
      not has_table_privilege('authenticated', 'public.complete_power_outage_action_workspace_state', 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_work_item_links', 'SELECT,INSERT,UPDATE,DELETE')),
    ('GRANT', 'action workspace is exposed only through guarded function',
      has_function_privilege('authenticated', 'public.get_complete_power_outage_action_workspace_v1(uuid)', 'EXECUTE')),
    ('DATA', 'action workspace foundation starts without work item links',
      not exists (select 1 from public.complete_power_outage_work_item_links)),
    ('LOGIC', 'record ownership controls action availability',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%assignment_owner_id is null%'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%assignment_owner_id = current_user_id%'),
    ('LOGIC', 'client candidates respect existing client visibility',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%current_user_can_view_client%'),
    ('LOGIC', 'offers respect the existing offer permission',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%can_view_offers%'),
    ('LOGIC', 'Jobs creation remains administrator only',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike $$%'canCreateJob', can_edit_record and current_role = 'admin'%$$),
    ('LOGIC', 'ordinary job visibility remains limited to Portal sales scope',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%can_view_jobs_portal%'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike '%job.sales_owner = jobs_sales_scope%'),
    ('LOGIC', 'internal Jobs data require administrator and Jobs access',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike $$%current_role = 'admin' and can_view_jobs%$$),
    ('ISOLATION', 'communication action workspace stays in COMPLETE scope',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '%power_outage_matches%'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '%power_outage_client_email%'),
    ('SAFETY', 'stage one keeps the communication action UI disabled',
      exists (
        select 1
        from public.complete_power_outage_action_workspace_state
        where singleton and contract_version = 1 and not ui_enabled
      )),
    ('SAFETY', 'stage one enables no direct email action',
      exists (
        select 1
        from public.complete_power_outage_action_workspace_state
        where singleton and metadata ->> 'directEmailEnabled' = 'false'
      )
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        ilike $$%'directEmailEnabled', false%$$),
    ('SAFETY', 'stage one creates no communication action schedule',
      not exists (
        select 1 from cron.job
        where command ilike '%complete_power_outage_action_workspace%'
          or command ilike '%complete_power_outage_work_item_links%'
      )),
    ('SAFETY', 'action workspace projection performs no mutation or external request',
      pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '%http%'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '%net.%'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '% insert %'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '% update %'
      and pg_get_functiondef('public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure)
        not ilike '% delete %')
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
