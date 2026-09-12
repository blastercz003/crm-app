begin;

-- Krok 10.5: nezavisla limitacni brana pro budouci LIVE pilot KOMPLETNI.
-- Limit je 3 zpravy za kalendarni den v Europe/Prague a nejmene 10 minut
-- mezi rezervacemi. Instalace branu neaktivuje a nic neodesila.
do $$
declare missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot allowlist state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_events') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot allowlist events');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'effective pilot allowlist');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email state');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    missing_dependencies := array_append(missing_dependencies, 'extensions.digest');
  end if;
  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro limitaci pilotu KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_pilot_rate_limit_state (
  singleton boolean primary key default true check (singleton),
  enforcement_enabled boolean not null default true,
  reservation_enabled boolean not null default false,
  daily_send_limit integer not null default 3,
  hard_daily_send_limit integer not null default 3,
  minimum_interval_seconds integer not null default 600,
  reservation_lease_seconds integer not null default 120,
  accounting_timezone text not null default 'Europe/Prague',
  rules_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_pilot_rate_daily_limit_check check (
    daily_send_limit between 1 and 3
    and hard_daily_send_limit = 3
    and daily_send_limit <= hard_daily_send_limit
  ),
  constraint cpo_pilot_rate_interval_check check (minimum_interval_seconds >= 600),
  constraint cpo_pilot_rate_lease_check check (reservation_lease_seconds between 30 and 300),
  constraint cpo_pilot_rate_timezone_check check (accounting_timezone = 'Europe/Prague'),
  constraint cpo_pilot_rate_activation_check check (not reservation_enabled),
  constraint cpo_pilot_rate_rules_check check (rules_version > 0),
  constraint cpo_pilot_rate_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_notification_email_pilot_rate_limit_state (
  singleton, enforcement_enabled, reservation_enabled, daily_send_limit,
  hard_daily_send_limit, minimum_interval_seconds, reservation_lease_seconds,
  accounting_timezone, rules_version, metadata
) values (
  true, true, false, 3, 3, 600, 120, 'Europe/Prague', 1,
  jsonb_build_object(
    'contract', 'complete-notification-email-pilot-rate-limit-v1',
    'activationRequiresFutureMigration', true,
    'sendingAttempted', false,
    'installedAt', now()
  )
)
on conflict (singleton) do update
set enforcement_enabled = true,
    reservation_enabled = false,
    daily_send_limit = least(
      public.complete_power_outage_notification_email_pilot_rate_limit_state.daily_send_limit,
      3
    ),
    hard_daily_send_limit = 3,
    minimum_interval_seconds = greatest(
      public.complete_power_outage_notification_email_pilot_rate_limit_state.minimum_interval_seconds,
      600
    ),
    reservation_lease_seconds = public.complete_power_outage_notification_email_pilot_rate_limit_state.reservation_lease_seconds,
    accounting_timezone = 'Europe/Prague',
    rules_version = 1,
    metadata = public.complete_power_outage_notification_email_pilot_rate_limit_state.metadata
      || excluded.metadata,
    updated_at = now();

create unique index if not exists cpo_pilot_allowlist_event_plan_identity_idx
  on public.complete_power_outage_notification_email_pilot_allowlist_events (id, plan_id);

create table if not exists public.complete_power_outage_notification_email_pilot_send_slots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  ico_snapshot text not null,
  plan_fingerprint text not null,
  allowlist_event_id uuid not null,
  claim_token_hash text not null,
  accounting_date date not null,
  reserved_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_pilot_send_slot_plan_ico_fkey
    foreign key (plan_id, ico_snapshot)
    references public.complete_power_outage_notification_email_plans(id, ico) on delete restrict,
  constraint cpo_pilot_send_slot_allowlist_fkey
    foreign key (allowlist_event_id, plan_id)
    references public.complete_power_outage_notification_email_pilot_allowlist_events(id, plan_id)
    on delete restrict,
  constraint cpo_pilot_send_slot_ico_check check (ico_snapshot ~ '^[0-9]{8}$'),
  constraint cpo_pilot_send_slot_fingerprint_check check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_pilot_send_slot_token_check check (claim_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cpo_pilot_send_slot_lease_check check (
    lease_expires_at > reserved_at and lease_expires_at <= reserved_at + interval '5 minutes'
  ),
  constraint cpo_pilot_send_slot_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_pilot_send_slot_identity_idx
  on public.complete_power_outage_notification_email_pilot_send_slots (id, plan_id);
create index if not exists cpo_pilot_send_slot_daily_idx
  on public.complete_power_outage_notification_email_pilot_send_slots (accounting_date, reserved_at);
create index if not exists cpo_pilot_send_slot_plan_idx
  on public.complete_power_outage_notification_email_pilot_send_slots (plan_id, reserved_at desc);

create table if not exists public.complete_power_outage_notification_email_pilot_send_outcomes (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique,
  plan_id uuid not null,
  outcome text not null,
  provider_message_id text,
  reason_code text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_pilot_send_outcome_slot_plan_fkey
    foreign key (slot_id, plan_id)
    references public.complete_power_outage_notification_email_pilot_send_slots(id, plan_id)
    on delete restrict,
  constraint cpo_pilot_send_outcome_kind_check check (outcome in ('sent', 'released')),
  constraint cpo_pilot_send_outcome_provider_check check (
    (outcome = 'sent' and nullif(btrim(provider_message_id), '') is not null)
    or (outcome = 'released' and provider_message_id is null)
  ),
  constraint cpo_pilot_send_outcome_reason_check check (btrim(reason_code) <> ''),
  constraint cpo_pilot_send_outcome_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_pilot_send_outcome_sent_plan_idx
  on public.complete_power_outage_notification_email_pilot_send_outcomes (plan_id)
  where outcome = 'sent';

create or replace view public.complete_power_outage_notification_email_pilot_send_ledger_v1
with (security_invoker = true)
as
select
  slot.id as slot_id,
  slot.plan_id,
  slot.ico_snapshot as ico,
  slot.accounting_date,
  slot.reserved_at,
  slot.lease_expires_at,
  outcome.outcome,
  outcome.provider_message_id,
  outcome.reason_code,
  outcome.created_at as finished_at,
  outcome.outcome = 'sent' as consumes_daily_limit,
  outcome.id is null and slot.lease_expires_at > now() as active_reservation,
  outcome.id is null and slot.lease_expires_at <= now() as expired_reservation
from public.complete_power_outage_notification_email_pilot_send_slots slot
left join public.complete_power_outage_notification_email_pilot_send_outcomes outcome
  on outcome.slot_id = slot.id and outcome.plan_id = slot.plan_id;

create or replace function public.guard_cpo_notification_email_pilot_send_slot_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_state public.complete_power_outage_notification_email_pilot_rate_limit_state%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  allowlist_state public.complete_power_outage_notification_email_pilot_allowlist_state%rowtype;
  active_entry public.complete_power_outage_notification_email_pilot_allowlist_v1%rowtype;
  used_count integer;
  latest_gate_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_rate_limit_v1', 0)
  );

  select * into rate_state
  from public.complete_power_outage_notification_email_pilot_rate_limit_state
  where singleton for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state where singleton;
  select * into allowlist_state
  from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton;

  if rate_state.singleton is null or not rate_state.enforcement_enabled
     or not rate_state.reservation_enabled
     or email_state.singleton is null or email_state.runtime_mode <> 'live'
     or not email_state.dispatch_enabled
     or allowlist_state.singleton is null or not allowlist_state.live_dispatch_enabled
  then
    raise exception 'Novy odesilaci slot nelze vytvorit mimo aktivni bezpecny LIVE pilot.';
  end if;

  select * into active_entry
  from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
  where entry.plan_id = new.plan_id
    and entry.allowlist_event_id = new.allowlist_event_id
    and entry.ico = new.ico_snapshot
    and entry.active_and_eligible_now;

  if active_entry.plan_id is null
     or new.plan_fingerprint is distinct from public.cpo_notification_email_plan_fingerprint_v1(new.plan_id)
  then
    raise exception 'Odesilaci slot musi patrit aktivnimu a platnemu allowlistu.';
  end if;

  if new.accounting_date <> (clock_timestamp() at time zone 'Europe/Prague')::date
     or new.reserved_at < clock_timestamp() - interval '5 seconds'
     or new.reserved_at > clock_timestamp() + interval '5 seconds'
     or new.lease_expires_at <> new.reserved_at + make_interval(secs => rate_state.reservation_lease_seconds)
  then
    raise exception 'Odesilaci slot nema platne casove parametry.';
  end if;

  if exists (
    select 1 from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
    where ledger.plan_id = new.plan_id
      and (ledger.consumes_daily_limit or ledger.active_reservation)
  ) then
    raise exception 'Pro konkretni oznameni uz existuje odeslani nebo aktivni rezervace.';
  end if;

  select count(*)::integer, max(gate_at)
  into used_count, latest_gate_at
  from (
    select case when ledger.consumes_daily_limit then coalesce(ledger.finished_at, ledger.reserved_at)
                else ledger.reserved_at end as gate_at
    from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
    where ledger.accounting_date = new.accounting_date
      and (ledger.consumes_daily_limit or ledger.active_reservation)
  ) gate;

  if used_count >= rate_state.daily_send_limit then
    raise exception 'Byl dosazen denni limit pilotniho odesilani.';
  end if;
  if latest_gate_at is not null
     and latest_gate_at + make_interval(secs => rate_state.minimum_interval_seconds) > new.reserved_at
  then
    raise exception 'Minimalni interval mezi pilotnimi odeslanimi jeste neuplynul.';
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_pilot_send_slot_insert_guard
  on public.complete_power_outage_notification_email_pilot_send_slots;
create trigger cpo_pilot_send_slot_insert_guard
before insert on public.complete_power_outage_notification_email_pilot_send_slots
for each row execute function public.guard_cpo_notification_email_pilot_send_slot_insert();

create or replace function public.prevent_cpo_notification_email_pilot_rate_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie limitacnich slotu pilotu je nemenna.';
end;
$$;

drop trigger if exists cpo_pilot_send_slots_immutable
  on public.complete_power_outage_notification_email_pilot_send_slots;
create trigger cpo_pilot_send_slots_immutable
before update or delete on public.complete_power_outage_notification_email_pilot_send_slots
for each row execute function public.prevent_cpo_notification_email_pilot_rate_history_mutation();

drop trigger if exists cpo_pilot_send_outcomes_immutable
  on public.complete_power_outage_notification_email_pilot_send_outcomes;
create trigger cpo_pilot_send_outcomes_immutable
before update or delete on public.complete_power_outage_notification_email_pilot_send_outcomes
for each row execute function public.prevent_cpo_notification_email_pilot_rate_history_mutation();

alter table public.complete_power_outage_notification_email_pilot_rate_limit_state enable row level security;
alter table public.complete_power_outage_notification_email_pilot_send_slots enable row level security;
alter table public.complete_power_outage_notification_email_pilot_send_outcomes enable row level security;

revoke all on table public.complete_power_outage_notification_email_pilot_rate_limit_state from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_send_slots from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_send_outcomes from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_send_ledger_v1 from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_pilot_rate_limit_state to service_role;
grant all on table public.complete_power_outage_notification_email_pilot_send_slots to service_role;
grant all on table public.complete_power_outage_notification_email_pilot_send_outcomes to service_role;
grant select on table public.complete_power_outage_notification_email_pilot_send_ledger_v1 to service_role;

-- Budouci worker ziska slot pouze touto atomickou funkci. V tomto kroku je
-- reservation_enabled databazovou podminkou napevno false, takze funkce pouze
-- vrati disabled a nemuze vytvorit zadnou rezervaci.
create or replace function public.reserve_cpo_notification_email_pilot_slot_v1(
  requested_plan_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  rate_state public.complete_power_outage_notification_email_pilot_rate_limit_state%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  allowlist_state public.complete_power_outage_notification_email_pilot_allowlist_state%rowtype;
  allowlist_entry public.complete_power_outage_notification_email_pilot_allowlist_v1%rowtype;
  claim_token uuid := gen_random_uuid();
  slot_id uuid;
  today_prague date := (now() at time zone 'Europe/Prague')::date;
  consumed_or_reserved_count integer;
  latest_gate_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_rate_limit_v1', 0)
  );

  select * into rate_state
  from public.complete_power_outage_notification_email_pilot_rate_limit_state
  where singleton for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state where singleton;
  select * into allowlist_state
  from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton;

  if rate_state.singleton is null or not rate_state.enforcement_enabled
     or not rate_state.reservation_enabled
  then
    return jsonb_build_object(
      'status', 'disabled', 'reserved', false,
      'sendingAttempted', false, 'liveDispatchEnabled', false
    );
  end if;

  if email_state.singleton is null or email_state.runtime_mode <> 'live'
     or not email_state.dispatch_enabled
     or allowlist_state.singleton is null or not allowlist_state.live_dispatch_enabled
  then
    return jsonb_build_object(
      'status', 'live_disabled', 'reserved', false,
      'sendingAttempted', false, 'liveDispatchEnabled', false
    );
  end if;

  select * into allowlist_entry
  from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
  where entry.plan_id = requested_plan_id and entry.active_and_eligible_now;
  if allowlist_entry.plan_id is null then
    return jsonb_build_object(
      'status', 'not_allowlisted', 'reserved', false,
      'sendingAttempted', false, 'liveDispatchEnabled', true
    );
  end if;

  if exists (
    select 1 from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
    where ledger.plan_id = requested_plan_id and ledger.consumes_daily_limit
  ) then
    return jsonb_build_object('status', 'already_sent', 'reserved', false, 'sendingAttempted', false);
  end if;

  if exists (
    select 1 from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
    where ledger.plan_id = requested_plan_id and ledger.active_reservation
  ) then
    return jsonb_build_object('status', 'already_reserved', 'reserved', false, 'sendingAttempted', false);
  end if;

  select count(*)::integer, max(gate_at)
  into consumed_or_reserved_count, latest_gate_at
  from (
    select case when ledger.consumes_daily_limit then coalesce(ledger.finished_at, ledger.reserved_at)
                else ledger.reserved_at end as gate_at
    from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
    where ledger.accounting_date = today_prague
      and (ledger.consumes_daily_limit or ledger.active_reservation)
  ) active_gate;

  if consumed_or_reserved_count >= rate_state.daily_send_limit then
    return jsonb_build_object(
      'status', 'daily_limit_reached', 'reserved', false,
      'dailyLimit', rate_state.daily_send_limit, 'sendingAttempted', false
    );
  end if;

  if latest_gate_at is not null
     and latest_gate_at + make_interval(secs => rate_state.minimum_interval_seconds) > now()
  then
    return jsonb_build_object(
      'status', 'minimum_interval', 'reserved', false,
      'retryAfter', latest_gate_at + make_interval(secs => rate_state.minimum_interval_seconds),
      'sendingAttempted', false
    );
  end if;

  insert into public.complete_power_outage_notification_email_pilot_send_slots (
    plan_id, ico_snapshot, plan_fingerprint, allowlist_event_id,
    claim_token_hash, accounting_date, reserved_at, lease_expires_at, metadata
  ) values (
    requested_plan_id,
    allowlist_entry.ico,
    public.cpo_notification_email_plan_fingerprint_v1(requested_plan_id),
    allowlist_entry.allowlist_event_id,
    encode(extensions.digest(claim_token::text, 'sha256'), 'hex'),
    today_prague,
    now(),
    now() + make_interval(secs => rate_state.reservation_lease_seconds),
    jsonb_build_object(
      'contract', 'complete-notification-email-pilot-rate-limit-v1',
      'sendingAttempted', false
    )
  ) returning id into slot_id;

  return jsonb_build_object(
    'status', 'reserved', 'reserved', true, 'slotId', slot_id,
    'claimToken', claim_token, 'leaseExpiresAt', now() + make_interval(secs => rate_state.reservation_lease_seconds),
    'remainingDailyCapacity', rate_state.daily_send_limit - consumed_or_reserved_count - 1,
    'sendingAttempted', false
  );
end;
$$;

create or replace function public.finish_cpo_notification_email_pilot_slot_v1(
  requested_slot_id uuid,
  requested_claim_token uuid,
  requested_outcome text,
  requested_provider_message_id text default null,
  requested_reason_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  selected_slot public.complete_power_outage_notification_email_pilot_send_slots%rowtype;
  normalized_outcome text := lower(btrim(coalesce(requested_outcome, '')));
  normalized_message_id text := nullif(btrim(coalesce(requested_provider_message_id, '')), '');
  normalized_reason text := nullif(btrim(coalesce(requested_reason_code, '')), '');
  outcome_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_rate_limit_v1', 0)
  );

  select * into selected_slot
  from public.complete_power_outage_notification_email_pilot_send_slots slot
  where slot.id = requested_slot_id;

  if selected_slot.id is null
     or selected_slot.claim_token_hash <> encode(extensions.digest(requested_claim_token::text, 'sha256'), 'hex')
  then
    raise exception 'Neplatny limitacni slot nebo claim token.';
  end if;

  if normalized_outcome not in ('sent', 'released') then
    raise exception 'Neplatny vysledek limitacniho slotu.';
  end if;
  if exists (
    select 1 from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
    where outcome.slot_id = selected_slot.id
  ) then
    raise exception 'Limitacni slot uz byl uzavren.';
  end if;
  if normalized_outcome = 'sent' and (
    selected_slot.lease_expires_at <= now() or normalized_message_id is null
  ) then
    raise exception 'Odeslani nelze potvrdit bez platne rezervace a ID zpravy poskytovatele.';
  end if;

  insert into public.complete_power_outage_notification_email_pilot_send_outcomes (
    slot_id, plan_id, outcome, provider_message_id, reason_code, metadata
  ) values (
    selected_slot.id,
    selected_slot.plan_id,
    normalized_outcome,
    case when normalized_outcome = 'sent' then normalized_message_id else null end,
    coalesce(normalized_reason, case when normalized_outcome = 'sent'
      then 'provider_accepted' else 'reservation_released' end),
    jsonb_build_object(
      'contract', 'complete-notification-email-pilot-rate-limit-v1',
      'networkRequestPerformedByDatabase', false
    )
  ) returning id into outcome_id;

  return jsonb_build_object(
    'status', normalized_outcome, 'slotId', selected_slot.id,
    'outcomeId', outcome_id, 'networkRequestPerformedByDatabase', false
  );
end;
$$;

create or replace function public.get_cpo_notification_email_pilot_rate_summary_v1()
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
    raise exception 'Limitace pilotu je dostupna pouze administratorum.';
  end if;

  select jsonb_build_object(
    'contract', 'complete-notification-email-pilot-rate-limit-v1',
    'enforcementEnabled', state_row.enforcement_enabled,
    'reservationEnabled', state_row.reservation_enabled,
    'dailySendLimit', state_row.daily_send_limit,
    'minimumIntervalSeconds', state_row.minimum_interval_seconds,
    'reservationLeaseSeconds', state_row.reservation_lease_seconds,
    'accountingTimezone', state_row.accounting_timezone,
    'sentTodayCount', (
      select count(*) from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
      where ledger.accounting_date = (now() at time zone 'Europe/Prague')::date
        and ledger.consumes_daily_limit
    ),
    'activeReservationCount', (
      select count(*) from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
      where ledger.active_reservation
    ),
    'expiredReservationCount', (
      select count(*) from public.complete_power_outage_notification_email_pilot_send_ledger_v1 ledger
      where ledger.expired_reservation
    ),
    'sendingEnabled', false,
    'liveDispatchEnabled', false
  ) into result
  from public.complete_power_outage_notification_email_pilot_rate_limit_state state_row
  where state_row.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.prevent_cpo_notification_email_pilot_rate_history_mutation() from public, anon, authenticated;
revoke all on function public.guard_cpo_notification_email_pilot_send_slot_insert() from public, anon, authenticated;
revoke all on function public.reserve_cpo_notification_email_pilot_slot_v1(uuid) from public, anon, authenticated;
revoke all on function public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.get_cpo_notification_email_pilot_rate_summary_v1() from public, anon;
grant execute on function public.prevent_cpo_notification_email_pilot_rate_history_mutation() to service_role;
grant execute on function public.guard_cpo_notification_email_pilot_send_slot_insert() to service_role;
grant execute on function public.reserve_cpo_notification_email_pilot_slot_v1(uuid) to service_role;
grant execute on function public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text) to service_role;
grant execute on function public.get_cpo_notification_email_pilot_rate_summary_v1() to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
      'pilotRateLimitContract', 'complete-notification-email-pilot-rate-limit-v1',
      'pilotDailySendLimit', 3,
      'pilotMinimumIntervalSeconds', 600,
      'pilotRateLimitEnforced', true,
      'pilotRateLimitReservationEnabled', false,
      'liveDispatchEnabled', false,
      'pilotRateLimitInstalledAt', now()
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
