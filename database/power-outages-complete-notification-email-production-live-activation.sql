begin;

-- Ostry provoz KOMPLETNI, krok 8: dvoufazova rucni aktivace bez opisovani fraze.
-- Instalace pouze pripravi kontrakt a UI. Odesilani zustava vypnute, dokud
-- administrator neprovede oba samostatne kroky v aplikaci.
do $$
begin
  if to_regprocedure('public.run_cpo_notification_email_production_shadow_audit_v1()') is null
    or to_regprocedure('public.claim_cpo_notification_email_production_v1()') is null
    or to_regprocedure('public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)') is null
    or to_regclass('public.cpo_notification_email_production_safety_state') is null
    or to_regclass('public.cpo_notification_email_production_shadow_audits') is null then
    raise exception 'Chybi zavislosti pro rucni aktivaci produkcnich e-mailu KOMPLETNI.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and (config.production_activation_enabled or config.continuous_dispatch_enabled
        or email_state.runtime_mode = 'live' or email_state.dispatch_enabled)
  ) then
    raise exception 'Instalaci kroku 8 lze provest pouze pri vypnutem odesilani KOMPLETNI.';
  end if;
end
$$;

alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step3_activation_check;
alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step8_activation_check;
alter table public.complete_power_outage_notification_email_production_config
  add constraint cpo_notification_email_production_step8_activation_check check (
    settings_ui_enabled and (
      (configuration_status = 'ready' and not production_activation_enabled
        and continuous_planning_enabled and not continuous_dispatch_enabled)
      or
      (configuration_status = 'paused' and not production_activation_enabled
        and not continuous_planning_enabled and not continuous_dispatch_enabled)
      or
      (configuration_status = 'live' and production_activation_enabled
        and continuous_planning_enabled and continuous_dispatch_enabled)
    )
  );

alter table public.cpo_notification_email_production_safety_state
  drop constraint if exists cpo_production_safety_step6_ingestion_check;
alter table public.cpo_notification_email_production_safety_state
  drop constraint if exists cpo_production_safety_step8_ingestion_check;
alter table public.cpo_notification_email_production_safety_state
  add constraint cpo_production_safety_step8_ingestion_check check (
    not live_signal_ingestion_enabled
    or (monitoring_enabled and auto_pause_enabled and not is_paused)
  );

alter table public.complete_power_outage_notification_email_production_config_events
  drop constraint if exists cpo_notification_email_production_event_kind_check;
alter table public.complete_power_outage_notification_email_production_config_events
  add constraint cpo_notification_email_production_event_kind_check check (
    event_kind in (
      'foundation_installed', 'settings_changed', 'selector_changed',
      'planning_started', 'planning_paused', 'activation_prepared',
      'production_activated', 'production_paused'
    )
  );

create table if not exists public.cpo_notification_email_production_activation_intents (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  audit_id uuid not null references public.cpo_notification_email_production_shadow_audits(id) on delete restrict,
  configuration_version integer not null,
  selector_key text not null references public.complete_power_outage_contact_discovery_selectors(selector_key) on delete restrict,
  plan_set_fingerprint text not null,
  dispatchable_plan_count integer not null,
  prepared_by uuid not null references public.profiles(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_production_activation_intent_token_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint cpo_production_activation_intent_version_check check (configuration_version > 0),
  constraint cpo_production_activation_intent_fingerprint_check check (plan_set_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_production_activation_intent_count_check check (dispatchable_plan_count > 0),
  constraint cpo_production_activation_intent_expiry_check check (
    expires_at > prepared_at and expires_at <= prepared_at + interval '15 minutes'
  ),
  constraint cpo_production_activation_intent_state_check check (consumed_at is null or revoked_at is null),
  constraint cpo_production_activation_intent_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_production_activation_intents_admin_idx
  on public.cpo_notification_email_production_activation_intents(prepared_by, prepared_at desc);

alter table public.cpo_notification_email_production_activation_intents enable row level security;
revoke all on table public.cpo_notification_email_production_activation_intents
  from public, anon, authenticated;
grant all on table public.cpo_notification_email_production_activation_intents to service_role;

create or replace function public.prepare_cpo_notification_email_production_activation_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  actor_id uuid := auth.uid();
  token_value uuid := gen_random_uuid();
  audit_result jsonb;
  audit_row public.cpo_notification_email_production_shadow_audits%rowtype;
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  safety_row public.cpo_notification_email_production_safety_state%rowtype;
  intent_id uuid;
  expiry_value timestamptz := now() + interval '10 minutes';
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = actor_id and profile.role = 'admin'
  ) then
    raise exception 'Aktivaci produkcnich e-mailu muze pripravit pouze administrator.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('complete_notification_email_production_planner_v1', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('complete-notification-email-production-config-v1'));

  select * into config_row from public.complete_power_outage_notification_email_production_config where singleton for update;
  select * into email_state from public.complete_power_outage_notification_email_state where singleton for update;
  select * into safety_row from public.cpo_notification_email_production_safety_state where singleton for update;

  if config_row.singleton is null or email_state.singleton is null or safety_row.singleton is null then
    raise exception 'Chybi stav produkcniho odesilani KOMPLETNI.';
  end if;
  if config_row.configuration_status = 'live' or config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled or email_state.runtime_mode = 'live'
    or email_state.dispatch_enabled then
    raise exception 'Produkční odesilani je jiz aktivni.';
  end if;
  if safety_row.is_paused then
    raise exception 'Nejprve potvrďte a uzavrete bezpecnostni incident.';
  end if;

  if not config_row.continuous_planning_enabled then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'ready', continuous_planning_enabled = true,
        production_activation_enabled = false, continuous_dispatch_enabled = false,
        updated_at = now()
    where singleton returning * into config_row;
    update public.complete_power_outage_notification_email_state
    set runtime_mode = 'shadow', planning_enabled = true, dispatch_enabled = false, updated_at = now()
    where singleton returning * into email_state;
  end if;

  audit_result := public.run_cpo_notification_email_production_shadow_audit_v1();
  select * into audit_row from public.cpo_notification_email_production_shadow_audits
  where id = (audit_result ->> 'auditId')::uuid;

  if audit_row.id is null or audit_row.audit_status <> 'passed'
    or not audit_row.technical_security_ready or not audit_row.prepared_data_ready
    or audit_row.configuration_version <> config_row.configuration_version
    or audit_row.selector_key <> config_row.active_selector_key
    or audit_row.dispatchable_plan_count < 1 then
    raise exception 'Aktualni bezpecnostni audit neumoznuje aktivaci. Zkontrolujte pripravená data.';
  end if;

  update public.cpo_notification_email_production_activation_intents
  set revoked_at = now(), metadata = metadata || jsonb_build_object('revocationReason', 'replaced_by_new_confirmation')
  where consumed_at is null and revoked_at is null;

  insert into public.cpo_notification_email_production_activation_intents (
    token_hash, audit_id, configuration_version, selector_key,
    plan_set_fingerprint, dispatchable_plan_count, prepared_by, expires_at, metadata
  ) values (
    encode(extensions.digest(token_value::text, 'sha256'), 'hex'), audit_row.id,
    audit_row.configuration_version, audit_row.selector_key, audit_row.plan_set_fingerprint,
    audit_row.dispatchable_plan_count, actor_id, expiry_value,
    jsonb_build_object('contract', 'complete-notification-email-production-double-confirmation-v1', 'sendingAttempted', false)
  ) returning id into intent_id;

  insert into public.complete_power_outage_notification_email_production_config_events (
    event_kind, configuration_version, actor_user_id, previous_configuration,
    resulting_configuration, reason, metadata
  ) values (
    'activation_prepared', config_row.configuration_version, actor_id, null,
    jsonb_build_object('configurationStatus', config_row.configuration_status, 'activeSelectorKey', config_row.active_selector_key),
    'Prvni krok dvoufazove aktivace potvrzen administratorem.',
    jsonb_build_object('intentId', intent_id, 'auditId', audit_row.id, 'sendingAttempted', false, 'marketEmailIsolation', true)
  );

  return jsonb_build_object(
    'status', 'confirmation_required', 'confirmationToken', token_value,
    'expiresAt', expiry_value, 'selectorKey', audit_row.selector_key,
    'dispatchablePlanCount', audit_row.dispatchable_plan_count,
    'configurationVersion', audit_row.configuration_version,
    'dailySendLimit', config_row.daily_send_limit, 'monthlySendLimit', config_row.monthly_send_limit,
    'minimumIntervalSeconds', config_row.minimum_interval_seconds,
    'sendWindowStart', to_char(config_row.send_window_start, 'HH24:MI'),
    'sendWindowEnd', to_char(config_row.send_window_end, 'HH24:MI'),
    'sendWeekdays', to_jsonb(config_row.send_weekdays), 'sendingAttempted', false
  );
end;
$$;

create or replace function public.activate_cpo_notification_email_production_v1(
  requested_confirmation_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  actor_id uuid := auth.uid();
  intent_row public.cpo_notification_email_production_activation_intents%rowtype;
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  safety_row public.cpo_notification_email_production_safety_state%rowtype;
  audit_result jsonb;
  new_fingerprint text;
  new_status text;
  previous_config jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = actor_id and profile.role = 'admin'
  ) then
    raise exception 'Produkční e-maily muze aktivovat pouze administrator.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('complete_notification_email_production_planner_v1', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('complete-notification-email-production-config-v1'));

  select * into intent_row
  from public.cpo_notification_email_production_activation_intents intent
  where intent.token_hash = encode(extensions.digest(requested_confirmation_token::text, 'sha256'), 'hex')
  for update;
  if intent_row.id is null or intent_row.prepared_by <> actor_id
    or intent_row.consumed_at is not null or intent_row.revoked_at is not null
    or intent_row.expires_at <= now() then
    raise exception 'Potvrzeni vyprselo nebo neni platne. Provedte prvni krok aktivace znovu.';
  end if;

  select * into config_row from public.complete_power_outage_notification_email_production_config where singleton for update;
  select * into email_state from public.complete_power_outage_notification_email_state where singleton for update;
  select * into safety_row from public.cpo_notification_email_production_safety_state where singleton for update;
  if config_row.configuration_status <> 'ready' or config_row.production_activation_enabled
    or not config_row.continuous_planning_enabled or config_row.continuous_dispatch_enabled
    or email_state.runtime_mode <> 'shadow' or not email_state.planning_enabled or email_state.dispatch_enabled
    or safety_row.is_paused or not safety_row.monitoring_enabled or not safety_row.auto_pause_enabled
    or intent_row.configuration_version <> config_row.configuration_version
    or intent_row.selector_key <> config_row.active_selector_key then
    raise exception 'Stav se od prvniho potvrzeni zmenil. Provedte pripravu aktivace znovu.';
  end if;

  audit_result := public.run_cpo_notification_email_production_shadow_audit_v1();
  new_status := audit_result ->> 'status';
  new_fingerprint := audit_result ->> 'planSetFingerprint';
  if new_status <> 'passed' or new_fingerprint is distinct from intent_row.plan_set_fingerprint then
    update public.cpo_notification_email_production_activation_intents
    set revoked_at = now(), metadata = metadata || jsonb_build_object('revocationReason', 'audit_or_data_changed')
    where id = intent_row.id;
    return jsonb_build_object('status', 'confirmation_expired', 'activated', false,
      'reason', 'prepared_data_changed', 'sendingAttempted', false);
  end if;

  previous_config := jsonb_build_object(
    'configurationStatus', config_row.configuration_status,
    'productionActivationEnabled', config_row.production_activation_enabled,
    'continuousPlanningEnabled', config_row.continuous_planning_enabled,
    'continuousDispatchEnabled', config_row.continuous_dispatch_enabled,
    'configurationVersion', config_row.configuration_version
  );

  update public.complete_power_outage_notification_email_production_config
  set configuration_status = 'live', production_activation_enabled = true,
      continuous_planning_enabled = true, continuous_dispatch_enabled = true,
      configuration_version = configuration_version + 1,
      last_configured_at = now(), last_configured_by = actor_id,
      metadata = metadata || jsonb_build_object(
        'liveActivationContract', 'complete-notification-email-production-double-confirmation-v1',
        'activatedAt', now(), 'activatedBy', actor_id, 'activationIntentId', intent_row.id
      ), updated_at = now()
  where singleton returning * into config_row;

  update public.complete_power_outage_notification_email_state
  set runtime_mode = 'live', planning_enabled = true, dispatch_enabled = true,
      consecutive_failure_count = 0, last_error_at = null, last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object('productionLiveActivatedAt', now(), 'productionActivationIntentId', intent_row.id),
      updated_at = now()
  where singleton;

  update public.cpo_notification_email_production_safety_state
  set live_signal_ingestion_enabled = true, is_paused = false, paused_at = null,
      pause_reason_code = null, consecutive_transient_failure_count = 0,
      first_transient_failure_at = null, acknowledged_at = null, acknowledged_by = null,
      metadata = metadata || jsonb_build_object('liveSignalIngestionActivatedAt', now(), 'activationIntentId', intent_row.id),
      updated_at = now()
  where singleton;

  update public.cpo_notification_email_production_activation_intents
  set consumed_at = now(), metadata = metadata || jsonb_build_object('activatedAt', now())
  where id = intent_row.id;

  insert into public.complete_power_outage_notification_email_production_config_events (
    event_kind, configuration_version, actor_user_id, previous_configuration,
    resulting_configuration, reason, metadata
  ) values (
    'production_activated', config_row.configuration_version, actor_id, previous_config,
    jsonb_build_object('configurationStatus', 'live', 'productionActivationEnabled', true,
      'continuousPlanningEnabled', true, 'continuousDispatchEnabled', true,
      'configurationVersion', config_row.configuration_version),
    'Druhe potvrzeni rucni aktivace provedeno administratorem.',
    jsonb_build_object('intentId', intent_row.id, 'auditId', audit_result ->> 'auditId', 'marketEmailIsolation', true)
  );

  return jsonb_build_object('status', 'activated', 'activated', true,
    'selectorKey', config_row.active_selector_key,
    'configurationVersion', config_row.configuration_version);
end;
$$;

create or replace function public.pause_cpo_notification_email_production_v1(requested_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare
  actor_id uuid := auth.uid();
  reason_value text := nullif(btrim(coalesce(requested_reason, '')), '');
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  previous_config jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = actor_id and profile.role = 'admin'
  ) then raise exception 'Produkční e-maily muze pozastavit pouze administrator.'; end if;
  if reason_value is null or length(reason_value) < 3 or length(reason_value) > 500 then
    raise exception 'Duvod musi mit 3 az 500 znaku.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('complete-notification-email-production-config-v1'));
  select * into config_row from public.complete_power_outage_notification_email_production_config where singleton for update;
  previous_config := to_jsonb(config_row);

  update public.complete_power_outage_notification_email_production_config
  set configuration_status = 'paused', production_activation_enabled = false,
      continuous_planning_enabled = false, continuous_dispatch_enabled = false,
      configuration_version = configuration_version + 1,
      last_configured_at = now(), last_configured_by = actor_id,
      metadata = metadata || jsonb_build_object('manuallyPausedAt', now(), 'manuallyPausedBy', actor_id),
      updated_at = now()
  where singleton returning * into config_row;
  update public.complete_power_outage_notification_email_state
  set runtime_mode = 'paused', planning_enabled = false, dispatch_enabled = false,
      metadata = metadata || jsonb_build_object('productionPausedAt', now()), updated_at = now()
  where singleton;
  update public.cpo_notification_email_production_safety_state
  set live_signal_ingestion_enabled = false, updated_at = now() where singleton;
  update public.cpo_notification_email_production_activation_intents
  set revoked_at = now(), metadata = metadata || jsonb_build_object('revocationReason', 'production_paused')
  where consumed_at is null and revoked_at is null;
  insert into public.complete_power_outage_notification_email_production_config_events (
    event_kind, configuration_version, actor_user_id, previous_configuration,
    resulting_configuration, reason, metadata
  ) values ('production_paused', config_row.configuration_version, actor_id, previous_config,
    to_jsonb(config_row), reason_value,
    jsonb_build_object('sendingAttempted', false, 'marketEmailIsolation', true));
  return jsonb_build_object('status', 'paused', 'dispatchEnabled', false, 'marketEmailIsolation', true);
end;
$$;

create or replace function public.get_cpo_notification_email_operations_v2(requested_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Provozni prehled e-mailu je dostupny pouze administratorum.'; end if;
  if requested_limit < 1 or requested_limit > 25 then raise exception 'Limit musi byt mezi 1 a 25.'; end if;

  with sent_rows as materialized (
    select outcome.plan_id, outcome.created_at as sent_at, 'pilot'::text as channel
    from public.complete_power_outage_notification_email_pilot_send_outcomes outcome where outcome.outcome = 'sent'
    union all
    select outcome.plan_id, outcome.created_at, 'production'
    from public.cpo_notification_email_production_outcomes outcome where outcome.outcome = 'sent'
  ), delivery_rows as materialized (
    select sent.plan_id, sent.sent_at, sent.channel, plan.company_name_snapshot,
      plan.recipient_email, plan.source_snapshot, plan.starts_at_snapshot,
      plan.ends_at_snapshot, plan.municipality_snapshot,
      case when sent.channel = 'production' then
        case
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'complaint') then 'complaint'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'hard_bounce') then 'bounced'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') then 'delivered'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type in ('transient_error','configuration_error')) then 'error'
          else 'sent' end
      else
        case
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'complaint') then 'complaint'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'hard_bounce') then 'bounced'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') then 'delivered'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type in ('transient_error','configuration_error')) then 'error'
          else 'sent' end
      end as delivery_status,
      case when sent.channel = 'production'
        then (select max(e.created_at) from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success')
        else (select max(e.created_at) from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') end as delivered_at,
      case when sent.channel = 'production'
        then (select e.error_code from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.error_code is not null order by e.created_at desc limit 1)
        else (select e.error_code from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.error_code is not null order by e.created_at desc limit 1) end as error_code
    from sent_rows sent join public.complete_power_outage_notification_email_plans plan on plan.id = sent.plan_id
  )
  select jsonb_build_object(
    'runtimeMode', state.runtime_mode, 'planningEnabled', state.planning_enabled,
    'dispatchEnabled', state.dispatch_enabled, 'selectedSelectorKey', state.active_selector_key,
    'preparedCount', (select count(*) from public.complete_power_outage_notification_email_plans p
      left join public.complete_power_outage_notification_email_suppressions_v1 s on s.normalized_email = p.recipient_email and s.is_suppressed
      where p.plan_status = 'shadow_ready' and p.selector_key = state.active_selector_key
        and p.starts_at_snapshot > now() and p.expires_at > now() and s.normalized_email is null
        and not exists (select 1 from sent_rows x where x.plan_id = p.id)),
    'sentTodayCount', (select count(*) from sent_rows x where (x.sent_at at time zone 'Europe/Prague')::date = (now() at time zone 'Europe/Prague')::date),
    'deliveredTodayCount', (select count(*) from delivery_rows x where x.delivery_status = 'delivered' and (x.delivered_at at time zone 'Europe/Prague')::date = (now() at time zone 'Europe/Prague')::date),
    'lastSentAt', (select max(x.sent_at) from sent_rows x),
    'lastDeliveredAt', (select max(x.delivered_at) from delivery_rows x),
    'suppressedRecipientCount', (select count(*) from public.complete_power_outage_notification_email_suppressions_v1 s where s.is_suppressed),
    'sentTotalCount', (select count(*) from sent_rows),
    'preparedItems', coalesce((select jsonb_agg(jsonb_build_object(
      'planId', p.id, 'companyName', p.company_name_snapshot, 'recipientEmail', p.recipient_email,
      'source', p.source_snapshot, 'startsAt', p.starts_at_snapshot, 'endsAt', p.ends_at_snapshot,
      'municipality', p.municipality_snapshot, 'addresses', p.address_snapshot, 'notBeforeAt', p.not_before_at
    ) order by p.starts_at_snapshot, p.id) from (select p.* from public.complete_power_outage_notification_email_plans p
      left join public.complete_power_outage_notification_email_suppressions_v1 s on s.normalized_email = p.recipient_email and s.is_suppressed
      where p.plan_status = 'shadow_ready' and p.selector_key = state.active_selector_key
        and p.starts_at_snapshot > now() and p.expires_at > now() and s.normalized_email is null
        and not exists (select 1 from sent_rows x where x.plan_id = p.id)
      order by p.starts_at_snapshot, p.id limit requested_limit) p), '[]'::jsonb),
    'recentDeliveries', coalesce((select jsonb_agg(jsonb_build_object(
      'companyName', d.company_name_snapshot, 'recipientEmail', d.recipient_email,
      'source', d.source_snapshot, 'startsAt', d.starts_at_snapshot, 'endsAt', d.ends_at_snapshot,
      'municipality', d.municipality_snapshot, 'sentAt', d.sent_at,
      'deliveryStatus', d.delivery_status, 'deliveredAt', d.delivered_at, 'errorCode', d.error_code
    ) order by d.sent_at desc) from (select * from delivery_rows order by sent_at desc limit requested_limit) d), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_notification_email_state state where state.singleton;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.get_cpo_notification_email_delivery_history_v2(
  requested_limit integer default 20,
  requested_offset integer default 0,
  requested_status text default 'all',
  requested_search text default null,
  requested_date_from date default null,
  requested_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare result jsonb; normalized_search text := nullif(btrim(requested_search), '');
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Historie odesilani je dostupna pouze administratorum.'; end if;
  if requested_limit < 1 or requested_limit > 50 or requested_offset < 0 or requested_offset > 1000000 then
    raise exception 'Neplatne strankovani historie.';
  end if;
  if requested_status not in ('all','sent','delivered','bounced','complaint','error') then
    raise exception 'Neplatny filtr historie.';
  end if;
  if requested_date_from is not null and requested_date_to is not null and requested_date_from > requested_date_to then
    raise exception 'Pocatecni datum nesmi byt po koncovem datu.';
  end if;

  with sent_rows as materialized (
    select outcome.plan_id, outcome.created_at as sent_at, 'pilot'::text as channel
    from public.complete_power_outage_notification_email_pilot_send_outcomes outcome where outcome.outcome = 'sent'
    union all
    select outcome.plan_id, outcome.created_at, 'production'
    from public.cpo_notification_email_production_outcomes outcome where outcome.outcome = 'sent'
  ), rows_with_status as materialized (
    select plan.company_name_snapshot, plan.recipient_email, plan.source_snapshot,
      plan.starts_at_snapshot, plan.ends_at_snapshot, plan.municipality_snapshot,
      sent.sent_at,
      case when sent.channel = 'production' then
        case
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'complaint') then 'complaint'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'hard_bounce') then 'bounced'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') then 'delivered'
          when exists (select 1 from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type in ('transient_error','configuration_error')) then 'error'
          else 'sent' end
      else
        case
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'complaint') then 'complaint'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'hard_bounce') then 'bounced'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') then 'delivered'
          when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type in ('transient_error','configuration_error')) then 'error'
          else 'sent' end
      end as delivery_status,
      case when sent.channel = 'production'
        then (select max(e.created_at) from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success')
        else (select max(e.created_at) from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.signal_type = 'delivery_success') end as delivered_at,
      case when sent.channel = 'production'
        then (select e.error_code from public.cpo_notification_email_production_safety_events e where e.plan_id = sent.plan_id and e.error_code is not null order by e.created_at desc limit 1)
        else (select e.error_code from public.complete_power_outage_notification_email_pilot_safety_events e where e.plan_id = sent.plan_id and e.error_code is not null order by e.created_at desc limit 1) end as error_code
    from sent_rows sent join public.complete_power_outage_notification_email_plans plan on plan.id = sent.plan_id
  ), filtered as materialized (
    select r.* from rows_with_status r
    where (requested_status = 'all' or r.delivery_status = requested_status)
      and (requested_date_from is null or (r.sent_at at time zone 'Europe/Prague')::date >= requested_date_from)
      and (requested_date_to is null or (r.sent_at at time zone 'Europe/Prague')::date <= requested_date_to)
      and (normalized_search is null or r.company_name_snapshot ilike '%' || normalized_search || '%'
        or r.recipient_email ilike '%' || normalized_search || '%')
  ), page as (
    select * from filtered order by sent_at desc, company_name_snapshot
    limit requested_limit offset requested_offset
  )
  select jsonb_build_object(
    'totalCount', (select count(*) from filtered), 'offset', requested_offset,
    'pageSize', requested_limit,
    'hasMore', requested_offset + (select count(*) from page) < (select count(*) from filtered),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'companyName', p.company_name_snapshot, 'recipientEmail', p.recipient_email,
      'source', p.source_snapshot, 'startsAt', p.starts_at_snapshot, 'endsAt', p.ends_at_snapshot,
      'municipality', p.municipality_snapshot, 'sentAt', p.sent_at,
      'deliveryStatus', p.delivery_status, 'deliveredAt', p.delivered_at, 'errorCode', p.error_code
    ) order by p.sent_at desc, p.company_name_snapshot) from page p), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_cpo_notification_email_management_v3(requested_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare base_result jsonb; activation_result jsonb;
begin
  base_result := public.get_cpo_notification_email_management_v2(requested_limit);
  select jsonb_build_object(
    'confirmationPending', exists (
      select 1 from public.cpo_notification_email_production_activation_intents intent
      where intent.prepared_by = auth.uid() and intent.consumed_at is null
        and intent.revoked_at is null and intent.expires_at > now()
    ),
    'confirmationExpiresAt', (
      select intent.expires_at from public.cpo_notification_email_production_activation_intents intent
      where intent.prepared_by = auth.uid() and intent.consumed_at is null
        and intent.revoked_at is null and intent.expires_at > now()
      order by intent.prepared_at desc limit 1
    ),
    'doubleConfirmationRequired', true,
    'typedPhraseRequired', false
  ) into activation_result;
  return base_result || jsonb_build_object(
    'contract', 'complete-notification-email-production-live-ui-v1',
    'liveActivationAvailable', true,
    'operations', public.get_cpo_notification_email_operations_v2(5),
    'productionSafety', public.get_cpo_notification_email_production_safety_v1(),
    'productionActivation', activation_result
  );
end;
$$;

revoke all on function public.prepare_cpo_notification_email_production_activation_v1() from public, anon;
revoke all on function public.activate_cpo_notification_email_production_v1(uuid) from public, anon;
revoke all on function public.pause_cpo_notification_email_production_v1(text) from public, anon;
revoke all on function public.get_cpo_notification_email_operations_v2(integer) from public, anon;
revoke all on function public.get_cpo_notification_email_delivery_history_v2(integer,integer,text,text,date,date) from public, anon;
revoke all on function public.get_cpo_notification_email_management_v3(integer) from public, anon;
grant execute on function public.prepare_cpo_notification_email_production_activation_v1() to authenticated, service_role;
grant execute on function public.activate_cpo_notification_email_production_v1(uuid) to authenticated, service_role;
grant execute on function public.pause_cpo_notification_email_production_v1(text) to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_operations_v2(integer) to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_delivery_history_v2(integer,integer,text,text,date,date) to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_management_v3(integer) to authenticated, service_role;

-- Instalace pouze zpristupni ovladaci kontrakt. Vsechny prepinace odesilani
-- zustavaji vypnute a nevytvari se zadne potvrzeni ani odesilaci slot.
update public.complete_power_outage_notification_email_production_config
set production_activation_enabled = false, continuous_dispatch_enabled = false,
    metadata = metadata || jsonb_build_object(
      'liveActivationUiContract', 'complete-notification-email-production-live-ui-v1',
      'doubleConfirmationRequired', true, 'typedPhraseRequired', false,
      'installationActivatedSending', false, 'installedAt', now()
    ), updated_at = now()
where singleton;
update public.complete_power_outage_notification_email_state
set runtime_mode = case when planning_enabled then 'shadow' else 'paused' end,
    dispatch_enabled = false, updated_at = now()
where singleton;
update public.cpo_notification_email_production_safety_state
set live_signal_ingestion_enabled = false, updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (values
  ('TABLE'::text, 'short lived production activation intents exist'::text,
    to_regclass('public.cpo_notification_email_production_activation_intents') is not null),
  ('FUNCTION', 'first click prepares production activation without sending',
    to_regprocedure('public.prepare_cpo_notification_email_production_activation_v1()') is not null
    and pg_get_functiondef('public.prepare_cpo_notification_email_production_activation_v1()'::regprocedure) ilike '%sendingAttempted%false%'),
  ('FUNCTION', 'second click activates through a one time token',
    to_regprocedure('public.activate_cpo_notification_email_production_v1(uuid)') is not null),
  ('FUNCTION', 'admin production pause exists',
    to_regprocedure('public.pause_cpo_notification_email_production_v1(text)') is not null),
  ('GRANT', 'activation operations enforce administrator role',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%profile.role = ''admin''%'),
  ('GRANT', 'authenticated cannot enumerate activation tokens',
    not has_table_privilege('authenticated', 'public.cpo_notification_email_production_activation_intents', 'SELECT')),
  ('LOGIC', 'typed confirmation phrase is not required',
    pg_get_functiondef('public.get_cpo_notification_email_management_v3(integer)'::regprocedure) ilike '%typedPhraseRequired%false%'),
  ('LOGIC', 'confirmation token is short lived and single use',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%expires_at <= now()%'
    and pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%consumed_at is not null%'
    and pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%set consumed_at = now()%'
    and pg_get_functiondef('public.prepare_cpo_notification_email_production_activation_v1()'::regprocedure) ilike '%10 minutes%'
    and exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conname = 'cpo_production_activation_intent_expiry_check'
        and constraint_row.conrelid = 'public.cpo_notification_email_production_activation_intents'::regclass
        and constraint_row.convalidated
    )),
  ('LOGIC', 'second confirmation belongs to the same administrator',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%prepared_by <> actor_id%'),
  ('LOGIC', 'second confirmation repeats and compares SHADOW audit',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%run_cpo_notification_email_production_shadow_audit_v1%plan_set_fingerprint%'),
  ('LOGIC', 'LIVE enables production webhook safety ingestion',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) ilike '%live_signal_ingestion_enabled = true%'),
  ('ISOLATION', 'activation does not reference MARKET email objects',
    pg_get_functiondef('public.activate_cpo_notification_email_production_v1(uuid)'::regprocedure) not ilike '%market_client_email%'),
  ('SAFETY', 'installation leaves production dispatch disabled',
    exists (select 1 from public.complete_power_outage_notification_email_production_config c
      cross join public.complete_power_outage_notification_email_state s
      where c.singleton and s.singleton and not c.production_activation_enabled
        and not c.continuous_dispatch_enabled and not s.dispatch_enabled and s.runtime_mode <> 'live')),
  ('SAFETY', 'installation creates no activation confirmation',
    not exists (select 1 from public.cpo_notification_email_production_activation_intents)),
  ('STATE', 'two click activation UI contract is available while sending stays off',
    exists (select 1 from public.complete_power_outage_notification_email_production_config c
      where c.singleton and c.metadata ->> 'doubleConfirmationRequired' = 'true'
        and not c.production_activation_enabled and not c.continuous_dispatch_enabled))
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
