with planner_contract as (
  select pg_get_functiondef(
    'public.refresh_complete_power_outage_notification_email_plans_v1(integer)'::regprocedure
  ) as definition
), summary_contract as (
  select pg_get_functiondef(
    'public.get_complete_power_outage_notification_email_planning_summary_v1()'::regprocedure
  ) as definition
), candidate_contract as (
  select pg_get_viewdef(
    'public.complete_power_outage_notification_email_candidates_v1'::regclass,
    true
  ) as definition
), checks as (
  select 'CRON'::text as check_type,
    'COMPLETE email SHADOW planning every minute'::text as object_name,
    count(*) = 1 and min(schedule) = '* * * * *' as is_correct
  from cron.job
  where jobname = 'complete_notification_email_shadow_planning_every_minute'

  union all
  select 'DATA', 'COMPLETE email plans have unique company outage events',
    not exists (
      select plan.ico, plan.outage_id, plan.event_kind
      from public.complete_power_outage_notification_email_plans plan
      group by plan.ico, plan.outage_id, plan.event_kind
      having count(*) > 1
    )

  union all
  select 'DATA', 'ready plans use an effective primary eligible email',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      left join public.complete_power_outage_contact_classification_effective_v1 contact
        on contact.shadow_contact_id = plan.recipient_contact_id
       and contact.ico = plan.ico
       and contact.normalized_value = plan.recipient_email
      where plan.plan_status = 'shadow_ready'
        and (
          contact.shadow_contact_id is null
          or contact.contact_type <> 'email'
          or not contact.notification_eligible
          or not contact.is_primary
        )
    )

  union all
  select 'DATA', 'ready plans contain future scheduled COMPLETE outages only',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      left join public.complete_power_outages outage on outage.id = plan.outage_id
      where plan.plan_status = 'shadow_ready'
        and (
          outage.id is null
          or outage.source_status <> 'scheduled'
          or outage.starts_at <= now()
        )
    )

  union all
  select 'DATA', 'ready plans exclude outages with an existing job link',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      join public.complete_power_outage_companies company on company.ico = plan.ico
      join public.complete_power_outage_addresses address
        on address.id = company.outage_address_id
       and address.outage_id = plan.outage_id
      join public.complete_power_outage_job_links job_link
        on job_link.candidate_id = company.id
      where plan.plan_status = 'shadow_ready'
    )

  union all
  select 'DATA', 'suppressed addresses never have a ready plan',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      join public.complete_power_outage_notification_email_suppressions_v1 suppression
        on suppression.normalized_email = plan.recipient_email
       and suppression.is_suppressed
      where plan.plan_status = 'shadow_ready'
    )

  union all
  select 'FUNCTION', 'deterministic COMPLETE email SHADOW planner exists',
    to_regprocedure(
      'public.refresh_complete_power_outage_notification_email_plans_v1(integer)'
    ) is not null

  union all
  select 'FUNCTION', 'admin-only COMPLETE email planning summary exists',
    to_regprocedure(
      'public.get_complete_power_outage_notification_email_planning_summary_v1()'
    ) is not null

  union all
  select 'GRANT', 'authenticated cannot inspect or run COMPLETE email planning',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_notification_email_state',
      'SELECT,INSERT,UPDATE,DELETE'
    )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_notification_email_plans',
        'SELECT,INSERT,UPDATE,DELETE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_notification_email_suppression_events',
        'SELECT,INSERT,UPDATE,DELETE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_notification_email_plans_v1(integer)',
        'EXECUTE'
      )

  union all
  select 'GRANT', 'planning summary enforces administrator role',
    has_function_privilege(
      'authenticated',
      'public.get_complete_power_outage_notification_email_planning_summary_v1()',
      'EXECUTE'
    )
      and summary_contract.definition ilike '%profile.role = ''admin''%'
  from summary_contract

  union all
  select 'RLS', 'all COMPLETE email planning tables have RLS',
    not exists (
      select 1
      from pg_class relation
      where relation.oid in (
        'public.complete_power_outage_notification_email_state'::regclass,
        'public.complete_power_outage_notification_email_plans'::regclass,
        'public.complete_power_outage_notification_email_suppression_events'::regclass,
        'public.complete_power_outage_notification_email_planning_runs'::regclass
      )
        and not relation.relrowsecurity
    )

  union all
  select 'ISOLATION', 'COMPLETE email planning never references MARKET email objects',
    planner_contract.definition not ilike '%power_outage_client_email_%'
      and candidate_contract.definition not ilike '%power_outage_store_matches%'
      and candidate_contract.definition not ilike '%power_outage_job_client_mappings%'
  from planner_contract cross join candidate_contract

  union all
  select 'ISOLATION', 'COMPLETE uses an independent provider namespace',
    provider_namespace = 'complete_resend'
      and metadata ->> 'futureEnvironmentPrefix' = 'COMPLETE_RESEND_'
      and metadata ->> 'futureApiNamespace'
        = '/api/power-outages/complete/notification-emails'
      and coalesce((metadata ->> 'marketEmailIsolation')::boolean, false)
  from public.complete_power_outage_notification_email_state
  where singleton

  union all
  select 'LOGIC', 'planner follows the active contact selector batch',
    candidate_contract.definition ilike
      '%complete_power_outage_contact_discovery_batches%'
      and candidate_contract.definition ilike
        '%complete_power_outage_contact_discovery_batch_items%'
      and planner_contract.definition ilike '%active_selector_key%'
  from planner_contract cross join candidate_contract

  union all
  select 'LOGIC', 'planner uses confirmed commercially relevant companies',
    candidate_contract.definition ilike '%candidate_status = ''confirmed''%'
      and candidate_contract.definition ilike
        '%business_relevance_status = ''eligible''%'
  from candidate_contract

  union all
  select 'LOGIC', 'planner creates one email per company and outage',
    candidate_contract.definition ilike
      '%complete-notification-email-v1:new_outage:%'
      and planner_contract.definition ilike '%on conflict (dedupe_key)%'
  from planner_contract cross join candidate_contract

  union all
  select 'LOGIC', 'planner paginates without repeating current plans',
    planner_contract.definition ilike '%limit requested_limit%'
      and planner_contract.definition ilike
        '%current_plan.dedupe_key = candidate.dedupe_key%'
      and planner_contract.definition ilike
        '%current_plan.batch_id = candidate.batch_id%'
  from planner_contract

  union all
  select 'LOGIC', 'unchanged plans are not rewritten every minute',
    planner_contract.definition ilike '%is distinct from%'
      and planner_contract.definition not ilike
        '%not_before_at = excluded.not_before_at%'
  from planner_contract

  union all
  select 'LOGIC', 'unsubscribe evidence is append only and applied before planning',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid
          = 'public.complete_power_outage_notification_email_suppression_events'::regclass
        and trigger_row.tgname = 'cpo_notification_email_suppression_immutable'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    )
      and candidate_contract.definition ilike
        '%complete_power_outage_notification_email_suppressions_v1%'
  from candidate_contract

  union all
  select 'LOGIC', 'repeated planner failures pause COMPLETE only',
    auto_pause_after_failures = 3
      and planner_contract.definition ilike '%consecutive_failure_count + 1%'
      and planner_contract.definition ilike '%runtime_mode = case%'
      and planner_contract.definition ilike '%then ''paused''%'
  from public.complete_power_outage_notification_email_state
  cross join planner_contract
  where singleton

  union all
  select 'SAFETY', 'COMPLETE email planning makes no external request',
    planner_contract.definition not ilike '%net.http%'
      and planner_contract.definition not ilike '%http_post%'
      and planner_contract.definition not ilike '%resend.emails%'
      and planner_contract.definition not ilike '%provider_message_id%'
  from planner_contract

  union all
  select 'SAFETY', 'COMPLETE email dispatch remains disabled',
    runtime_mode = 'shadow'
      and planning_enabled
      and not dispatch_enabled
      and not coalesce((metadata ->> 'resendIntegrationEnabled')::boolean, true)
  from public.complete_power_outage_notification_email_state
  where singleton

  union all
  select 'SAFETY', 'contact discovery email phases remain disabled',
    not email_planning_enabled and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'SAFETY', 'no COMPLETE email dispatch schedule exists',
    not exists (
      select 1
      from cron.job
      where jobname ilike '%complete%notification%email%dispatch%'
         or command ilike
           '%complete_power_outage_notification_email%send%'
    )

  union all
  select 'SAFETY', 'planner never reports a sending attempt',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_planning_runs
      where sending_attempted
    )
      and not exists (
        select 1
        from public.complete_power_outage_notification_email_plans
        where coalesce((metadata ->> 'sendingAttempted')::boolean, true)
      )

  union all
  select 'SAFETY', 'MARKETY email state is not part of COMPLETE planner',
    planner_contract.definition not ilike '%power_outage_client_email_state%'
      and planner_contract.definition not ilike '%power_outage_client_email_deliveries%'
  from planner_contract

  union all
  select 'SAFETY', 'planner does not mutate COMPLETE outage source records',
    planner_contract.definition not ilike
      '%update public.complete_power_outages%'
      and planner_contract.definition not ilike
        '%update public.complete_power_outage_companies%'
      and planner_contract.definition not ilike
        '%delete from public.complete_power_outages%'
      and planner_contract.definition not ilike
        '%delete from public.complete_power_outage_companies%'
  from planner_contract

  union all
  select 'STATE', 'COMPLETE email planning SHADOW version one is active',
    runtime_mode = 'shadow'
      and planning_enabled
      and not dispatch_enabled
      and planner_contract_version = 1
      and content_contract_version = 1
      and last_success_at is not null
      and last_error_code is null
  from public.complete_power_outage_notification_email_state
  where singleton

  union all
  select 'TABLE', 'independent COMPLETE email planning tables exist',
    to_regclass('public.complete_power_outage_notification_email_state') is not null
      and to_regclass('public.complete_power_outage_notification_email_plans') is not null
      and to_regclass(
        'public.complete_power_outage_notification_email_suppression_events'
      ) is not null
      and to_regclass(
        'public.complete_power_outage_notification_email_planning_runs'
      ) is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
