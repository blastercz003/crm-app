with function_contracts as (
  select
    pg_get_functiondef(
      'public.get_complete_power_outage_contact_management_summary_v1()'::regprocedure
    ) as summary_definition,
    pg_get_functiondef(
      'public.get_complete_power_outage_contact_management_workspace_v1()'::regprocedure
    ) as workspace_definition,
    pg_get_functiondef(
      'public.decide_complete_power_outage_contact_review_v1(uuid,text)'::regprocedure
    ) as contact_decision_definition,
    pg_get_functiondef(
      'public.decide_complete_power_outage_domain_review_v1(text,text,text)'::regprocedure
    ) as domain_decision_definition,
    pg_get_functiondef(
      'public.prepare_complete_power_outage_contact_selector_v1(text)'::regprocedure
    ) as selector_definition,
    pg_get_functiondef(
      'public.get_complete_power_outage_contact_detail_v1(uuid)'::regprocedure
    ) as detail_definition
), latest_contact_decisions as (
  select distinct on (decision.shadow_contact_id)
    decision.shadow_contact_id,
    decision.decision
  from public.complete_power_outage_contact_review_decisions decision
  order by decision.shadow_contact_id, decision.created_at desc, decision.id desc
), checks as (
  select 'FUNCTION'::text as check_type,
    'admin contact management summary and workspace exist'::text as object_name,
    to_regprocedure(
      'public.get_complete_power_outage_contact_management_summary_v1()'
    ) is not null
      and to_regprocedure(
        'public.get_complete_power_outage_contact_management_workspace_v1()'
      ) is not null as is_correct

  union all
  select 'FUNCTION', 'admin contact and domain decisions exist',
    to_regprocedure(
      'public.decide_complete_power_outage_contact_review_v1(uuid,text)'
    ) is not null
      and to_regprocedure(
        'public.decide_complete_power_outage_domain_review_v1(text,text,text)'
      ) is not null

  union all
  select 'FUNCTION', 'safe contact selector preparation exists',
    to_regprocedure(
      'public.prepare_complete_power_outage_contact_selector_v1(text)'
    ) is not null

  union all
  select 'GRANT', 'authenticated uses contact management only through guarded functions',
    has_function_privilege(
      'authenticated',
      'public.get_complete_power_outage_contact_management_summary_v1()',
      'EXECUTE'
    )
      and has_function_privilege(
        'authenticated',
        'public.get_complete_power_outage_contact_management_workspace_v1()',
        'EXECUTE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_contact_classification_effective_v1',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_contact_review_decisions',
        'SELECT,INSERT,UPDATE,DELETE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_contact_domain_review_decisions',
        'SELECT,INSERT,UPDATE,DELETE'
      )

  union all
  select 'GRANT', 'every contact management operation enforces administrator role',
    summary_definition ilike '%profile.role = ''admin''%'
      and workspace_definition ilike '%profile.role = ''admin''%'
      and contact_decision_definition ilike '%profile.role = ''admin''%'
      and domain_decision_definition ilike '%profile.role = ''admin''%'
      and selector_definition ilike '%profile.role = ''admin''%'
  from function_contracts

  union all
  select 'ISOLATION', 'contact management stays in COMPLETE scope',
    summary_definition not ilike '%market_power_outage%'
      and workspace_definition not ilike '%market_power_outage%'
      and contact_decision_definition not ilike '%market_power_outage%'
      and domain_decision_definition not ilike '%market_power_outage%'
      and selector_definition not ilike '%market_power_outage%'
  from function_contracts

  union all
  select 'LOGIC', 'latest manual contact decisions are applied',
    not exists (
      select 1
      from latest_contact_decisions latest
      join public.complete_power_outage_contact_classification_effective_v1 effective
        on effective.shadow_contact_id = latest.shadow_contact_id
      where (latest.decision = 'approved' and (
          effective.effective_classification_status <> 'manual_approved'
          or not effective.notification_eligible
        ))
        or (latest.decision = 'rejected' and (
          effective.effective_classification_status <> 'manual_rejected'
          or effective.notification_eligible
        ))
    )

  union all
  select 'LOGIC', 'effective contacts keep at most one primary per company and type',
    not exists (
      select effective.ico, effective.contact_type
      from public.complete_power_outage_contact_classification_effective_v1 effective
      where effective.is_primary
      group by effective.ico, effective.contact_type
      having count(*) > 1
    )

  union all
  select 'LOGIC', 'every company with an eligible email has one primary email',
    not exists (
      select effective.ico
      from public.complete_power_outage_contact_classification_effective_v1 effective
      where effective.contact_type = 'email'
      group by effective.ico
      having bool_or(effective.notification_eligible)
        and count(*) filter (where effective.is_primary) <> 1
    )

  union all
  select 'LOGIC', 'contact approval accepts review emails only',
    contact_decision_definition ilike '%contact_type = ''email''%'
      and contact_decision_definition ilike
        '%classification_status = ''needs_review''%'
  from function_contracts

  union all
  select 'LOGIC', 'domain approval accepts review domains only',
    domain_decision_definition ilike '%result_status = ''needs_review''%'
      and domain_decision_definition ilike '%candidate_url is not null%'
  from function_contracts

  union all
  select 'LOGIC', 'selector preparation captures an immutable selector batch',
    selector_definition ilike
      '%capture_complete_power_outage_contact_discovery_batch%'
      and selector_definition ilike '%lifecycle_status = ''active''%'
  from function_contracts

  union all
  select 'LOGIC', 'management counts and reviews follow the selected batch',
    summary_definition ilike
      '%complete_power_outage_contact_discovery_batch_items%'
      and workspace_definition ilike
        '%complete_power_outage_contact_discovery_batch_items%'
      and workspace_definition ilike '%active_batch.id%'
  from function_contracts

  union all
  select 'SAFETY', 'selector preparation never starts paid website lookup',
    selector_definition not ilike '%brave%'
      and selector_definition not ilike '%http_get%'
      and selector_definition not ilike '%http_post%'
      and selector_definition not ilike
        '%claim_complete_power_outage_contact_discovery%'
      and selector_definition ilike '%paidWebsiteLookupRequested%'
      and selector_definition ilike '%website_lookup_enabled = false%'
  from function_contracts

  union all
  select 'SAFETY', 'contact decisions are append only',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid
          = 'public.complete_power_outage_contact_review_decisions'::regclass
        and trigger_row.tgname = 'cpo_contact_review_decisions_immutable'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    )
      and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid
            = 'public.complete_power_outage_contact_domain_review_decisions'::regclass
          and trigger_row.tgname = 'cpo_contact_domain_review_decisions_immutable'
          and not trigger_row.tgisinternal
          and trigger_row.tgenabled <> 'D'
      )

  union all
  select 'SAFETY', 'email planning and dispatch remain disabled',
    not email_planning_enabled
      and not email_dispatch_enabled
      and not coalesce(
        (metadata ->> 'emailPlanningUiEnabled')::boolean,
        false
      )
      and not coalesce(
        (metadata ->> 'emailDispatchUiEnabled')::boolean,
        false
      )
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'admin contact management UI version one is active',
    ui_enabled
      and coalesce(
        (metadata ->> 'contactManagementUiEnabled')::boolean,
        false
      )
      and metadata ->> 'contactManagementUiVersion' = '1'
      and metadata ->> 'contactManagementUiAudience' = 'admin'
      and not coalesce(
        (metadata ->> 'paidWebsiteLookupFromUiEnabled')::boolean,
        true
      )
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'VIEW', 'effective contact detail uses reviewed decisions',
    to_regclass(
      'public.complete_power_outage_contact_classification_effective_v1'
    ) is not null
      and detail_definition ilike
        '%complete_power_outage_contact_classification_effective_v1%'
      and detail_definition ilike '%candidate_status = ''confirmed''%'
  from function_contracts
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
