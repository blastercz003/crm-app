begin;

-- Krok 10A: izolovany Resend TEST pro KOMPLETNI.
-- Zadny cron ani LIVE cesta se zde nevytvari. Skutecny firemni prijemce se
-- uklada jen jako auditni snapshot; worker musi dorucit vyhradne na serverovou
-- COMPLETE_RESEND_TEST_RECIPIENT a po jednom pokusu se TEST opet vypne.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_plans') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_plans');
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.set_power_outage_updated_at()');
  end if;
  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro Resend TEST KOMPLETNI: %.', array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_test_state (
  singleton boolean primary key default true check (singleton),
  test_enabled boolean not null default false,
  provider_namespace text not null default 'complete_resend',
  configuration_contract_version integer not null default 1,
  max_attempt_count integer not null default 2,
  last_requested_at timestamptz,
  last_sent_at timestamptz,
  last_delivered_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_notification_email_test_provider_check check (provider_namespace = 'complete_resend'),
  constraint cpo_notification_email_test_attempt_check check (max_attempt_count between 1 and 2),
  constraint cpo_notification_email_test_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_notification_email_test_state (
  singleton, test_enabled, provider_namespace, metadata
) values (
  true, false, 'complete_resend', jsonb_build_object(
    'contract', 'complete-notification-email-resend-test-v1',
    'environmentPrefix', 'COMPLETE_RESEND_',
    'marketEmailIsolation', true,
    'liveDispatchAvailable', false,
    'automaticDispatchSchedule', false
  )
) on conflict (singleton) do update
set test_enabled = false,
    provider_namespace = 'complete_resend',
    configuration_contract_version = 1,
    max_attempt_count = 2,
    metadata = public.complete_power_outage_notification_email_test_state.metadata || excluded.metadata,
    updated_at = now();

create table if not exists public.complete_power_outage_notification_email_test_deliveries (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null unique
    references public.complete_power_outage_notification_email_plans(id) on delete restrict,
  delivery_status text not null default 'pending',
  provider text not null default 'resend',
  provider_message_id text unique,
  original_recipient_email text not null,
  test_recipient_email text,
  subject_snapshot text not null,
  text_snapshot text not null,
  company_name_snapshot text not null,
  starts_at_snapshot timestamptz not null,
  ends_at_snapshot timestamptz not null,
  address_snapshot jsonb not null default '[]'::jsonb,
  unsubscribe_token uuid not null,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 2,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_notification_email_test_status_check check (
    delivery_status in ('pending', 'processing', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed')
  ),
  constraint cpo_notification_email_test_provider_delivery_check check (provider = 'resend'),
  constraint cpo_notification_email_test_original_email_check check (
    original_recipient_email = lower(btrim(original_recipient_email))
    and original_recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint cpo_notification_email_test_recipient_check check (
    test_recipient_email is null or (
      test_recipient_email = lower(btrim(test_recipient_email))
      and test_recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
  ),
  constraint cpo_notification_email_test_attempts_check check (
    attempt_count between 0 and max_attempt_count and max_attempt_count between 1 and 2
  ),
  constraint cpo_notification_email_test_lease_check check (
    (delivery_status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (delivery_status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  constraint cpo_notification_email_test_addresses_check check (jsonb_typeof(address_snapshot) = 'array'),
  constraint cpo_notification_email_test_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_notification_email_test_delivery_status_idx
  on public.complete_power_outage_notification_email_test_deliveries(delivery_status, requested_at);

create table if not exists public.complete_power_outage_notification_email_test_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.complete_power_outage_notification_email_test_deliveries(id) on delete restrict,
  provider_event_id text not null unique,
  provider_message_id text not null,
  event_kind text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint cpo_notification_email_test_event_kind_check check (
    event_kind in ('email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained', 'email.failed', 'email.suppressed')
  ),
  constraint cpo_notification_email_test_event_payload_check check (jsonb_typeof(payload) = 'object')
);

create or replace function public.prevent_complete_notification_email_test_event_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Historie Resend TEST udalosti KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_notification_email_test_events_immutable
  on public.complete_power_outage_notification_email_test_events;
create trigger cpo_notification_email_test_events_immutable
before update or delete on public.complete_power_outage_notification_email_test_events
for each row execute function public.prevent_complete_notification_email_test_event_mutation();

drop trigger if exists cpo_notification_email_test_state_updated_at
  on public.complete_power_outage_notification_email_test_state;
create trigger cpo_notification_email_test_state_updated_at
before update on public.complete_power_outage_notification_email_test_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_notification_email_test_delivery_updated_at
  on public.complete_power_outage_notification_email_test_deliveries;
create trigger cpo_notification_email_test_delivery_updated_at
before update on public.complete_power_outage_notification_email_test_deliveries
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_notification_email_test_state enable row level security;
alter table public.complete_power_outage_notification_email_test_deliveries enable row level security;
alter table public.complete_power_outage_notification_email_test_events enable row level security;

revoke all on table public.complete_power_outage_notification_email_test_state from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_test_deliveries from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_test_events from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_test_state to service_role;
grant all on table public.complete_power_outage_notification_email_test_deliveries to service_role;
grant all on table public.complete_power_outage_notification_email_test_events to service_role;

create or replace function public.prepare_complete_power_outage_notification_email_test_v1(
  requested_plan_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  selected_delivery_id uuid;
begin
  select plan.* into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  where plan.plan_status = 'shadow_ready'
    and plan.expires_at > now()
    and (requested_plan_id is null or plan.id = requested_plan_id)
  order by plan.starts_at_snapshot, plan.id
  limit 1;

  if selected_plan.id is null then
    raise exception 'Nebyl nalezen zadny aktualni SHADOW plan pro bezpecny TEST.';
  end if;

  insert into public.complete_power_outage_notification_email_test_deliveries (
    plan_id, delivery_status, original_recipient_email,
    subject_snapshot, text_snapshot, company_name_snapshot,
    starts_at_snapshot, ends_at_snapshot, address_snapshot,
    unsubscribe_token, max_attempt_count, metadata
  ) values (
    selected_plan.id, 'pending', selected_plan.recipient_email,
    selected_plan.subject_snapshot, selected_plan.text_snapshot,
    selected_plan.company_name_snapshot, selected_plan.starts_at_snapshot,
    selected_plan.ends_at_snapshot, selected_plan.address_snapshot,
    selected_plan.unsubscribe_token, 2,
    jsonb_build_object(
      'contract', 'complete-notification-email-resend-test-delivery-v1',
      'testOnly', true,
      'originalRecipientNeverUsedForDelivery', true,
      'marketEmailIsolation', true
    )
  )
  on conflict (plan_id) do update
  set delivery_status = case
        when public.complete_power_outage_notification_email_test_deliveries.delivery_status in ('failed', 'suppressed')
          and public.complete_power_outage_notification_email_test_deliveries.attempt_count < public.complete_power_outage_notification_email_test_deliveries.max_attempt_count
        then 'pending'
        else public.complete_power_outage_notification_email_test_deliveries.delivery_status
      end,
      subject_snapshot = excluded.subject_snapshot,
      text_snapshot = excluded.text_snapshot,
      company_name_snapshot = excluded.company_name_snapshot,
      starts_at_snapshot = excluded.starts_at_snapshot,
      ends_at_snapshot = excluded.ends_at_snapshot,
      address_snapshot = excluded.address_snapshot,
      requested_at = now(),
      last_error_code = null,
      last_error_message = null,
      finished_at = null,
      updated_at = now()
  returning id into selected_delivery_id;

  update public.complete_power_outage_notification_email_test_state
  set test_enabled = true,
      last_requested_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object('activeTestDeliveryId', selected_delivery_id)
  where singleton;

  return jsonb_build_object(
    'status', 'prepared',
    'deliveryId', selected_delivery_id,
    'companyName', selected_plan.company_name_snapshot,
    'startsAt', selected_plan.starts_at_snapshot,
    'testOnly', true
  );
end;
$$;

create or replace function public.claim_complete_power_outage_notification_email_test_v1()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  state_row public.complete_power_outage_notification_email_test_state%rowtype;
  selected_delivery public.complete_power_outage_notification_email_test_deliveries%rowtype;
  new_lease_token uuid := gen_random_uuid();
begin
  select * into state_row
  from public.complete_power_outage_notification_email_test_state
  where singleton for update;

  if state_row.singleton is null or not state_row.test_enabled then
    return jsonb_build_object('status', 'disabled', 'delivery', null);
  end if;

  update public.complete_power_outage_notification_email_test_deliveries delivery
  set delivery_status = case when delivery.attempt_count < delivery.max_attempt_count then 'pending' else 'failed' end,
      lease_token = null,
      lease_expires_at = null,
      finished_at = case when delivery.attempt_count >= delivery.max_attempt_count then now() else delivery.finished_at end,
      last_error_code = 'COMPLETE_RESEND_TEST_LEASE_EXPIRED',
      last_error_message = 'Predchozi TEST worker nedokoncil polozku pred vyprsenim lease.'
  where delivery.delivery_status = 'processing' and delivery.lease_expires_at <= now();

  select delivery.* into selected_delivery
  from public.complete_power_outage_notification_email_test_deliveries delivery
  where delivery.delivery_status = 'pending'
    and delivery.attempt_count < delivery.max_attempt_count
  order by delivery.requested_at desc, delivery.id
  limit 1
  for update skip locked;

  if selected_delivery.id is null then
    update public.complete_power_outage_notification_email_test_state
    set test_enabled = false,
        last_error_at = now(),
        last_error_code = 'COMPLETE_RESEND_TEST_EMPTY',
        last_error_message = 'Nebyla pripravena zadna TEST zprava.'
    where singleton;
    return jsonb_build_object('status', 'empty', 'delivery', null);
  end if;

  update public.complete_power_outage_notification_email_test_deliveries
  set delivery_status = 'processing',
      attempt_count = attempt_count + 1,
      lease_token = new_lease_token,
      lease_expires_at = now() + interval '2 minutes'
  where id = selected_delivery.id
  returning * into selected_delivery;

  return jsonb_build_object(
    'status', 'claimed',
    'leaseToken', new_lease_token,
    'delivery', jsonb_build_object(
      'id', selected_delivery.id,
      'subject', selected_delivery.subject_snapshot,
      'text', selected_delivery.text_snapshot,
      'companyName', selected_delivery.company_name_snapshot,
      'startsAt', selected_delivery.starts_at_snapshot,
      'endsAt', selected_delivery.ends_at_snapshot,
      'addresses', selected_delivery.address_snapshot,
      'originalRecipient', selected_delivery.original_recipient_email,
      'attemptCount', selected_delivery.attempt_count
    )
  );
end;
$$;

create or replace function public.finish_complete_power_outage_notification_email_test_sent_v1(
  requested_delivery_id uuid,
  requested_lease_token uuid,
  requested_provider_message_id text,
  requested_test_recipient text
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare affected_count integer;
begin
  update public.complete_power_outage_notification_email_test_deliveries
  set delivery_status = 'sent',
      provider_message_id = requested_provider_message_id,
      test_recipient_email = lower(btrim(requested_test_recipient)),
      sent_at = now(),
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = null,
      last_error_message = null
  where id = requested_delivery_id
    and delivery_status = 'processing'
    and lease_token = requested_lease_token;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then raise exception 'TEST doruceni jiz nema platnou lease.'; end if;

  update public.complete_power_outage_notification_email_test_state
  set test_enabled = false,
      last_sent_at = now(),
      last_error_code = null,
      last_error_message = null
  where singleton;
  return jsonb_build_object('status', 'sent', 'deliveryId', requested_delivery_id);
end;
$$;

create or replace function public.finish_complete_power_outage_notification_email_test_failed_v1(
  requested_delivery_id uuid,
  requested_lease_token uuid,
  requested_error_code text,
  requested_error_message text
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare affected_count integer;
begin
  update public.complete_power_outage_notification_email_test_deliveries
  set delivery_status = 'failed',
      finished_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error_code = left(coalesce(nullif(btrim(requested_error_code), ''), 'COMPLETE_RESEND_TEST_FAILED'), 160),
      last_error_message = left(coalesce(nullif(btrim(requested_error_message), ''), 'Resend TEST selhal.'), 2000)
  where id = requested_delivery_id
    and delivery_status = 'processing'
    and lease_token = requested_lease_token;
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then raise exception 'TEST doruceni jiz nema platnou lease.'; end if;

  update public.complete_power_outage_notification_email_test_state
  set test_enabled = false,
      last_error_at = now(),
      last_error_code = left(coalesce(nullif(btrim(requested_error_code), ''), 'COMPLETE_RESEND_TEST_FAILED'), 160),
      last_error_message = left(coalesce(nullif(btrim(requested_error_message), ''), 'Resend TEST selhal.'), 2000)
  where singleton;
  return jsonb_build_object('status', 'failed', 'deliveryId', requested_delivery_id);
end;
$$;

-- Puvodni delsi identifikator PostgreSQL zkratil na 63 znaku. DROP pouziva
-- stejny vstup, a proto bezpecne odstrani prave tuto legacy funkci.
drop function if exists public.record_complete_power_outage_notification_email_test_resend_event_v1(text,text,text,jsonb);

create or replace function public.record_cpo_notification_email_test_event_v1(
  requested_provider_event_id text,
  requested_provider_message_id text,
  requested_event_kind text,
  requested_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '5s' as $$
declare
  selected_delivery_id uuid;
  inserted_count integer;
begin
  select id into selected_delivery_id
  from public.complete_power_outage_notification_email_test_deliveries
  where provider_message_id = requested_provider_message_id;
  if selected_delivery_id is null then return jsonb_build_object('ignored', true, 'duplicate', false); end if;

  insert into public.complete_power_outage_notification_email_test_events (
    delivery_id, provider_event_id, provider_message_id, event_kind, payload
  ) values (
    selected_delivery_id, requested_provider_event_id, requested_provider_message_id,
    requested_event_kind, requested_payload
  ) on conflict (provider_event_id) do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return jsonb_build_object('ignored', false, 'duplicate', true); end if;

  update public.complete_power_outage_notification_email_test_deliveries
  set delivery_status = case requested_event_kind
        when 'email.delivered' then 'delivered'
        when 'email.delivery_delayed' then 'delivery_delayed'
        when 'email.bounced' then 'bounced'
        when 'email.complained' then 'complained'
        when 'email.failed' then 'failed'
        when 'email.suppressed' then 'suppressed'
        else delivery_status
      end,
      delivered_at = case when requested_event_kind = 'email.delivered' then now() else delivered_at end,
      last_error_code = case when requested_event_kind in ('email.bounced','email.complained','email.failed','email.suppressed') then upper(replace(requested_event_kind, '.', '_')) else last_error_code end,
      last_error_message = case when requested_event_kind in ('email.bounced','email.complained','email.failed','email.suppressed') then 'Resend oznamil neuspesny TEST stav.' else last_error_message end
  where id = selected_delivery_id;

  if requested_event_kind = 'email.delivered' then
    update public.complete_power_outage_notification_email_test_state set last_delivered_at = now() where singleton;
  end if;
  return jsonb_build_object('ignored', false, 'duplicate', false, 'deliveryId', selected_delivery_id);
end;
$$;

create or replace function public.get_complete_power_outage_notification_email_test_summary_v1()
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  ) then raise exception 'Resend TEST KOMPLETNI je dostupny pouze administratorum.'; end if;

  select jsonb_build_object(
    'testEnabled', state_row.test_enabled,
    'providerNamespace', state_row.provider_namespace,
    'lastRequestedAt', state_row.last_requested_at,
    'lastSentAt', state_row.last_sent_at,
    'lastDeliveredAt', state_row.last_delivered_at,
    'lastErrorCode', state_row.last_error_code,
    'lastErrorMessage', state_row.last_error_message,
    'pendingCount', count(delivery.id) filter (where delivery.delivery_status = 'pending'),
    'processingCount', count(delivery.id) filter (where delivery.delivery_status = 'processing'),
    'sentCount', count(delivery.id) filter (where delivery.delivery_status in ('sent','delivered')),
    'failedCount', count(delivery.id) filter (where delivery.delivery_status in ('failed','bounced','complained','suppressed')),
    'liveDispatchAvailable', false,
    'automaticDispatchSchedule', false
  ) into result
  from public.complete_power_outage_notification_email_test_state state_row
  left join public.complete_power_outage_notification_email_test_deliveries delivery on true
  where state_row.singleton
  group by state_row.singleton, state_row.test_enabled, state_row.provider_namespace,
    state_row.last_requested_at, state_row.last_sent_at, state_row.last_delivered_at,
    state_row.last_error_code, state_row.last_error_message;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.prevent_complete_notification_email_test_event_mutation()
  from public, anon, authenticated;
revoke all on function public.prepare_complete_power_outage_notification_email_test_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_notification_email_test_v1()
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_notification_email_test_sent_v1(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_notification_email_test_failed_v1(uuid,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.get_complete_power_outage_notification_email_test_summary_v1()
  from public, anon;

grant execute on function public.prepare_complete_power_outage_notification_email_test_v1(uuid)
  to service_role;
grant execute on function public.claim_complete_power_outage_notification_email_test_v1()
  to service_role;
grant execute on function public.finish_complete_power_outage_notification_email_test_sent_v1(uuid,uuid,text,text)
  to service_role;
grant execute on function public.finish_complete_power_outage_notification_email_test_failed_v1(uuid,uuid,text,text)
  to service_role;
grant execute on function public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)
  to service_role;
grant execute on function public.get_complete_power_outage_notification_email_test_summary_v1()
  to authenticated, service_role;

-- Zadne automaticke odesilani KOMPLETNI nesmi v TEST kroku existovat.
do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname ilike '%complete%notification%email%send%'
       or jobname ilike '%complete%notification%email%dispatch%'
  loop perform cron.unschedule(existing_job.jobid); end loop;
end
$$;

notify pgrst, 'reload schema';
commit;
