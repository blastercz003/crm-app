begin;

-- Krok 10.6: automaticka bezpecnostni pojistka budouciho LIVE pilotu.
-- Complaint, hard bounce a kriticka konfiguracni chyba zastavuji vetev
-- KOMPLETNI okamzite. Tri navazujici prechodne chyby ji zastavi take.
-- Instalace prijem LIVE signalu ani odesilani neaktivuje.
do $$
declare missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_plans') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email plans');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_suppression_events') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE suppression events');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE pilot allowlist state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_rate_limit_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE pilot rate state');
  end if;
  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro automaticke zastaveni pilotu KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_pilot_safety_state (
  singleton boolean primary key default true check (singleton),
  monitoring_enabled boolean not null default true,
  live_signal_ingestion_enabled boolean not null default false,
  auto_pause_enabled boolean not null default true,
  transient_failure_threshold integer not null default 3,
  transient_failure_window_seconds integer not null default 1800,
  consecutive_transient_failure_count integer not null default 0,
  first_transient_failure_at timestamptz,
  last_signal_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  is_paused boolean not null default false,
  paused_at timestamptz,
  pause_reason_code text,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id) on delete set null,
  rules_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_pilot_safety_ingestion_check check (not live_signal_ingestion_enabled),
  constraint cpo_pilot_safety_threshold_check check (transient_failure_threshold = 3),
  constraint cpo_pilot_safety_window_check check (transient_failure_window_seconds between 600 and 3600),
  constraint cpo_pilot_safety_counter_check check (consecutive_transient_failure_count >= 0),
  constraint cpo_pilot_safety_pause_check check (
    (not is_paused and paused_at is null and pause_reason_code is null)
    or (is_paused and paused_at is not null and nullif(btrim(pause_reason_code), '') is not null)
  ),
  constraint cpo_pilot_safety_rules_check check (rules_version > 0),
  constraint cpo_pilot_safety_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_notification_email_pilot_safety_state (
  singleton, monitoring_enabled, live_signal_ingestion_enabled,
  auto_pause_enabled, transient_failure_threshold,
  transient_failure_window_seconds, rules_version, metadata
) values (
  true, true, false, true, 3, 1800, 1,
  jsonb_build_object(
    'contract', 'complete-notification-email-pilot-auto-stop-v1',
    'marketEmailIsolation', true,
    'activationRequiresFutureMigration', true,
    'installedAt', now()
  )
)
on conflict (singleton) do update
set monitoring_enabled = true,
    live_signal_ingestion_enabled = false,
    auto_pause_enabled = true,
    transient_failure_threshold = 3,
    transient_failure_window_seconds = 1800,
    rules_version = 1,
    metadata = public.complete_power_outage_notification_email_pilot_safety_state.metadata
      || excluded.metadata,
    updated_at = now();

create table if not exists public.complete_power_outage_notification_email_pilot_safety_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_event_id text not null,
  environment text not null,
  signal_type text not null,
  plan_id uuid references public.complete_power_outage_notification_email_plans(id) on delete restrict,
  provider_message_id text,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_pilot_safety_event_source_check check (source in ('complete_worker', 'complete_resend_webhook')),
  constraint cpo_pilot_safety_event_environment_check check (environment = 'live'),
  constraint cpo_pilot_safety_event_type_check check (
    signal_type in ('delivery_success', 'transient_error', 'configuration_error', 'hard_bounce', 'complaint')
  ),
  constraint cpo_pilot_safety_event_id_check check (nullif(btrim(external_event_id), '') is not null),
  constraint cpo_pilot_safety_event_delivery_check check (
    signal_type not in ('delivery_success', 'hard_bounce', 'complaint')
    or (plan_id is not null and nullif(btrim(provider_message_id), '') is not null)
  ),
  constraint cpo_pilot_safety_event_error_check check (
    signal_type not in ('transient_error', 'configuration_error')
    or nullif(btrim(error_code), '') is not null
  ),
  constraint cpo_pilot_safety_event_payload_check check (jsonb_typeof(payload) = 'object'),
  unique (source, external_event_id)
);

create index if not exists cpo_pilot_safety_event_latest_idx
  on public.complete_power_outage_notification_email_pilot_safety_events (created_at desc);
create index if not exists cpo_pilot_safety_event_plan_idx
  on public.complete_power_outage_notification_email_pilot_safety_events (plan_id, created_at desc);

create or replace function public.prevent_cpo_notification_email_pilot_safety_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie bezpecnostnich signalu pilotu je nemenna.';
end;
$$;

drop trigger if exists cpo_pilot_safety_events_immutable
  on public.complete_power_outage_notification_email_pilot_safety_events;
create trigger cpo_pilot_safety_events_immutable
before update or delete on public.complete_power_outage_notification_email_pilot_safety_events
for each row execute function public.prevent_cpo_notification_email_pilot_safety_event_mutation();

create or replace function public.apply_cpo_notification_email_pilot_safety_signal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safety_state public.complete_power_outage_notification_email_pilot_safety_state%rowtype;
  next_failure_count integer := 0;
  next_first_failure_at timestamptz;
  should_pause boolean := false;
  pause_code text;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_auto_stop_v1', 0)
  );

  select * into safety_state
  from public.complete_power_outage_notification_email_pilot_safety_state
  where singleton for update;

  if safety_state.singleton is null or not safety_state.monitoring_enabled then
    raise exception 'Bezpecnostni monitoring pilotu neni aktivni.';
  end if;
  if not safety_state.live_signal_ingestion_enabled and not safety_state.is_paused then
    raise exception 'Prijem LIVE bezpecnostnich signalu neni aktivni.';
  end if;

  if new.signal_type = 'delivery_success' then
    update public.complete_power_outage_notification_email_pilot_safety_state
    set consecutive_transient_failure_count = 0,
        first_transient_failure_at = null,
        last_signal_at = new.created_at,
        last_success_at = new.created_at,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where singleton;
    return new;
  end if;

  if new.signal_type = 'transient_error' then
    if safety_state.first_transient_failure_at is null
       or safety_state.first_transient_failure_at
          + make_interval(secs => safety_state.transient_failure_window_seconds) < new.created_at
    then
      next_failure_count := 1;
      next_first_failure_at := new.created_at;
    else
      next_failure_count := safety_state.consecutive_transient_failure_count + 1;
      next_first_failure_at := safety_state.first_transient_failure_at;
    end if;
    should_pause := safety_state.auto_pause_enabled
      and next_failure_count >= safety_state.transient_failure_threshold;
    pause_code := case when should_pause then 'CONSECUTIVE_TRANSIENT_FAILURES' else null end;
  else
    next_failure_count := safety_state.consecutive_transient_failure_count;
    next_first_failure_at := safety_state.first_transient_failure_at;
    should_pause := safety_state.auto_pause_enabled
      and new.signal_type in ('configuration_error', 'hard_bounce', 'complaint');
    pause_code := case new.signal_type
      when 'configuration_error' then 'CRITICAL_CONFIGURATION_ERROR'
      when 'hard_bounce' then 'PROVIDER_HARD_BOUNCE'
      when 'complaint' then 'PROVIDER_COMPLAINT'
      else null
    end;
  end if;

  if new.signal_type in ('hard_bounce', 'complaint') then
    select * into selected_plan
    from public.complete_power_outage_notification_email_plans plan
    where plan.id = new.plan_id;

    if selected_plan.id is not null then
      insert into public.complete_power_outage_notification_email_suppression_events (
        normalized_email, action, source, reason, related_plan_id, evidence
      ) values (
        selected_plan.recipient_email,
        'suppress',
        case when new.signal_type = 'complaint' then 'provider_complaint' else 'provider_bounce' end,
        case when new.signal_type = 'complaint'
          then 'Prijemce oznacil zpravu KOMPLETNI jako nevyzadanou.'
          else 'Poskytovatel oznamil hard bounce zpravy KOMPLETNI.' end,
        selected_plan.id,
        jsonb_build_object(
          'contract', 'complete-notification-email-pilot-auto-stop-v1',
          'safetyEventId', new.id,
          'providerMessageId', new.provider_message_id
        )
      );
    end if;
  end if;

  update public.complete_power_outage_notification_email_pilot_safety_state
  set consecutive_transient_failure_count = next_failure_count,
      first_transient_failure_at = next_first_failure_at,
      last_signal_at = new.created_at,
      last_error_at = new.created_at,
      last_error_code = coalesce(nullif(btrim(new.error_code), ''), pause_code, upper(new.signal_type)),
      last_error_message = left(coalesce(nullif(btrim(new.error_message), ''), 'Bezpecnostni signal pilotu KOMPLETNI.'), 2000),
      is_paused = is_paused or should_pause,
      paused_at = case when should_pause then coalesce(paused_at, new.created_at) else paused_at end,
      pause_reason_code = case when should_pause then coalesce(pause_reason_code, pause_code) else pause_reason_code end,
      metadata = metadata || jsonb_build_object(
        'lastSafetyEventId', new.id,
        'lastSignalType', new.signal_type,
        'automaticPauseApplied', should_pause
      ),
      updated_at = now()
  where singleton;

  if should_pause then
    update public.complete_power_outage_notification_email_state
    set runtime_mode = 'paused',
        planning_enabled = false,
        dispatch_enabled = false,
        consecutive_failure_count = case when new.signal_type = 'transient_error' then next_failure_count else consecutive_failure_count end,
        last_error_at = new.created_at,
        last_error_code = pause_code,
        last_error_message = left(coalesce(nullif(btrim(new.error_message), ''), 'Pilotni rozesilani KOMPLETNI bylo automaticky zastaveno.'), 2000),
        metadata = metadata || jsonb_build_object(
          'pilotAutomaticallyPaused', true,
          'pilotAutomaticallyPausedAt', new.created_at,
          'pilotAutomaticPauseReason', pause_code,
          'pilotSafetyEventId', new.id
        ),
        updated_at = now()
    where singleton;

    update public.complete_power_outage_notification_email_pilot_allowlist_state
    set live_dispatch_enabled = false,
        metadata = metadata || jsonb_build_object('automaticallyPausedAt', new.created_at),
        updated_at = now()
    where singleton;

    update public.complete_power_outage_notification_email_pilot_rate_limit_state
    set reservation_enabled = false,
        metadata = metadata || jsonb_build_object('automaticallyPausedAt', new.created_at),
        updated_at = now()
    where singleton;
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_pilot_safety_signal_apply
  on public.complete_power_outage_notification_email_pilot_safety_events;
create trigger cpo_pilot_safety_signal_apply
after insert on public.complete_power_outage_notification_email_pilot_safety_events
for each row execute function public.apply_cpo_notification_email_pilot_safety_signal_v1();

alter table public.complete_power_outage_notification_email_pilot_safety_state enable row level security;
alter table public.complete_power_outage_notification_email_pilot_safety_events enable row level security;
revoke all on table public.complete_power_outage_notification_email_pilot_safety_state from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_safety_events from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_pilot_safety_state to service_role;
grant all on table public.complete_power_outage_notification_email_pilot_safety_events to service_role;

create or replace function public.record_cpo_notification_email_pilot_safety_event_v1(
  requested_source text,
  requested_external_event_id text,
  requested_signal_type text,
  requested_plan_id uuid default null,
  requested_provider_message_id text default null,
  requested_error_code text default null,
  requested_error_message text default null,
  requested_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  state_row public.complete_power_outage_notification_email_pilot_safety_state%rowtype;
  inserted_id uuid;
begin
  select * into state_row
  from public.complete_power_outage_notification_email_pilot_safety_state
  where singleton;

  if state_row.singleton is null or not state_row.monitoring_enabled
     or (not state_row.live_signal_ingestion_enabled and not state_row.is_paused)
  then
    return jsonb_build_object(
      'status', 'disabled', 'recorded', false,
      'automaticallyPaused', coalesce(state_row.is_paused, false)
    );
  end if;

  insert into public.complete_power_outage_notification_email_pilot_safety_events (
    source, external_event_id, environment, signal_type, plan_id,
    provider_message_id, error_code, error_message, payload
  ) values (
    lower(btrim(coalesce(requested_source, ''))),
    btrim(coalesce(requested_external_event_id, '')),
    'live',
    lower(btrim(coalesce(requested_signal_type, ''))),
    requested_plan_id,
    nullif(btrim(coalesce(requested_provider_message_id, '')), ''),
    nullif(btrim(coalesce(requested_error_code, '')), ''),
    nullif(btrim(coalesce(requested_error_message, '')), ''),
    coalesce(requested_payload, '{}'::jsonb)
  )
  on conflict (source, external_event_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('status', 'duplicate', 'recorded', false);
  end if;

  select * into state_row
  from public.complete_power_outage_notification_email_pilot_safety_state
  where singleton;

  return jsonb_build_object(
    'status', 'recorded', 'recorded', true, 'eventId', inserted_id,
    'automaticallyPaused', state_row.is_paused,
    'pauseReasonCode', state_row.pause_reason_code
  );
end;
$$;

-- Potvrzeni incidentu pouze uvolni bezpecnostni latch. Nikdy samo znovu
-- nezapne planovani, rezervace, LIVE rezim ani odesilani.
create or replace function public.acknowledge_cpo_notification_email_pilot_pause_v1(
  requested_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare note_value text := nullif(btrim(coalesce(requested_note, '')), '');
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Incident pilotu muze potvrdit pouze administrator.';
  end if;
  if note_value is null then
    raise exception 'Pro potvrzeni incidentu je vyzadovana poznamka.';
  end if;

  update public.complete_power_outage_notification_email_pilot_safety_state
  set is_paused = false,
      paused_at = null,
      pause_reason_code = null,
      consecutive_transient_failure_count = 0,
      first_transient_failure_at = null,
      acknowledged_at = now(),
      acknowledged_by = auth.uid(),
      metadata = metadata || jsonb_build_object(
        'lastAcknowledgementNote', note_value,
        'lastAcknowledgedAt', now(),
        'manualReactivationPerformed', false
      ),
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'status', 'acknowledged',
    'planningEnabled', false,
    'reservationEnabled', false,
    'dispatchEnabled', false,
    'manualReactivationRequired', true
  );
end;
$$;

create or replace function public.get_cpo_notification_email_pilot_safety_summary_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Bezpecnostni stav pilotu je dostupny pouze administratorum.';
  end if;

  select jsonb_build_object(
    'contract', 'complete-notification-email-pilot-auto-stop-v1',
    'monitoringEnabled', safety.monitoring_enabled,
    'liveSignalIngestionEnabled', safety.live_signal_ingestion_enabled,
    'autoPauseEnabled', safety.auto_pause_enabled,
    'transientFailureThreshold', safety.transient_failure_threshold,
    'consecutiveTransientFailureCount', safety.consecutive_transient_failure_count,
    'isPaused', safety.is_paused,
    'pausedAt', safety.paused_at,
    'pauseReasonCode', safety.pause_reason_code,
    'lastSignalAt', safety.last_signal_at,
    'lastErrorCode', safety.last_error_code,
    'lastErrorMessage', safety.last_error_message,
    'recentSignals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'signalType', recent.signal_type,
        'errorCode', recent.error_code,
        'createdAt', recent.created_at
      ) order by recent.created_at desc)
      from (
        select event.signal_type, event.error_code, event.created_at
        from public.complete_power_outage_notification_email_pilot_safety_events event
        order by event.created_at desc limit 20
      ) recent
    ), '[]'::jsonb),
    'planningEnabled', email_state.planning_enabled,
    'dispatchEnabled', email_state.dispatch_enabled,
    'rateReservationEnabled', rate_state.reservation_enabled
  ) into result
  from public.complete_power_outage_notification_email_pilot_safety_state safety
  cross join public.complete_power_outage_notification_email_state email_state
  cross join public.complete_power_outage_notification_email_pilot_rate_limit_state rate_state
  where safety.singleton and email_state.singleton and rate_state.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.prevent_cpo_notification_email_pilot_safety_event_mutation() from public, anon, authenticated;
revoke all on function public.apply_cpo_notification_email_pilot_safety_signal_v1() from public, anon, authenticated;
revoke all on function public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.acknowledge_cpo_notification_email_pilot_pause_v1(text) from public, anon;
revoke all on function public.get_cpo_notification_email_pilot_safety_summary_v1() from public, anon;
grant execute on function public.prevent_cpo_notification_email_pilot_safety_event_mutation() to service_role;
grant execute on function public.apply_cpo_notification_email_pilot_safety_signal_v1() to service_role;
grant execute on function public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb) to service_role;
grant execute on function public.acknowledge_cpo_notification_email_pilot_pause_v1(text) to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_pilot_safety_summary_v1() to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set auto_pause_after_failures = 3,
    metadata = metadata || jsonb_build_object(
      'pilotAutoStopContract', 'complete-notification-email-pilot-auto-stop-v1',
      'pilotAutoStopEnabled', true,
      'pilotLiveSignalIngestionEnabled', false,
      'pilotImmediateStopSignals', jsonb_build_array('complaint', 'hard_bounce', 'configuration_error'),
      'pilotTransientFailureThreshold', 3,
      'pilotAutoStopInstalledAt', now()
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
