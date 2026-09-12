begin;

-- Ostry provoz KOMPLETNI, krok 4: produkcni dispatcher bez pilotniho
-- allowlistu. Instalace zachovava aktivaci i dispatch vypnute.
do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regclass('public.complete_power_outage_notification_email_plans') is null
    or to_regclass('public.complete_power_outage_notification_email_suppression_events') is null
    or to_regprocedure('public.cpo_notification_email_plan_fingerprint_v1(uuid)') is null
    or to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'Chybi zavislosti pro produkcni dispatcher e-mailu KOMPLETNI.';
  end if;
  if exists (
    select 1 from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
      and (state_row.runtime_mode = 'live' or state_row.dispatch_enabled)
  ) then
    raise exception 'Pred instalaci produkcniho dispatcheru musi byt odesilani KOMPLETNI vypnute.';
  end if;
end
$$;

create table if not exists public.cpo_notification_email_production_slots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  ico_snapshot text not null,
  selector_key_snapshot text not null,
  configuration_version integer not null,
  plan_fingerprint text not null,
  claim_token_hash text not null,
  accounting_date date not null,
  accounting_month date not null,
  reserved_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_production_slot_plan_ico_fkey
    foreign key (plan_id, ico_snapshot)
    references public.complete_power_outage_notification_email_plans(id, ico)
    on delete restrict,
  constraint cpo_production_slot_selector_fkey
    foreign key (selector_key_snapshot)
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  constraint cpo_production_slot_ico_check check (ico_snapshot ~ '^[0-9]{8}$'),
  constraint cpo_production_slot_version_check check (configuration_version > 0),
  constraint cpo_production_slot_fingerprint_check check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_production_slot_token_check check (claim_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cpo_production_slot_month_check check (
    accounting_month = date_trunc('month', accounting_date)::date
  ),
  constraint cpo_production_slot_lease_check check (
    lease_expires_at > reserved_at
    and lease_expires_at <= reserved_at + interval '5 minutes'
  ),
  constraint cpo_production_slot_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_production_slot_identity_idx
  on public.cpo_notification_email_production_slots(id, plan_id);
create index if not exists cpo_production_slot_day_idx
  on public.cpo_notification_email_production_slots(accounting_date, reserved_at);
create index if not exists cpo_production_slot_month_idx
  on public.cpo_notification_email_production_slots(accounting_month, reserved_at);
create index if not exists cpo_production_slot_plan_idx
  on public.cpo_notification_email_production_slots(plan_id, reserved_at desc);

create table if not exists public.cpo_notification_email_production_outcomes (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique,
  plan_id uuid not null,
  outcome text not null,
  provider_message_id text,
  reason_code text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_production_outcome_slot_plan_fkey
    foreign key (slot_id, plan_id)
    references public.cpo_notification_email_production_slots(id, plan_id)
    on delete restrict,
  constraint cpo_production_outcome_kind_check check (outcome in ('sent', 'released')),
  constraint cpo_production_outcome_provider_check check (
    (outcome = 'sent' and nullif(btrim(provider_message_id), '') is not null)
    or (outcome = 'released' and provider_message_id is null)
  ),
  constraint cpo_production_outcome_reason_check check (btrim(reason_code) <> ''),
  constraint cpo_production_outcome_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_production_outcome_sent_plan_idx
  on public.cpo_notification_email_production_outcomes(plan_id)
  where outcome = 'sent';
create unique index if not exists cpo_production_outcome_provider_idx
  on public.cpo_notification_email_production_outcomes(provider_message_id)
  where outcome = 'sent';

create or replace view public.cpo_notification_email_production_ledger_v1
with (security_invoker = true)
as
select
  slot.id as slot_id,
  slot.plan_id,
  slot.ico_snapshot as ico,
  slot.selector_key_snapshot as selector_key,
  slot.configuration_version,
  slot.accounting_date,
  slot.accounting_month,
  slot.reserved_at,
  slot.lease_expires_at,
  outcome.outcome,
  outcome.provider_message_id,
  outcome.reason_code,
  outcome.created_at as finished_at,
  outcome.outcome = 'sent' as consumes_limit,
  outcome.id is null and slot.lease_expires_at > now() as active_reservation,
  outcome.id is null and slot.lease_expires_at <= now() as expired_reservation
from public.cpo_notification_email_production_slots slot
left join public.cpo_notification_email_production_outcomes outcome
  on outcome.slot_id = slot.id and outcome.plan_id = slot.plan_id;

create or replace function public.prevent_cpo_notification_email_production_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie produkcniho odesilani KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_production_slots_immutable
  on public.cpo_notification_email_production_slots;
create trigger cpo_production_slots_immutable
before update or delete on public.cpo_notification_email_production_slots
for each row execute function
  public.prevent_cpo_notification_email_production_history_mutation();

drop trigger if exists cpo_production_outcomes_immutable
  on public.cpo_notification_email_production_outcomes;
create trigger cpo_production_outcomes_immutable
before update or delete on public.cpo_notification_email_production_outcomes
for each row execute function
  public.prevent_cpo_notification_email_production_history_mutation();

create or replace function public.guard_cpo_notification_email_production_slot_insert_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  local_now timestamp without time zone := clock_timestamp() at time zone 'Europe/Prague';
  used_today integer;
  used_month integer;
  latest_gate timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0)
  );
  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;
  select * into selected_plan
  from public.complete_power_outage_notification_email_plans
  where id = new.plan_id;

  if config_row.singleton is null
    or config_row.configuration_status <> 'live'
    or not config_row.production_activation_enabled
    or not config_row.continuous_planning_enabled
    or not config_row.continuous_dispatch_enabled
    or email_state.runtime_mode <> 'live'
    or not email_state.planning_enabled
    or not email_state.dispatch_enabled then
    raise exception 'Produkční odesilaci slot nelze vytvorit mimo aktivni LIVE provoz.';
  end if;

  if selected_plan.id is null
    or selected_plan.plan_status <> 'shadow_ready'
    or selected_plan.selector_key <> config_row.active_selector_key
    or selected_plan.selector_key <> new.selector_key_snapshot
    or selected_plan.ico <> new.ico_snapshot
    or selected_plan.unsubscribe_token is null
    or selected_plan.starts_at_snapshot <= now()
      + make_interval(mins => config_row.minimum_outage_lead_minutes)
    or selected_plan.starts_at_snapshot > now()
      + make_interval(days => config_row.maximum_outage_horizon_days)
    or new.configuration_version <> config_row.configuration_version
    or new.plan_fingerprint is distinct from
      public.cpo_notification_email_plan_fingerprint_v1(new.plan_id) then
    raise exception 'Produkční slot neodpovida aktualnimu pripravenemu planu.';
  end if;

  if exists (
    select 1 from public.complete_power_outage_notification_email_suppressions_v1 suppression
    where suppression.normalized_email = selected_plan.recipient_email
      and suppression.is_suppressed
  ) then
    raise exception 'Odhlaseny kontakt nesmi vstoupit do produkcniho odesilani.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_contact_classification_effective_v1 contact
    where contact.shadow_contact_id = selected_plan.recipient_contact_id
      and contact.ico = selected_plan.ico
      and contact.contact_type = 'email'
      and contact.notification_eligible
      and contact.is_primary
      and lower(contact.normalized_value) = lower(selected_plan.recipient_email)
  ) or not exists (
    select 1 from public.complete_power_outages outage
    where outage.id = selected_plan.outage_id
      and outage.source_status = 'scheduled'
      and outage.starts_at = selected_plan.starts_at_snapshot
  ) or exists (
    select 1
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outage_job_links job_link
      on job_link.candidate_id = company.id
    where company.ico = selected_plan.ico
      and address.outage_id = selected_plan.outage_id
  ) then
    raise exception 'Produkční slot neprosel aktualni kontrolou kontaktu, odstavky nebo zakazky.';
  end if;

  if extract(isodow from local_now)::smallint <> all(config_row.send_weekdays)
    or local_now::time < config_row.send_window_start
    or local_now::time >= config_row.send_window_end then
    raise exception 'Produkční slot je mimo povolene odesilaci okno.';
  end if;

  if new.accounting_date <> local_now::date
    or new.accounting_month <> date_trunc('month', local_now)::date
    or new.reserved_at < clock_timestamp() - interval '5 seconds'
    or new.reserved_at > clock_timestamp() + interval '5 seconds'
    or new.lease_expires_at <> new.reserved_at
      + make_interval(secs => config_row.reservation_lease_seconds) then
    raise exception 'Produkční slot nema platne casove parametry.';
  end if;

  if exists (
    select 1 from public.cpo_notification_email_production_ledger_v1 ledger
    where ledger.plan_id = new.plan_id
      and (ledger.consumes_limit or ledger.active_reservation)
  ) or exists (
    select 1
    from public.complete_power_outage_notification_email_pilot_send_outcomes pilot
    where pilot.plan_id = new.plan_id and pilot.outcome = 'sent'
  ) then
    raise exception 'Oznameni uz bylo odeslano nebo ma aktivni rezervaci.';
  end if;

  select
    count(*) filter (where ledger.accounting_date = local_now::date),
    count(*) filter (where ledger.accounting_month = date_trunc('month', local_now)::date),
    max(case when ledger.consumes_limit then coalesce(ledger.finished_at, ledger.reserved_at)
      else ledger.reserved_at end)
  into used_today, used_month, latest_gate
  from public.cpo_notification_email_production_ledger_v1 ledger
  where ledger.consumes_limit or ledger.active_reservation;

  if used_today >= config_row.daily_send_limit then
    raise exception 'Byl dosazen produkcni denni limit.';
  end if;
  if used_month >= config_row.monthly_send_limit then
    raise exception 'Byl dosazen produkcni mesicni limit.';
  end if;
  if latest_gate is not null
    and latest_gate + make_interval(secs => config_row.minimum_interval_seconds)
      > new.reserved_at then
    raise exception 'Minimalni interval mezi produkcnimi e-maily jeste neuplynul.';
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_production_slot_insert_guard
  on public.cpo_notification_email_production_slots;
create trigger cpo_production_slot_insert_guard
before insert on public.cpo_notification_email_production_slots
for each row execute function
  public.guard_cpo_notification_email_production_slot_insert_v1();

alter table public.cpo_notification_email_production_slots enable row level security;
alter table public.cpo_notification_email_production_outcomes enable row level security;
revoke all on table public.cpo_notification_email_production_slots
  from public, anon, authenticated;
revoke all on table public.cpo_notification_email_production_outcomes
  from public, anon, authenticated;
revoke all on table public.cpo_notification_email_production_ledger_v1
  from public, anon, authenticated;
grant all on table public.cpo_notification_email_production_slots to service_role;
grant all on table public.cpo_notification_email_production_outcomes to service_role;
grant select on table public.cpo_notification_email_production_ledger_v1 to service_role;

create or replace function public.claim_cpo_notification_email_production_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  selected_outage public.complete_power_outages%rowtype;
  local_now timestamp without time zone := now() at time zone 'Europe/Prague';
  used_today integer;
  used_month integer;
  latest_gate timestamptz;
  claim_token uuid := gen_random_uuid();
  slot_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0)
  );
  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;

  if config_row.singleton is null
    or config_row.configuration_status <> 'live'
    or not config_row.production_activation_enabled
    or not config_row.continuous_planning_enabled
    or not config_row.continuous_dispatch_enabled
    or email_state.runtime_mode <> 'live'
    or not email_state.planning_enabled
    or not email_state.dispatch_enabled then
    return jsonb_build_object(
      'status', 'disabled', 'sendingAttempted', false,
      'productionDispatchEnabled', false
    );
  end if;

  if extract(isodow from local_now)::smallint <> all(config_row.send_weekdays)
    or local_now::time < config_row.send_window_start
    or local_now::time >= config_row.send_window_end then
    return jsonb_build_object(
      'status', 'outside_send_window', 'sendingAttempted', false
    );
  end if;

  select
    count(*) filter (where ledger.accounting_date = local_now::date),
    count(*) filter (where ledger.accounting_month = date_trunc('month', local_now)::date),
    max(case when ledger.consumes_limit then coalesce(ledger.finished_at, ledger.reserved_at)
      else ledger.reserved_at end)
  into used_today, used_month, latest_gate
  from public.cpo_notification_email_production_ledger_v1 ledger
  where ledger.consumes_limit or ledger.active_reservation;

  if used_today >= config_row.daily_send_limit then
    return jsonb_build_object('status', 'daily_limit_reached', 'sendingAttempted', false);
  end if;
  if used_month >= config_row.monthly_send_limit then
    return jsonb_build_object('status', 'monthly_limit_reached', 'sendingAttempted', false);
  end if;
  if latest_gate is not null
    and latest_gate + make_interval(secs => config_row.minimum_interval_seconds) > now() then
    return jsonb_build_object(
      'status', 'minimum_interval',
      'retryAfter', latest_gate + make_interval(secs => config_row.minimum_interval_seconds),
      'sendingAttempted', false
    );
  end if;

  select plan.* into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  left join public.complete_power_outage_notification_email_suppressions_v1 suppression
    on suppression.normalized_email = plan.recipient_email
      and suppression.is_suppressed
  where plan.plan_status = 'shadow_ready'
    and plan.selector_key = config_row.active_selector_key
    and plan.unsubscribe_token is not null
    and plan.starts_at_snapshot > now()
      + make_interval(mins => config_row.minimum_outage_lead_minutes)
    and plan.starts_at_snapshot <= now()
      + make_interval(days => config_row.maximum_outage_horizon_days)
    and suppression.normalized_email is null
    and exists (
      select 1
      from public.complete_power_outage_contact_classification_effective_v1 contact
      where contact.shadow_contact_id = plan.recipient_contact_id
        and contact.ico = plan.ico
        and contact.contact_type = 'email'
        and contact.notification_eligible
        and contact.is_primary
        and lower(contact.normalized_value) = lower(plan.recipient_email)
    )
    and exists (
      select 1 from public.complete_power_outages outage
      where outage.id = plan.outage_id
        and outage.source_status = 'scheduled'
        and outage.starts_at = plan.starts_at_snapshot
    )
    and not exists (
      select 1
      from public.complete_power_outage_companies company
      join public.complete_power_outage_addresses address
        on address.id = company.outage_address_id
      join public.complete_power_outage_job_links job_link
        on job_link.candidate_id = company.id
      where company.ico = plan.ico
        and address.outage_id = plan.outage_id
    )
    and not exists (
      select 1 from public.cpo_notification_email_production_ledger_v1 ledger
      where ledger.plan_id = plan.id
        and (ledger.consumes_limit or ledger.active_reservation)
    )
    and not exists (
      select 1
      from public.complete_power_outage_notification_email_pilot_send_outcomes pilot
      where pilot.plan_id = plan.id and pilot.outcome = 'sent'
    )
  order by plan.starts_at_snapshot, plan.id
  limit 1;

  if selected_plan.id is null then
    return jsonb_build_object('status', 'idle', 'sendingAttempted', false);
  end if;

  insert into public.cpo_notification_email_production_slots (
    plan_id, ico_snapshot, selector_key_snapshot, configuration_version,
    plan_fingerprint, claim_token_hash, accounting_date, accounting_month,
    reserved_at, lease_expires_at, metadata
  ) values (
    selected_plan.id, selected_plan.ico, selected_plan.selector_key,
    config_row.configuration_version,
    public.cpo_notification_email_plan_fingerprint_v1(selected_plan.id),
    encode(extensions.digest(claim_token::text, 'sha256'), 'hex'),
    local_now::date, date_trunc('month', local_now)::date,
    now(), now() + make_interval(secs => config_row.reservation_lease_seconds),
    jsonb_build_object(
      'contract', 'complete-notification-email-production-dispatch-v1',
      'allowlistRequired', false,
      'sendingAttempted', false,
      'marketEmailIsolation', true
    )
  ) returning id into slot_id;

  select * into selected_outage
  from public.complete_power_outages
  where id = selected_plan.outage_id;
  if selected_outage.id is null then
    raise exception 'Produkční plan nema platnou odstavku.';
  end if;

  return jsonb_build_object(
    'status', 'claimed',
    'slotId', slot_id,
    'claimToken', claim_token,
    'delivery', jsonb_build_object(
      'planId', selected_plan.id,
      'recipient', selected_plan.recipient_email,
      'companyName', selected_plan.company_name_snapshot,
      'startsAt', selected_plan.starts_at_snapshot,
      'endsAt', selected_plan.ends_at_snapshot,
      'addresses', selected_plan.address_snapshot,
      'source', selected_plan.source_snapshot,
      'municipality', selected_plan.municipality_snapshot,
      'announcementUrl', selected_outage.announcement_url,
      'sourceUrl', selected_outage.source_url,
      'unsubscribeToken', selected_plan.unsubscribe_token
    ),
    'sendingAttempted', false
  );
end;
$$;

create or replace function public.finish_cpo_notification_email_production_slot_v1(
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
  selected_slot public.cpo_notification_email_production_slots%rowtype;
  normalized_outcome text := lower(btrim(coalesce(requested_outcome, '')));
  normalized_message_id text := nullif(btrim(coalesce(requested_provider_message_id, '')), '');
  normalized_reason text := nullif(btrim(coalesce(requested_reason_code, '')), '');
  outcome_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0)
  );
  select * into selected_slot
  from public.cpo_notification_email_production_slots
  where id = requested_slot_id;

  if selected_slot.id is null
    or selected_slot.claim_token_hash <> encode(
      extensions.digest(requested_claim_token::text, 'sha256'), 'hex'
    ) then
    raise exception 'Neplatny produkcni slot nebo claim token.';
  end if;
  if normalized_outcome not in ('sent', 'released') then
    raise exception 'Neplatny vysledek produkcniho slotu.';
  end if;
  if exists (
    select 1 from public.cpo_notification_email_production_outcomes
    where slot_id = selected_slot.id
  ) then
    raise exception 'Produkční slot uz byl uzavren.';
  end if;
  if normalized_outcome = 'sent'
    and (selected_slot.lease_expires_at <= now() or normalized_message_id is null) then
    raise exception 'Odeslani nelze potvrdit bez platne rezervace a ID poskytovatele.';
  end if;

  insert into public.cpo_notification_email_production_outcomes (
    slot_id, plan_id, outcome, provider_message_id, reason_code, metadata
  ) values (
    selected_slot.id, selected_slot.plan_id, normalized_outcome,
    case when normalized_outcome = 'sent' then normalized_message_id else null end,
    coalesce(normalized_reason, case when normalized_outcome = 'sent'
      then 'provider_accepted' else 'reservation_released' end),
    jsonb_build_object(
      'contract', 'complete-notification-email-production-dispatch-v1',
      'networkRequestPerformedByDatabase', false
    )
  ) returning id into outcome_id;

  return jsonb_build_object(
    'status', normalized_outcome,
    'slotId', selected_slot.id,
    'outcomeId', outcome_id,
    'networkRequestPerformedByDatabase', false
  );
end;
$$;

create or replace function public.request_cpo_notification_email_production_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
begin
  if not coalesce((
    select config.configuration_status = 'live'
      and config.production_activation_enabled
      and config.continuous_planning_enabled
      and config.continuous_dispatch_enabled
      and email_state.runtime_mode = 'live'
      and email_state.planning_enabled
      and email_state.dispatch_enabled
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
  ), false) then
    return null;
  end if;

  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets
  where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets
  where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault URL aplikace neni platne.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault automation token chybi.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/notification-emails/production/send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Notification-Production/1.0'
    ),
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.prevent_cpo_notification_email_production_history_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_cpo_notification_email_production_slot_insert_v1()
  from public, anon, authenticated;
revoke all on function public.claim_cpo_notification_email_production_v1()
  from public, anon, authenticated;
revoke all on function public.finish_cpo_notification_email_production_slot_v1(uuid,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.request_cpo_notification_email_production_v1()
  from public, anon, authenticated;
grant execute on function public.prevent_cpo_notification_email_production_history_mutation()
  to service_role;
grant execute on function public.guard_cpo_notification_email_production_slot_insert_v1()
  to service_role;
grant execute on function public.claim_cpo_notification_email_production_v1()
  to service_role;
grant execute on function public.finish_cpo_notification_email_production_slot_v1(uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.request_cpo_notification_email_production_v1()
  to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_notification_email_live_pilot_every_minute',
      'complete_notification_email_production_dispatch_every_minute'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'complete_notification_email_production_dispatch_every_minute',
    '* * * * *',
    $job$select public.request_cpo_notification_email_production_v1();$job$
  );
end
$$;

update public.complete_power_outage_notification_email_production_config
set metadata = metadata || jsonb_build_object(
      'productionDispatcherContract',
        'complete-notification-email-production-dispatch-v1',
      'dispatcherInstalledAt', now(),
      'allowlistRequired', false,
      'dispatcherActivationAvailable', false,
      'sendingAttempted', false
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

with definitions as (
  select
    pg_get_functiondef(
      'public.claim_cpo_notification_email_production_v1()'::regprocedure
    ) as claim_definition,
    pg_get_functiondef(
      'public.request_cpo_notification_email_production_v1()'::regprocedure
    ) as requester_definition,
    pg_get_functiondef(
      'public.guard_cpo_notification_email_production_slot_insert_v1()'::regprocedure
    ) as guard_definition
), audit as (
  select 'TABLE'::text as check_type,
    'independent COMPLETE production send slots exist'::text as object_name,
    to_regclass('public.cpo_notification_email_production_slots') is not null
      as is_correct
  union all
  select 'TABLE', 'independent COMPLETE production outcomes exist',
    to_regclass('public.cpo_notification_email_production_outcomes') is not null
  union all
  select 'DATA', 'production dispatcher history starts empty',
    not exists (select 1 from public.cpo_notification_email_production_slots)
      and not exists (select 1 from public.cpo_notification_email_production_outcomes)
  union all
  select 'RLS', 'COMPLETE production dispatcher tables have RLS',
    bool_and(relrowsecurity)
  from pg_class
  where oid in (
    'public.cpo_notification_email_production_slots'::regclass,
    'public.cpo_notification_email_production_outcomes'::regclass
  )
  union all
  select 'FUNCTION', 'production dispatcher claim and completion exist',
    to_regprocedure('public.claim_cpo_notification_email_production_v1()') is not null
      and to_regprocedure('public.finish_cpo_notification_email_production_slot_v1(uuid,uuid,text,text,text)') is not null
  union all
  select 'GRANT', 'authenticated cannot run production dispatcher',
    not has_function_privilege(
      'authenticated', 'public.claim_cpo_notification_email_production_v1()', 'EXECUTE'
    ) and not has_function_privilege(
      'authenticated',
      'public.finish_cpo_notification_email_production_slot_v1(uuid,uuid,text,text,text)',
      'EXECUTE'
    )
  union all
  select 'LOGIC', 'production claim does not require pilot allowlist',
    claim_definition not ilike '%pilot_allowlist%'
      and claim_definition ilike '%active_selector_key%'
  from definitions
  union all
  select 'LOGIC', 'database guard enforces daily monthly and interval limits',
    guard_definition ilike '%daily_send_limit%'
      and guard_definition ilike '%monthly_send_limit%'
      and guard_definition ilike '%minimum_interval_seconds%'
  from definitions
  union all
  select 'LOGIC', 'production claim excludes pilot and production duplicates',
    claim_definition ilike '%pilot_send_outcomes%'
      and claim_definition ilike '%production_ledger_v1%'
  from definitions
  union all
  select 'ISOLATION', 'production dispatcher does not reference MARKET email objects',
    claim_definition not ilike '%power_outage_client_email_%'
      and requester_definition not ilike '%power_outage_client_email_%'
  from definitions
  union all
  select 'CRON', 'production dispatcher requester checks every minute',
    count(*) = 1 and bool_and(schedule = '* * * * *')
      and bool_and(command ilike '%request_cpo_notification_email_production_v1%')
  from cron.job
  where jobname = 'complete_notification_email_production_dispatch_every_minute'
  union all
  select 'CRON', 'obsolete pilot dispatcher schedule is absent',
    not exists (
      select 1 from cron.job
      where jobname = 'complete_notification_email_live_pilot_every_minute'
    )
  union all
  select 'SAFETY', 'disabled requester performs no HTTP request',
    requester_definition ilike '%return null%'
      and requester_definition ilike '%production_activation_enabled%'
      and requester_definition ilike '%continuous_dispatch_enabled%'
  from definitions
  union all
  select 'SAFETY', 'step four keeps production dispatch disabled',
    config.configuration_status = 'ready'
      and not config.production_activation_enabled
      and not config.continuous_dispatch_enabled
      and email_state.runtime_mode = 'shadow'
      and not email_state.dispatch_enabled
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
