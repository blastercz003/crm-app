begin;

-- Ostry provoz KOMPLETNI, krok 6: produkcni webhook a samostatna
-- bezpecnostni pojistka. Pouziva existujici podepsany COMPLETE webhook;
-- instalace prijem LIVE signalu ani odesilani neaktivuje.
do $$
begin
  if to_regclass('public.cpo_notification_email_production_outcomes') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regclass('public.complete_power_outage_notification_email_state') is null
    or to_regclass('public.complete_power_outage_notification_email_plans') is null
    or to_regclass('public.complete_power_outage_notification_email_suppression_events') is null then
    raise exception 'Chybi zavislosti pro produkcni webhook KOMPLETNI.';
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
    raise exception 'Pred instalaci produkcniho webhooku musi byt odesilani KOMPLETNI vypnute.';
  end if;
end
$$;

create table if not exists public.cpo_notification_email_production_safety_state (
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
  constraint cpo_production_safety_step6_ingestion_check check (
    not live_signal_ingestion_enabled
  ),
  constraint cpo_production_safety_threshold_check check (
    transient_failure_threshold = 3
  ),
  constraint cpo_production_safety_window_check check (
    transient_failure_window_seconds between 600 and 3600
  ),
  constraint cpo_production_safety_counter_check check (
    consecutive_transient_failure_count >= 0
  ),
  constraint cpo_production_safety_pause_check check (
    (not is_paused and paused_at is null and pause_reason_code is null)
    or (is_paused and paused_at is not null and nullif(btrim(pause_reason_code), '') is not null)
  ),
  constraint cpo_production_safety_rules_check check (rules_version > 0),
  constraint cpo_production_safety_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.cpo_notification_email_production_safety_state (
  singleton, monitoring_enabled, live_signal_ingestion_enabled,
  auto_pause_enabled, transient_failure_threshold,
  transient_failure_window_seconds, rules_version, metadata
) values (
  true, true, false, true, 3, 1800, 1,
  jsonb_build_object(
    'contract', 'complete-notification-email-production-safety-v1',
    'existingCompleteWebhookReused', true,
    'marketEmailIsolation', true,
    'activationRequiresFutureStep', true,
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
    metadata = public.cpo_notification_email_production_safety_state.metadata
      || excluded.metadata,
    updated_at = now();

create table if not exists public.cpo_notification_email_production_safety_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_event_id text not null,
  signal_type text not null,
  plan_id uuid references public.complete_power_outage_notification_email_plans(id) on delete restrict,
  provider_message_id text,
  error_code text,
  error_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_production_safety_event_source_check check (
    source in ('complete_production_worker', 'complete_resend_webhook')
  ),
  constraint cpo_production_safety_event_type_check check (
    signal_type in (
      'delivery_success', 'transient_error', 'configuration_error',
      'hard_bounce', 'complaint'
    )
  ),
  constraint cpo_production_safety_event_id_check check (
    nullif(btrim(external_event_id), '') is not null
  ),
  constraint cpo_production_safety_event_delivery_check check (
    signal_type not in ('delivery_success', 'hard_bounce', 'complaint')
    or (plan_id is not null and nullif(btrim(provider_message_id), '') is not null)
  ),
  constraint cpo_production_safety_event_error_check check (
    signal_type not in ('transient_error', 'configuration_error')
    or nullif(btrim(error_code), '') is not null
  ),
  constraint cpo_production_safety_event_payload_check check (
    jsonb_typeof(payload) = 'object'
  ),
  unique (source, external_event_id)
);

create index if not exists cpo_production_safety_event_latest_idx
  on public.cpo_notification_email_production_safety_events(created_at desc);
create index if not exists cpo_production_safety_event_plan_idx
  on public.cpo_notification_email_production_safety_events(plan_id, created_at desc);

create or replace function public.prevent_cpo_notification_email_production_safety_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie produkcnich bezpecnostnich signalu KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_production_safety_events_immutable
  on public.cpo_notification_email_production_safety_events;
create trigger cpo_production_safety_events_immutable
before update or delete on public.cpo_notification_email_production_safety_events
for each row execute function
  public.prevent_cpo_notification_email_production_safety_mutation_v1();

create or replace function public.apply_cpo_notification_email_production_safety_signal_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safety_state public.cpo_notification_email_production_safety_state%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  next_failure_count integer := 0;
  next_first_failure_at timestamptz;
  should_pause boolean := false;
  pause_code text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_safety_v1', 0)
  );

  select * into safety_state
  from public.cpo_notification_email_production_safety_state
  where singleton for update;

  if safety_state.singleton is null or not safety_state.monitoring_enabled then
    raise exception 'Produkční bezpečnostní monitoring KOMPLETNI neni aktivni.';
  end if;
  if not safety_state.live_signal_ingestion_enabled and not safety_state.is_paused then
    raise exception 'Prijem produkcnich LIVE signalu KOMPLETNI neni aktivni.';
  end if;

  if new.signal_type = 'delivery_success' then
    update public.cpo_notification_email_production_safety_state
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
        + make_interval(secs => safety_state.transient_failure_window_seconds) < new.created_at then
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
        case when new.signal_type = 'complaint'
          then 'provider_complaint' else 'provider_bounce' end,
        case when new.signal_type = 'complaint'
          then 'Prijemce oznacil produkcni zpravu KOMPLETNI jako nevyzadanou.'
          else 'Poskytovatel oznamil hard bounce produkcni zpravy KOMPLETNI.' end,
        selected_plan.id,
        jsonb_build_object(
          'contract', 'complete-notification-email-production-safety-v1',
          'safetyEventId', new.id,
          'providerMessageId', new.provider_message_id
        )
      );
    end if;
  end if;

  update public.cpo_notification_email_production_safety_state
  set live_signal_ingestion_enabled = case
        when should_pause then false else live_signal_ingestion_enabled end,
      consecutive_transient_failure_count = next_failure_count,
      first_transient_failure_at = next_first_failure_at,
      last_signal_at = new.created_at,
      last_error_at = new.created_at,
      last_error_code = coalesce(nullif(btrim(new.error_code), ''), pause_code, upper(new.signal_type)),
      last_error_message = left(coalesce(
        nullif(btrim(new.error_message), ''),
        'Bezpecnostni signal produkcniho odesilani KOMPLETNI.'
      ), 2000),
      is_paused = is_paused or should_pause,
      paused_at = case when should_pause then coalesce(paused_at, new.created_at) else paused_at end,
      pause_reason_code = case when should_pause
        then coalesce(pause_reason_code, pause_code) else pause_reason_code end,
      metadata = metadata || jsonb_build_object(
        'lastSafetyEventId', new.id,
        'lastSignalType', new.signal_type,
        'automaticPauseApplied', should_pause
      ),
      updated_at = now()
  where singleton;

  if should_pause then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        production_activation_enabled = false,
        continuous_planning_enabled = false,
        continuous_dispatch_enabled = false,
        metadata = metadata || jsonb_build_object(
          'automaticallyPaused', true,
          'automaticallyPausedAt', new.created_at,
          'automaticPauseReason', pause_code,
          'productionSafetyEventId', new.id
        ),
        updated_at = now()
    where singleton;

    update public.complete_power_outage_notification_email_state
    set runtime_mode = 'paused',
        planning_enabled = false,
        dispatch_enabled = false,
        last_error_at = new.created_at,
        last_error_code = pause_code,
        last_error_message = left(coalesce(
          nullif(btrim(new.error_message), ''),
          'Produkční rozesilani KOMPLETNI bylo automaticky zastaveno.'
        ), 2000),
        metadata = metadata || jsonb_build_object(
          'productionAutomaticallyPaused', true,
          'productionAutomaticallyPausedAt', new.created_at,
          'productionAutomaticPauseReason', pause_code,
          'productionSafetyEventId', new.id
        ),
        updated_at = now()
    where singleton;
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_production_safety_signal_apply
  on public.cpo_notification_email_production_safety_events;
create trigger cpo_production_safety_signal_apply
after insert on public.cpo_notification_email_production_safety_events
for each row execute function
  public.apply_cpo_notification_email_production_safety_signal_v1();

create or replace function public.record_cpo_notification_email_production_safety_event_v1(
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
  state_row public.cpo_notification_email_production_safety_state%rowtype;
  inserted_id uuid;
begin
  select * into state_row
  from public.cpo_notification_email_production_safety_state
  where singleton;

  if state_row.singleton is null or not state_row.monitoring_enabled
    or (not state_row.live_signal_ingestion_enabled and not state_row.is_paused) then
    return jsonb_build_object(
      'status', 'disabled', 'recorded', false,
      'automaticallyPaused', coalesce(state_row.is_paused, false)
    );
  end if;

  insert into public.cpo_notification_email_production_safety_events (
    source, external_event_id, signal_type, plan_id, provider_message_id,
    error_code, error_message, payload
  ) values (
    lower(btrim(coalesce(requested_source, ''))),
    btrim(coalesce(requested_external_event_id, '')),
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
  from public.cpo_notification_email_production_safety_state
  where singleton;
  return jsonb_build_object(
    'status', 'recorded', 'recorded', true,
    'eventId', inserted_id,
    'automaticallyPaused', state_row.is_paused,
    'pauseReasonCode', state_row.pause_reason_code
  );
end;
$$;

create or replace function public.record_cpo_notification_email_production_resend_event_v1(
  requested_provider_event_id text,
  requested_provider_message_id text,
  requested_event_kind text,
  requested_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  selected_plan_id uuid;
  signal_type text;
begin
  select outcome.plan_id into selected_plan_id
  from public.cpo_notification_email_production_outcomes outcome
  where outcome.outcome = 'sent'
    and outcome.provider_message_id = nullif(btrim(requested_provider_message_id), '');

  if selected_plan_id is null then
    return jsonb_build_object('status', 'ignored', 'recorded', false);
  end if;

  signal_type := case requested_event_kind
    when 'email.delivered' then 'delivery_success'
    when 'email.bounced' then 'hard_bounce'
    when 'email.complained' then 'complaint'
    when 'email.failed' then 'transient_error'
    when 'email.delivery_delayed' then 'transient_error'
    when 'email.suppressed' then 'hard_bounce'
    else null
  end;
  if signal_type is null then
    return jsonb_build_object('status', 'ignored', 'recorded', false);
  end if;

  return public.record_cpo_notification_email_production_safety_event_v1(
    'complete_resend_webhook',
    requested_provider_event_id,
    signal_type,
    selected_plan_id,
    requested_provider_message_id,
    case when signal_type = 'transient_error'
      then upper(replace(requested_event_kind, '.', '_')) else null end,
    case when signal_type = 'transient_error'
      then 'Resend oznamil prechodny problem produkcni zpravy KOMPLETNI.' else null end,
    coalesce(requested_payload, '{}'::jsonb)
  );
end;
$$;

create or replace function public.acknowledge_cpo_notification_email_production_pause_v1(
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
    raise exception 'Produkční incident muze potvrdit pouze administrator.';
  end if;
  if note_value is null then
    raise exception 'Doplnte poznamku k potvrzeni incidentu.';
  end if;

  update public.cpo_notification_email_production_safety_state
  set is_paused = false,
      paused_at = null,
      pause_reason_code = null,
      consecutive_transient_failure_count = 0,
      first_transient_failure_at = null,
      acknowledged_at = now(),
      acknowledged_by = auth.uid(),
      metadata = metadata || jsonb_build_object(
        'lastAcknowledgementAt', now(),
        'lastAcknowledgementBy', auth.uid(),
        'lastAcknowledgementNote', left(note_value, 1000),
        'sendingReactivated', false
      ),
      updated_at = now()
  where singleton and is_paused;

  return jsonb_build_object(
    'status', case when found then 'acknowledged' else 'not_paused' end,
    'sendingReactivated', false
  );
end;
$$;

create or replace function public.get_cpo_notification_email_production_safety_v1()
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
    raise exception 'Produkční bezpečnostní stav je dostupny pouze administratorum.';
  end if;

  select jsonb_build_object(
    'monitoringEnabled', state_row.monitoring_enabled,
    'liveSignalIngestionEnabled', state_row.live_signal_ingestion_enabled,
    'autoPauseEnabled', state_row.auto_pause_enabled,
    'isPaused', state_row.is_paused,
    'pauseReasonCode', state_row.pause_reason_code,
    'consecutiveTransientFailureCount', state_row.consecutive_transient_failure_count,
    'transientFailureThreshold', state_row.transient_failure_threshold,
    'lastSignalAt', state_row.last_signal_at,
    'lastSuccessAt', state_row.last_success_at,
    'lastErrorAt', state_row.last_error_at,
    'lastErrorCode', state_row.last_error_code,
    'lastErrorMessage', state_row.last_error_message
  ) into result
  from public.cpo_notification_email_production_safety_state state_row
  where singleton;
  return coalesce(result, '{}'::jsonb);
end;
$$;

alter table public.cpo_notification_email_production_safety_state enable row level security;
alter table public.cpo_notification_email_production_safety_events enable row level security;
revoke all on table public.cpo_notification_email_production_safety_state
  from public, anon, authenticated;
revoke all on table public.cpo_notification_email_production_safety_events
  from public, anon, authenticated;
grant all on table public.cpo_notification_email_production_safety_state to service_role;
grant all on table public.cpo_notification_email_production_safety_events to service_role;

revoke all on function public.prevent_cpo_notification_email_production_safety_mutation_v1()
  from public, anon, authenticated;
revoke all on function public.apply_cpo_notification_email_production_safety_signal_v1()
  from public, anon, authenticated;
revoke all on function public.record_cpo_notification_email_production_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.acknowledge_cpo_notification_email_production_pause_v1(text)
  from public, anon;
revoke all on function public.get_cpo_notification_email_production_safety_v1()
  from public, anon;

grant execute on function public.prevent_cpo_notification_email_production_safety_mutation_v1()
  to service_role;
grant execute on function public.apply_cpo_notification_email_production_safety_signal_v1()
  to service_role;
grant execute on function public.record_cpo_notification_email_production_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)
  to service_role;
grant execute on function public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)
  to service_role;
grant execute on function public.acknowledge_cpo_notification_email_production_pause_v1(text)
  to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_production_safety_v1()
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

with definitions as (
  select
    pg_get_functiondef(
      'public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)'::regprocedure
    ) as webhook_definition,
    pg_get_functiondef(
      'public.apply_cpo_notification_email_production_safety_signal_v1()'::regprocedure
    ) as safety_definition,
    pg_get_functiondef(
      'public.acknowledge_cpo_notification_email_production_pause_v1(text)'::regprocedure
    ) as acknowledge_definition
), audit as (
  select 'TABLE'::text as check_type,
    'independent production safety state and events exist'::text as object_name,
    to_regclass('public.cpo_notification_email_production_safety_state') is not null
      and to_regclass('public.cpo_notification_email_production_safety_events') is not null as is_correct

  union all
  select 'FUNCTION', 'idempotent production Resend event recording exists',
    to_regprocedure('public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)') is not null

  union all
  select 'FUNCTION', 'admin production incident acknowledgement exists',
    to_regprocedure('public.acknowledge_cpo_notification_email_production_pause_v1(text)') is not null

  union all
  select 'GRANT', 'authenticated cannot inject production safety signals',
    not has_function_privilege(
      'authenticated',
      'public.record_cpo_notification_email_production_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)',
      'EXECUTE'
    )
      and not has_function_privilege(
        'authenticated',
        'public.record_cpo_notification_email_production_resend_event_v1(text,text,text,jsonb)',
        'EXECUTE'
      )

  union all
  select 'GRANT', 'production incident acknowledgement enforces administrator role',
    acknowledge_definition ilike '%profile.role = ''admin''%'
  from definitions

  union all
  select 'LOGIC', 'production webhook accepts only recorded production message IDs',
    webhook_definition ilike '%cpo_notification_email_production_outcomes%'
      and webhook_definition ilike '%provider_message_id%'
      and webhook_definition ilike '%outcome = ''sent''%'
  from definitions

  union all
  select 'LOGIC', 'delivery resets transient production failure streak',
    safety_definition ilike '%signal_type = ''delivery_success''%'
      and safety_definition ilike '%consecutive_transient_failure_count = 0%'
  from definitions

  union all
  select 'LOGIC', 'three transient failures stop production dispatch',
    safety_definition ilike '%transient_failure_threshold%'
      and safety_definition ilike '%configuration_status = ''paused''%'
      and safety_definition ilike '%continuous_dispatch_enabled = false%'
  from definitions

  union all
  select 'LOGIC', 'complaint hard bounce and configuration error stop immediately',
    safety_definition ilike '%configuration_error%'
      and safety_definition ilike '%hard_bounce%'
      and safety_definition ilike '%complaint%'
      and safety_definition ilike '%should_pause%'
  from definitions

  union all
  select 'LOGIC', 'complaint and hard bounce suppress future COMPLETE plans',
    safety_definition ilike '%complete_power_outage_notification_email_suppression_events%'
      and safety_definition ilike '%provider_complaint%'
      and safety_definition ilike '%provider_bounce%'
  from definitions

  union all
  select 'RLS', 'production safety tables have row level security',
    (select relrowsecurity from pg_class where oid =
      'public.cpo_notification_email_production_safety_state'::regclass)
      and (select relrowsecurity from pg_class where oid =
        'public.cpo_notification_email_production_safety_events'::regclass)

  union all
  select 'ISOLATION', 'production webhook does not reference MARKET email objects',
    webhook_definition not ilike '%market_email%'
      and safety_definition not ilike '%market_email%'
  from definitions

  union all
  select 'SAFETY', 'production safety event history starts empty',
    not exists (select 1 from public.cpo_notification_email_production_safety_events)

  union all
  select 'SAFETY', 'step six leaves production dispatch and signal ingestion disabled',
    not config.production_activation_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.dispatch_enabled
      and not safety_state.live_signal_ingestion_enabled
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  cross join public.cpo_notification_email_production_safety_state safety_state
  where config.singleton and email_state.singleton and safety_state.singleton

  union all
  select 'SAFETY', 'incident acknowledgement never reactivates sending',
    acknowledge_definition not ilike '%dispatch_enabled = true%'
      and acknowledge_definition ilike '%sendingReactivated'', false%'
  from definitions

  union all
  select 'STATE', 'existing signed COMPLETE webhook can be reused',
    metadata ->> 'existingCompleteWebhookReused' = 'true'
  from public.cpo_notification_email_production_safety_state
  where singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
