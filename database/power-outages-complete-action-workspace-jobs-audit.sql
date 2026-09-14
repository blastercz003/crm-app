with function_definitions as (
  select
    pg_get_functiondef(
      'public.get_complete_power_outage_action_workspace_v2(uuid)'::regprocedure
    ) as workspace_definition,
    pg_get_functiondef(
      'public.link_complete_power_outage_work_item_v2(uuid,text,uuid)'::regprocedure
    ) as linking_definition,
    pg_get_functiondef(
      'public.get_complete_power_outage_action_workspace_v1(uuid)'::regprocedure
    ) as foundation_definition
), checks(check_type, object_name, is_correct) as (
  values
    ('TABLE', 'COMPLETE work item links support real Jobs records',
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'complete_power_outage_work_item_links'
          and column_name = 'job_id'
          and udt_name = 'uuid'
      )
      and exists (
        select 1
        from pg_constraint constraint_row
        where constraint_row.conrelid = 'public.complete_power_outage_work_item_links'::regclass
          and constraint_row.contype = 'f'
          and constraint_row.confrelid = 'public.jobs'::regclass
      )),
    ('FUNCTION', 'permission scoped COMPLETE Jobs workspace exists',
      to_regprocedure('public.get_complete_power_outage_action_workspace_v2(uuid)') is not null),
    ('FUNCTION', 'transactional COMPLETE Job linking exists',
      to_regprocedure('public.link_complete_power_outage_work_item_v2(uuid,text,uuid)') is not null),
    ('GRANT', 'anonymous cannot inspect or link COMPLETE Jobs',
      not has_function_privilege('anon',
        'public.get_complete_power_outage_action_workspace_v2(uuid)', 'EXECUTE')
      and not has_function_privilege('anon',
        'public.link_complete_power_outage_work_item_v2(uuid,text,uuid)', 'EXECUTE')),
    ('GRANT', 'authenticated uses COMPLETE Jobs only through guarded functions',
      has_function_privilege('authenticated',
        'public.get_complete_power_outage_action_workspace_v2(uuid)', 'EXECUTE')
      and has_function_privilege('authenticated',
        'public.link_complete_power_outage_work_item_v2(uuid,text,uuid)', 'EXECUTE')
      and not has_table_privilege('authenticated',
        'public.complete_power_outage_work_item_links', 'SELECT,INSERT,UPDATE,DELETE')),
    ('LOGIC', 'Jobs creation is available only to administrators',
      (select linking_definition ilike $$%not public.current_user_is_admin()%$$
        from function_definitions)
      and (select workspace_definition ilike $$%'{capabilities,canCreateJob}'%$$
        and workspace_definition ilike $$%is_admin boolean := public.current_user_is_admin()%$$
        and workspace_definition ilike $$%to_jsonb(is_admin)%$$
        from function_definitions)),
    ('LOGIC', 'unassigned record is claimed only during final Job linking',
      (select linking_definition ilike '%insert into public.complete_power_outage_company_assignments%'
        and linking_definition ilike '%on conflict%do nothing%'
        from function_definitions)),
    ('LOGIC', 'administrator can link a Job without replacing current owner',
      (select linking_definition ilike '%for update%'
        and linking_definition not ilike '%assignment_owner_id <> current_user_id%'
        and linking_definition not ilike '%update public.complete_power_outage_company_assignments%'
        from function_definitions)),
    ('LOGIC', 'Job must belong to the client linked with the outage',
      (select linking_definition ilike '%job_client_id%'
        and linking_definition ilike '%linked_client_id%'
        and linking_definition ilike '%Zakazka nepatri propojenemu klientovi%'
        from function_definitions)),
    ('LOGIC', 'ordinary users receive no internal Jobs data',
      (select workspace_definition ilike $$%is_admin and can_view_jobs%$$
        from function_definitions)),
    ('LOGIC', 'Portal Jobs are visible only inside the users sales scope',
      (select workspace_definition ilike '%can_view_jobs_portal%'
        and workspace_definition ilike '%jobs_sales_scope is not null%'
        and workspace_definition ilike '%job.sales_owner = jobs_sales_scope%'
        from function_definitions)),
    ('LOGIC', 'user without Jobs or Portal scope receives no Job records',
      (select workspace_definition ilike '%where (is_admin and can_view_jobs)%'
        and workspace_definition ilike '%or (can_view_jobs_portal and jobs_sales_scope is not null%'
        from function_definitions)),
    ('LOGIC', 'actual Job creation stays independent from communication outcome',
      (select linking_definition not ilike '%complete_power_outage_communication_states%'
        and linking_definition not ilike '%job_won%'
        from function_definitions)
      and coalesce((
        select (state.metadata ->> 'communicationStatusIndependent')::boolean
        from public.complete_power_outage_action_workspace_state state
        where state.singleton
      ), false)),
    ('LOGIC', 'unified timeline accepts a brief Job creation event',
      (select pg_get_constraintdef(constraint_row.oid)
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.complete_power_outage_communication_events'::regclass
         and constraint_row.conname = 'cpo_communication_events_kind_check')
        ilike '%job_created%'
      and (select linking_definition ilike '%job_created%'
        from function_definitions)),
    ('LOGIC', 'Job timeline event exposes no Job number or record identifier',
      (select linking_definition ilike $$%'itemKind', 'job'%$$
        and linking_definition not ilike $$%'jobNumber'%$$
        and linking_definition not ilike $$%'itemId'%$$
        from function_definitions)),
    ('DATA', 'COMPLETE Job links contain no duplicate candidate targets',
      not exists (
        select 1
        from public.complete_power_outage_work_item_links link
        where link.item_kind = 'job'
        group by link.candidate_id, link.job_id
        having count(*) > 1
      )),
    ('DATA', 'COMPLETE Job links contain no orphaned records',
      not exists (
        select 1
        from public.complete_power_outage_work_item_links link
        left join public.jobs job on job.id = link.job_id
        where link.item_kind = 'job'
          and job.id is null
      )),
    ('ISOLATION', 'Jobs action workspace stays in COMPLETE scope',
      (select workspace_definition not ilike '%market_power_outage%'
        and linking_definition not ilike '%market_power_outage%'
        from function_definitions)),
    ('SAFETY', 'Jobs integration performs no direct email action',
      not coalesce((
        select (state.metadata ->> 'directEmailEnabled')::boolean
        from public.complete_power_outage_action_workspace_state state
        where state.singleton
      ), true)),
    ('SAFETY', 'Jobs integration makes no external request',
      (select workspace_definition not ilike '%http%'
        and workspace_definition not ilike '%net.%'
        and linking_definition not ilike '%http%'
        and linking_definition not ilike '%net.%'
        from function_definitions)
      and not coalesce((
        select (state.metadata ->> 'externalRequestsEnabled')::boolean
        from public.complete_power_outage_action_workspace_state state
        where state.singleton
      ), true)),
    ('SAFETY', 'database linking never creates or changes a Job',
      (select linking_definition not ilike '%insert into public.jobs%'
        and linking_definition not ilike '%update public.jobs%'
        and linking_definition not ilike '%delete from public.jobs%'
        from function_definitions)),
    ('STATE', 'communication action workspace version three is active',
      coalesce((
        select state.ui_enabled
          and state.contract_version >= 3
          and (state.metadata ->> 'jobsCreationEnabled')::boolean
        from public.complete_power_outage_action_workspace_state state
        where state.singleton
      ), false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
