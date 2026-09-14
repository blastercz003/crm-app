with checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'transactional COMPLETE work item linking exists',
      to_regprocedure('public.link_complete_power_outage_work_item_v1(uuid,text,uuid)') is not null),
    ('GRANT', 'anonymous cannot invoke COMPLETE work item linking',
      not has_function_privilege('anon',
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)', 'EXECUTE')),
    ('GRANT', 'authenticated invokes work item linking through its guarded contract',
      has_function_privilege('authenticated',
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)', 'EXECUTE')),
    ('GRANT', 'work item linking remains available only through guarded function',
      not has_table_privilege('authenticated', 'public.complete_power_outage_work_item_links', 'INSERT,UPDATE,DELETE')),
    ('LOGIC', 'client task meeting and offer actions are enabled',
      coalesce((select (metadata ->> 'newWorkItemMutationsEnabled')::boolean
        from public.complete_power_outage_action_workspace_state where singleton), false)),
    ('LOGIC', 'work item actions claim only while creating the final link',
      position('complete_power_outage_company_assignments' in pg_get_functiondef(
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)'::regprocedure)) > 0
      and position('complete_power_outage_work_item_links' in pg_get_functiondef(
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)'::regprocedure)) > 0),
    ('LOGIC', 'work item links append unified timeline evidence',
      position('complete_power_outage_communication_events' in pg_get_functiondef(
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)'::regprocedure)) > 0),
    ('LOGIC', 'unified timeline accepts all regular work item events',
      (select pg_get_constraintdef(oid)
       from pg_constraint
       where conrelid = 'public.complete_power_outage_communication_events'::regclass
         and conname = 'cpo_communication_events_kind_check')
        like all (array['%client_linked%', '%task_created%', '%meeting_created%', '%offer_created%'])),
    ('DATA', 'work item links contain no duplicate candidate targets',
      not exists (
        select 1
        from public.complete_power_outage_work_item_links link
        group by link.candidate_id, link.item_kind,
          coalesce(link.client_id, link.task_id, link.meeting_id, link.offer_id)
        having count(*) > 1
      )),
    ('LOGIC', 'another owner cannot be replaced by a work item action',
      position('assignment_owner_id <> current_user_id' in pg_get_functiondef(
        'public.link_complete_power_outage_work_item_v1(uuid,text,uuid)'::regprocedure)) > 0),
    ('SAFETY', 'stage three enables no direct email action',
      not coalesce((select (metadata ->> 'directEmailEnabled')::boolean
        from public.complete_power_outage_action_workspace_state where singleton), true)),
    ('SAFETY', 'stage three enables no external request',
      not coalesce((select (metadata ->> 'externalRequestsEnabled')::boolean
        from public.complete_power_outage_action_workspace_state where singleton), true)),
    ('SAFETY', 'Jobs creation remains disabled for the next stage',
      not coalesce((select (metadata ->> 'jobsCreationEnabled')::boolean
        from public.complete_power_outage_action_workspace_state where singleton), true)),
    ('STATE', 'communication action workspace regular actions are active',
      coalesce((select ui_enabled and contract_version >= 2
        from public.complete_power_outage_action_workspace_state where singleton), false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
