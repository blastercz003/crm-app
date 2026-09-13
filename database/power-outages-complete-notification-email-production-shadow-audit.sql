begin;

-- Ostry provoz KOMPLETNI, krok 7: uplny SHADOW audit nad skutecne
-- pripravenymi plany. Audit smi obnovit lokalni plan, ale nevytvari odesilaci
-- slot, nevola HTTP ani Resend a zachovava produkcni dispatch vypnuty.
do $$
begin
  if to_regprocedure('public.run_cpo_notification_email_production_planner_v1(integer)') is null
    or to_regprocedure('public.claim_cpo_notification_email_production_v1()') is null
    or to_regprocedure('public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)') is null
    or to_regclass('public.cpo_notification_email_production_safety_state') is null
    or to_regclass('public.complete_power_outage_notification_email_plans') is null then
    raise exception 'Chybi zavislosti pro kompletni produkcni SHADOW audit KOMPLETNI.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and (
        config.configuration_status = 'live'
        or config.production_activation_enabled
        or config.continuous_dispatch_enabled
        or email_state.runtime_mode = 'live'
        or email_state.dispatch_enabled
      )
  ) then
    raise exception 'SHADOW audit lze spustit pouze pri vypnutem produkcnim odesilani.';
  end if;
end
$$;

create table if not exists public.cpo_notification_email_production_shadow_audits (
  id uuid primary key default gen_random_uuid(),
  audit_status text not null,
  technical_security_ready boolean not null,
  prepared_data_ready boolean not null,
  configuration_version integer not null,
  selector_key text not null
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  ready_plan_count integer not null,
  dispatchable_plan_count integer not null,
  safely_skipped_plan_count integer not null,
  duplicate_dispatchable_count integer not null,
  plan_set_fingerprint text not null,
  checks jsonb not null,
  metrics jsonb not null,
  planner_result jsonb not null,
  sending_attempted boolean not null default false,
  created_at timestamptz not null default now(),
  constraint cpo_production_shadow_audit_status_check check (
    audit_status in ('passed', 'failed')
  ),
  constraint cpo_production_shadow_audit_counts_check check (
    ready_plan_count >= 0
    and dispatchable_plan_count >= 0
    and safely_skipped_plan_count >= 0
    and ready_plan_count = dispatchable_plan_count + safely_skipped_plan_count
    and duplicate_dispatchable_count >= 0
  ),
  constraint cpo_production_shadow_audit_fingerprint_check check (
    plan_set_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_production_shadow_audit_json_check check (
    jsonb_typeof(checks) = 'object'
    and jsonb_typeof(metrics) = 'object'
    and jsonb_typeof(planner_result) = 'object'
  ),
  constraint cpo_production_shadow_audit_no_send_check check (
    not sending_attempted
  )
);

create index if not exists cpo_production_shadow_audit_latest_idx
  on public.cpo_notification_email_production_shadow_audits(created_at desc);

create or replace function public.prevent_cpo_notification_email_production_shadow_audit_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie produkcnich SHADOW auditu KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_production_shadow_audits_immutable
  on public.cpo_notification_email_production_shadow_audits;
create trigger cpo_production_shadow_audits_immutable
before update or delete on public.cpo_notification_email_production_shadow_audits
for each row execute function
  public.prevent_cpo_notification_email_production_shadow_audit_mutation_v1();

create or replace function public.run_cpo_notification_email_production_shadow_audit_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  contact_state public.complete_power_outage_contact_discovery_state%rowtype;
  safety_state public.cpo_notification_email_production_safety_state%rowtype;
  planner_result_value jsonb;
  ready_count integer;
  dispatchable_count integer;
  skipped_count integer;
  duplicate_count integer;
  wrong_selector_count integer;
  missing_unsubscribe_count integer;
  outside_horizon_count integer;
  suppressed_count integer;
  ineligible_contact_count integer;
  inactive_outage_count integer;
  existing_job_count integer;
  previously_sent_count integer;
  active_reservation_count integer;
  fingerprint_value text;
  configuration_safe boolean;
  runtime_safe boolean;
  selectors_synchronized boolean;
  limits_safe boolean;
  safety_monitor_ready boolean;
  technical_ready boolean;
  data_ready boolean;
  checks_value jsonb;
  metrics_value jsonb;
  audit_id uuid;
begin
  -- Soubezny planner ani dispatcher nemohou behem snimku zmenit auditovanou
  -- mnozinu. Zamek je transakcni a neprovadi rezervaci odesilaciho slotu.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_production_planner_v1', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0)
  );

  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;
  select * into contact_state
  from public.complete_power_outage_contact_discovery_state
  where singleton;
  select * into safety_state
  from public.cpo_notification_email_production_safety_state
  where singleton;

  if config_row.singleton is null or email_state.singleton is null
    or contact_state.singleton is null or safety_state.singleton is null then
    raise exception 'Chybi nektery z produkcnich stavu KOMPLETNI.';
  end if;

  if config_row.configuration_status = 'live'
    or config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled
    or email_state.runtime_mode = 'live'
    or email_state.dispatch_enabled then
    raise exception 'SHADOW audit odmitl aktivni produkcni odesilani.';
  end if;

  planner_result_value :=
    public.run_cpo_notification_email_production_planner_v1(5000);

  -- Planner mohl pri vlastni chybe bezpecne prejit do PAUSED, proto stavy
  -- nacteme znovu a tuto skutecnost zahrneme do vysledku.
  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;

  with evaluated as (
    select
      plan.id,
      plan.ico,
      plan.outage_id,
      plan.event_kind,
      plan.starts_at_snapshot,
      plan.selector_key = config_row.active_selector_key as selector_ok,
      plan.unsubscribe_token is not null as unsubscribe_ok,
      plan.starts_at_snapshot > now()
        + make_interval(mins => config_row.minimum_outage_lead_minutes)
        and plan.starts_at_snapshot <= now()
          + make_interval(days => config_row.maximum_outage_horizon_days) as horizon_ok,
      not exists (
        select 1
        from public.complete_power_outage_notification_email_suppressions_v1 suppression
        where suppression.normalized_email = plan.recipient_email
                   and suppression.is_suppressed
      ) as suppression_ok,
      exists (
        select 1
        from public.complete_power_outage_contact_classification_effective_v1 contact
        where contact.shadow_contact_id = plan.recipient_contact_id
          and contact.ico = plan.ico
          and contact.contact_type = 'email'
          and contact.notification_eligible
          and contact.is_primary
          and lower(contact.normalized_value) = lower(plan.recipient_email)
      ) as contact_ok,
      exists (
        select 1 from public.complete_power_outages outage
        where outage.id = plan.outage_id
          and outage.source_status = 'scheduled'
          and outage.starts_at = plan.starts_at_snapshot
      ) as outage_ok,
           not exists (
        select 1
        from public.complete_power_outage_companies company
        join public.complete_power_outage_addresses address
          on address.id = company.outage_address_id
        join public.complete_power_outage_job_links job_link
          on job_link.candidate_id = company.id
        where company.ico = plan.ico
          and address.outage_id = plan.outage_id
      ) as job_ok,
      not exists (
        select 1 from public.cpo_notification_email_production_ledger_v1 ledger
        where ledger.plan_id = plan.id
          and (ledger.consumes_limit or ledger.active_reservation)
      ) and not exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_send_outcomes pilot
        where pilot.plan_id = plan.id and pilot.outcome = 'sent'
      ) as delivery_ok,
      exists (
        select 1 from public.cpo_notification_email_production_ledger_v1 ledger
        where ledger.plan_id = plan.id and ledger.active_reservation
      ) as has_active_reservation,
      exists (
        select 1 from public.cpo_notification_email_production_ledger_v1 ledger
        where ledger.plan_id = plan.id and ledger.consumes_limit
      ) or exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_send_outcomes pilot
        where pilot.plan_id = plan.id and pilot.outcome = 'sent'
      ) as was_previously_sent
    from public.complete_power_outage_notification_email_plans plan
    where plan.plan_status = 'shadow_ready'
  ), classified as (
    select *,
      selector_ok and unsubscribe_ok and horizon_ok and suppression_ok
        and contact_ok and outage_ok and job_ok and delivery_ok as is_dispatchable
    from evaluated
  ), duplicate_dispatchable as (
    select ico, outage_id, event_kind
    from classified
    where is_dispatchable
    group by ico, outage_id, event_kind
    having count(*) > 1
  )
  select
    count(*)::integer,
    count(*) filter (where is_dispatchable)::integer,
    count(*) filter (where not is_dispatchable)::integer,
    (select count(*)::integer from duplicate_dispatchable),
    count(*) filter (where not selector_ok)::integer,
    count(*) filter (where not unsubscribe_ok)::integer,
    count(*) filter (where not horizon_ok)::integer,
    count(*) filter (where not suppression_ok)::integer,
    count(*) filter (where not contact_ok)::integer,
    count(*) filter (where not outage_ok)::integer,
    count(*) filter (where not job_ok)::integer,
    count(*) filter (where was_previously_sent)::integer,
    count(*) filter (where has_active_reservation)::integer,
    encode(extensions.digest(coalesce(
      string_agg(id::text, ',' order by id::text) filter (where is_dispatchable),
      ''
    ), 'sha256'), 'hex')
  into
    ready_count, dispatchable_count, skipped_count, duplicate_count,
    wrong_selector_count, missing_unsubscribe_count, outside_horizon_count,
    suppressed_count, ineligible_contact_count, inactive_outage_count,
    existing_job_count, previously_sent_count, active_reservation_count,
    fingerprint_value
  from classified;

  configuration_safe :=
    config_row.configuration_status = 'ready'
    and config_row.settings_ui_enabled
    and config_row.continuous_planning_enabled
    and not config_row.production_activation_enabled
    and not config_row.continuous_dispatch_enabled
    and config_row.selector_change_requires_paused_dispatch;
  runtime_safe :=
    email_state.runtime_mode = 'shadow'
    and email_state.planning_enabled
    and not email_state.dispatch_enabled;
  selectors_synchronized :=
    config_row.active_selector_key = contact_state.selected_selector_key
    and email_state.active_selector_key = config_row.active_selector_key;
  limits_safe :=
    config_row.daily_send_limit between 1 and config_row.hard_daily_send_limit
    and config_row.hard_daily_send_limit = 100
    and config_row.monthly_send_limit between config_row.daily_send_limit
      and config_row.hard_monthly_send_limit
    and config_row.hard_monthly_send_limit = 2500
    and config_row.minimum_interval_seconds between 60 and 3600
    and config_row.send_window_start < config_row.send_window_end
    and config_row.accounting_timezone = 'Europe/Prague';
  safety_monitor_ready :=
    safety_state.monitoring_enabled
    and safety_state.auto_pause_enabled
    and safety_state.transient_failure_threshold = 3
    and not safety_state.live_signal_ingestion_enabled
    and not safety_state.is_paused;
  technical_ready := configuration_safe and runtime_safe
    and selectors_synchronized and limits_safe and safety_monitor_ready
    and active_reservation_count = 0
    and coalesce(planner_result_value ->> 'status', '') not in ('failed', 'paused');
  data_ready := dispatchable_count > 0 and duplicate_count = 0;

  checks_value := jsonb_build_object(
    'configurationSafe', configuration_safe,
    'runtimeSafe', runtime_safe,
    'selectorsSynchronized', selectors_synchronized,
    'limitsInsideHardCeilings', limits_safe,
    'productionSafetyMonitorReady', safety_monitor_ready,
    'noActiveProductionReservation', active_reservation_count = 0,
    'plannerRefreshSucceeded',
      coalesce(planner_result_value ->> 'status', '') not in ('failed', 'paused'),
    'dispatchablePlansExist', dispatchable_count > 0,
    'dispatchablePlansHaveNoDuplicateCompanyOutage', duplicate_count = 0,
    'readyPlansAreFullyClassified', ready_count = dispatchable_count + skipped_count,
    'sendingAttempted', false
  );
  metrics_value := jsonb_build_object(
    'readyPlanCount', ready_count,
    'dispatchablePlanCount', dispatchable_count,
    'safelySkippedPlanCount', skipped_count,
    'wrongSelectorCount', wrong_selector_count,
    'missingUnsubscribeCount', missing_unsubscribe_count,
    'outsideHorizonCount', outside_horizon_count,
    'suppressedCount', suppressed_count,
    'ineligibleContactCount', ineligible_contact_count,
    'inactiveOutageCount', inactive_outage_count,
    'existingJobCount', existing_job_count,
    'previouslySentCount', previously_sent_count,
    'activeReservationCount', active_reservation_count,
    'duplicateDispatchableCount', duplicate_count
  );

  insert into public.cpo_notification_email_production_shadow_audits (
    audit_status, technical_security_ready, prepared_data_ready,
    configuration_version, selector_key, ready_plan_count,
    dispatchable_plan_count, safely_skipped_plan_count,
    duplicate_dispatchable_count, plan_set_fingerprint,
    checks, metrics, planner_result, sending_attempted
  ) values (
    case when technical_ready and data_ready then 'passed' else 'failed' end,
    technical_ready, data_ready, config_row.configuration_version,
    config_row.active_selector_key, ready_count, dispatchable_count,
    skipped_count, duplicate_count, fingerprint_value,
    checks_value, metrics_value, coalesce(planner_result_value, '{}'::jsonb), false
  ) returning id into audit_id;

  return jsonb_build_object(
    'auditId', audit_id,
    'status', case when technical_ready and data_ready then 'passed' else 'failed' end,
    'technicalSecurityReady', technical_ready,
    'preparedDataReady', data_ready,
    'configurationVersion', config_row.configuration_version,
    'selectorKey', config_row.active_selector_key,
    'planSetFingerprint', fingerprint_value,
    'checks', checks_value,
    'metrics', metrics_value,
    'sendingAttempted', false
  );
end;
$$;

alter table public.cpo_notification_email_production_shadow_audits
  enable row level security;
revoke all on table public.cpo_notification_email_production_shadow_audits
  from public, anon, authenticated;
grant all on table public.cpo_notification_email_production_shadow_audits
  to service_role;

revoke all on function public.prevent_cpo_notification_email_production_shadow_audit_mutation_v1()
  from public, anon, authenticated;
revoke all on function public.run_cpo_notification_email_production_shadow_audit_v1()
  from public, anon, authenticated;
grant execute on function public.prevent_cpo_notification_email_production_shadow_audit_mutation_v1()
  to service_role;
grant execute on function public.run_cpo_notification_email_production_shadow_audit_v1()
  to service_role;

-- Prvni audit se provede pri instalaci nad aktualnimi skutecnymi plany.
select public.run_cpo_notification_email_production_shadow_audit_v1();

notify pgrst, 'reload schema';
commit;

with latest as (
  select *
  from public.cpo_notification_email_production_shadow_audits
  order by created_at desc, id desc
  limit 1
), definitions as (
  select pg_get_functiondef(
    'public.run_cpo_notification_email_production_shadow_audit_v1()'::regprocedure
  ) as audit_definition
), audit as (
  select 'TABLE'::text as check_type,
    'immutable production SHADOW audit history exists'::text as object_name,
    to_regclass('public.cpo_notification_email_production_shadow_audits') is not null as is_correct

  union all
  select 'FUNCTION', 'complete production SHADOW audit exists',
    to_regprocedure('public.run_cpo_notification_email_production_shadow_audit_v1()') is not null

  union all
  select 'GRANT', 'authenticated cannot run or enumerate private SHADOW audit',
    not has_function_privilege(
      'authenticated',
      'public.run_cpo_notification_email_production_shadow_audit_v1()',
      'EXECUTE'
    ) and not has_table_privilege(
      'authenticated',
      'public.cpo_notification_email_production_shadow_audits',
      'SELECT'
    )

  union all
  select 'RLS', 'production SHADOW audit history has row level security',
    (select relrowsecurity from pg_class where oid =
      'public.cpo_notification_email_production_shadow_audits'::regclass)

  union all
  select 'DATA', 'actual prepared data contains dispatchable notices',
    prepared_data_ready and dispatchable_plan_count > 0
  from latest

  union all
  select 'DATA', 'dispatchable company outage notices contain no duplicates',
    duplicate_dispatchable_count = 0
  from latest

  union all
  select 'DATA', 'every ready plan is classified as dispatchable or safely skipped',
    ready_plan_count = dispatchable_plan_count + safely_skipped_plan_count
  from latest

  union all
  select 'LOGIC', 'SHADOW audit mirrors production dispatcher eligibility',
    audit_definition ilike '%notification_eligible%'
      and audit_definition ilike '%is_primary%'
      and audit_definition ilike '%source_status = ''scheduled''%'
      and audit_definition ilike '%notification_email_suppressions_v1%'
      and audit_definition ilike '%complete_power_outage_job_links%'
      and audit_definition ilike '%pilot_send_outcomes%'
  from definitions

  union all
  select 'LOGIC', 'SHADOW audit validates configured hard limits and Prague accounting',
    audit_definition ilike '%hard_daily_send_limit = 100%'
      and audit_definition ilike '%hard_monthly_send_limit = 2500%'
      and audit_definition ilike '%Europe/Prague%'
  from definitions

  union all
  select 'SAFETY', 'SHADOW audit creates no send slot or network request',
    audit_definition not ilike '%insert into public.cpo_notification_email_production_slots%'
      and audit_definition not ilike '%claim_cpo_notification_email_production_v1(%'
      and audit_definition not ilike '%http_get%'
      and audit_definition not ilike '%http_post%'
      and audit_definition not ilike '%resend.com%'
  from definitions

  union all
  select 'SAFETY', 'SHADOW audit records no sending attempt',
    not sending_attempted and checks ->> 'sendingAttempted' = 'false'
  from latest

  union all
  select 'SAFETY', 'production dispatch and LIVE signal ingestion remain disabled',
    not config.production_activation_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.dispatch_enabled
      and not safety_state.live_signal_ingestion_enabled
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  cross join public.cpo_notification_email_production_safety_state safety_state
  where config.singleton and email_state.singleton and safety_state.singleton

  union all
  select 'ISOLATION', 'SHADOW audit does not reference MARKET email objects',
    audit_definition not ilike '%market_email%'
  from definitions

  union all
  select 'STATE', 'latest production SHADOW audit passed',
    audit_status = 'passed'
      and technical_security_ready
      and prepared_data_ready
  from latest
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;

select
  id as audit_id,
  audit_status,
  technical_security_ready,
  prepared_data_ready,
  configuration_version,
  selector_key,
  ready_plan_count,
  dispatchable_plan_count,
  safely_skipped_plan_count,
  duplicate_dispatchable_count,
  metrics,
  created_at
from public.cpo_notification_email_production_shadow_audits
order by created_at desc, id desc
limit 1;
