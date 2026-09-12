begin;

-- Krok 9: samostatne SHADOW planovani provoznich e-mailovych upozorneni
-- pro tab KOMPLETNI. Tato vetev nepouziva zadnou tabulku, stav, funkci,
-- cron ani Resend konfiguraci rozesilani MARKETY a nikdy nic neodesila.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_contact_discovery_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_contact_discovery_state');
  end if;
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_contact_discovery_selectors');
  end if;
  if to_regclass('public.complete_power_outage_contact_discovery_batches') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_contact_discovery_batches');
  end if;
  if to_regclass('public.complete_power_outage_contact_discovery_batch_items') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_contact_discovery_batch_items');
  end if;
  if to_regclass('public.complete_power_outage_contact_classification_effective_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_contact_classification_effective_v1');
  end if;
  if to_regclass('public.complete_power_outage_companies') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_companies');
  end if;
  if to_regclass('public.complete_power_outage_addresses') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_addresses');
  end if;
  if to_regclass('public.complete_power_outages') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outages');
  end if;
  if to_regclass('public.complete_power_outage_company_profiles') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_company_profiles');
  end if;
  if to_regclass('public.complete_power_outage_job_links') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_job_links');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    missing_dependencies := array_append(missing_dependencies, 'extensions.digest(text,text)');
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.set_power_outage_updated_at()');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro SHADOW planovani e-mailu KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_state (
  singleton boolean primary key default true check (singleton),
  runtime_mode text not null default 'disabled',
  planning_enabled boolean not null default false,
  dispatch_enabled boolean not null default false,
  provider_namespace text not null default 'complete_resend',
  active_selector_key text not null default 'top_v1'
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  planner_contract_version integer not null default 1,
  content_contract_version integer not null default 1,
  auto_pause_after_failures integer not null default 3,
  consecutive_failure_count integer not null default 0,
  last_planned_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_notification_email_state_mode_check check (
    runtime_mode in ('disabled', 'shadow', 'paused', 'test', 'live')
  ),
  constraint cpo_notification_email_state_planning_check check (
    not planning_enabled or runtime_mode in ('shadow', 'test', 'live')
  ),
  constraint cpo_notification_email_state_dispatch_check check (
    not dispatch_enabled
    or (planning_enabled and runtime_mode in ('test', 'live'))
  ),
  constraint cpo_notification_email_state_provider_check check (
    provider_namespace = 'complete_resend'
  ),
  constraint cpo_notification_email_state_versions_check check (
    planner_contract_version > 0 and content_contract_version > 0
  ),
  constraint cpo_notification_email_state_failure_check check (
    auto_pause_after_failures between 1 and 10
    and consecutive_failure_count >= 0
  ),
  constraint cpo_notification_email_state_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.complete_power_outage_notification_email_state (
  singleton, runtime_mode, planning_enabled, dispatch_enabled,
  provider_namespace, active_selector_key, metadata
)
select
  true,
  'shadow',
  true,
  false,
  'complete_resend',
  contact_state.selected_selector_key,
  jsonb_build_object(
    'contract', 'complete-notification-email-planning-shadow-v1',
    'marketEmailIsolation', true,
    'resendIntegrationEnabled', false,
    'futureApiNamespace', '/api/power-outages/complete/notification-emails',
    'futureEnvironmentPrefix', 'COMPLETE_RESEND_',
    'activatedAt', now()
  )
from public.complete_power_outage_contact_discovery_state contact_state
where contact_state.singleton
on conflict (singleton) do update
set runtime_mode = 'shadow',
    planning_enabled = true,
    dispatch_enabled = false,
    active_selector_key = excluded.active_selector_key,
    planner_contract_version = 1,
    content_contract_version = 1,
    consecutive_failure_count = 0,
    last_error_code = null,
    last_error_message = null,
    metadata = public.complete_power_outage_notification_email_state.metadata
      || excluded.metadata,
    updated_at = now();

-- Append-only evidence odhlaseni. Verejny odhlasovaci endpoint vznikne az
-- v kroku 10; v tomto kroku tabulka pouze bezpecne ovlivnuje SHADOW plan.
create table if not exists public.complete_power_outage_notification_email_suppression_events (
  id uuid primary key default gen_random_uuid(),
  normalized_email text not null,
  action text not null,
  source text not null,
  reason text not null,
  related_plan_id uuid,
  actor_user_id uuid references public.profiles(id) on delete set null,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_notification_email_suppression_email_check check (
    normalized_email = lower(btrim(normalized_email))
    and normalized_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint cpo_notification_email_suppression_action_check check (
    action in ('suppress', 'revoke')
  ),
  constraint cpo_notification_email_suppression_source_check check (
    source in ('unsubscribe', 'administrator', 'provider_complaint', 'provider_bounce', 'import')
  ),
  constraint cpo_notification_email_suppression_reason_check check (
    btrim(reason) <> ''
  ),
  constraint cpo_notification_email_suppression_evidence_check check (
    jsonb_typeof(evidence) = 'object'
  )
);

create index if not exists cpo_notification_email_suppression_latest_idx
  on public.complete_power_outage_notification_email_suppression_events (
    normalized_email, created_at desc, id desc
  );

create or replace function public.prevent_complete_notification_email_suppression_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie odhlaseni je nemenna; vlozte novou udalost.';
end;
$$;

drop trigger if exists cpo_notification_email_suppression_immutable
  on public.complete_power_outage_notification_email_suppression_events;
create trigger cpo_notification_email_suppression_immutable
before update or delete
on public.complete_power_outage_notification_email_suppression_events
for each row execute function public.prevent_complete_notification_email_suppression_mutation();

create or replace view public.complete_power_outage_notification_email_suppressions_v1
with (security_invoker = true)
as
select distinct on (suppression.normalized_email)
  suppression.normalized_email,
  suppression.action = 'suppress' as is_suppressed,
  suppression.source,
  suppression.reason,
  suppression.created_at
from public.complete_power_outage_notification_email_suppression_events suppression
order by suppression.normalized_email, suppression.created_at desc, suppression.id desc;

create table if not exists public.complete_power_outage_notification_email_plans (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.complete_power_outage_contact_discovery_batches(id) on delete restrict,
  selector_key text not null
    references public.complete_power_outage_contact_discovery_selectors(selector_key) on delete restrict,
  ico text not null,
  company_profile_id uuid not null,
  outage_id uuid references public.complete_power_outages(id) on delete set null,
  event_kind text not null default 'new_outage',
  dedupe_key text not null unique,
  plan_status text not null default 'shadow_ready',
  recipient_email text not null,
  recipient_contact_id uuid not null,
  contact_class text not null,
  company_name_snapshot text not null,
  source_snapshot text not null,
  external_id_snapshot text not null,
  outage_title_snapshot text,
  starts_at_snapshot timestamptz not null,
  ends_at_snapshot timestamptz not null,
  municipality_snapshot text,
  address_snapshot jsonb not null default '[]'::jsonb,
  subject_snapshot text not null,
  text_snapshot text not null,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  planned_at timestamptz not null default now(),
  not_before_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_notification_email_plan_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_notification_email_plan_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_notification_email_plan_event_check check (
    event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h')
  ),
  constraint cpo_notification_email_plan_status_check check (
    plan_status in ('shadow_ready', 'suppressed', 'out_of_scope', 'expired', 'cancelled')
  ),
  constraint cpo_notification_email_plan_dedupe_check check (
    dedupe_key ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_notification_email_plan_email_check check (
    recipient_email = lower(btrim(recipient_email))
    and recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint cpo_notification_email_plan_source_check check (
    source_snapshot in ('cez', 'egd', 'pre')
  ),
  constraint cpo_notification_email_plan_period_check check (
    ends_at_snapshot > starts_at_snapshot and expires_at = starts_at_snapshot
  ),
  constraint cpo_notification_email_plan_addresses_check check (
    jsonb_typeof(address_snapshot) = 'array'
  ),
  constraint cpo_notification_email_plan_content_check check (
    btrim(company_name_snapshot) <> ''
    and btrim(external_id_snapshot) <> ''
    and btrim(subject_snapshot) <> ''
    and btrim(text_snapshot) <> ''
  ),
  constraint cpo_notification_email_plan_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists cpo_notification_email_plans_status_idx
  on public.complete_power_outage_notification_email_plans (
    plan_status, not_before_at, starts_at_snapshot
  );
create index if not exists cpo_notification_email_plans_company_idx
  on public.complete_power_outage_notification_email_plans (
    ico, starts_at_snapshot, created_at desc
  );
create index if not exists cpo_notification_email_plans_batch_idx
  on public.complete_power_outage_notification_email_plans (
    batch_id, plan_status, starts_at_snapshot
  );

alter table public.complete_power_outage_notification_email_suppression_events
  drop constraint if exists cpo_notification_email_suppression_plan_fkey;
alter table public.complete_power_outage_notification_email_suppression_events
  add constraint cpo_notification_email_suppression_plan_fkey
  foreign key (related_plan_id)
  references public.complete_power_outage_notification_email_plans(id) on delete set null;

create table if not exists public.complete_power_outage_notification_email_planning_runs (
  id uuid primary key default gen_random_uuid(),
  run_status text not null,
  selector_key text
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete set null,
  batch_id uuid
    references public.complete_power_outage_contact_discovery_batches(id)
    on delete set null,
  processed_count integer not null default 0,
  ready_count integer not null default 0,
  suppressed_count integer not null default 0,
  out_of_scope_count integer not null default 0,
  expired_count integer not null default 0,
  sending_attempted boolean not null default false,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_notification_email_run_status_check check (
    run_status in ('running', 'succeeded', 'skipped', 'failed')
  ),
  constraint cpo_notification_email_run_counts_check check (
    processed_count >= 0 and ready_count >= 0 and suppressed_count >= 0
    and out_of_scope_count >= 0 and expired_count >= 0
  ),
  constraint cpo_notification_email_run_never_sends_check check (not sending_attempted),
  constraint cpo_notification_email_run_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists cpo_notification_email_runs_latest_idx
  on public.complete_power_outage_notification_email_planning_runs (
    started_at desc
  );

drop trigger if exists cpo_notification_email_state_updated_at
  on public.complete_power_outage_notification_email_state;
create trigger cpo_notification_email_state_updated_at
before update on public.complete_power_outage_notification_email_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_notification_email_plans_updated_at
  on public.complete_power_outage_notification_email_plans;
create trigger cpo_notification_email_plans_updated_at
before update on public.complete_power_outage_notification_email_plans
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_notification_email_state enable row level security;
alter table public.complete_power_outage_notification_email_suppression_events enable row level security;
alter table public.complete_power_outage_notification_email_plans enable row level security;
alter table public.complete_power_outage_notification_email_planning_runs enable row level security;

revoke all on table public.complete_power_outage_notification_email_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_suppression_events
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_plans
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_planning_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_suppressions_v1
  from public, anon, authenticated;

grant all on table public.complete_power_outage_notification_email_state to service_role;
grant all on table public.complete_power_outage_notification_email_suppression_events to service_role;
grant all on table public.complete_power_outage_notification_email_plans to service_role;
grant all on table public.complete_power_outage_notification_email_planning_runs to service_role;
grant select on table public.complete_power_outage_notification_email_suppressions_v1 to service_role;

-- Jeden kandidat planu = jedna firma (ICO) a jedna budouci odstavka.
-- Vice nalezenych adres stejne firmy v teze odstavce se slouci do snapshotu.
create or replace view public.complete_power_outage_notification_email_candidates_v1
with (security_invoker = true)
as
with runtime as (
  select email_state.active_selector_key
  from public.complete_power_outage_notification_email_state email_state
  where email_state.singleton
), active_batch as (
  select batch.id, batch.selector_key
  from runtime
  join lateral (
    select candidate_batch.*
    from public.complete_power_outage_contact_discovery_batches candidate_batch
    where candidate_batch.selector_key = runtime.active_selector_key
      and candidate_batch.batch_status in ('ready', 'active', 'paused', 'completed')
    order by candidate_batch.created_at desc
    limit 1
  ) batch on true
), scoped_addresses as (
  select distinct
    active_batch.id as batch_id,
    active_batch.selector_key,
    batch_item.company_profile_id,
    company.ico,
    profile.official_name as company_name,
    effective.shadow_contact_id as recipient_contact_id,
    effective.normalized_value as recipient_email,
    effective.contact_class,
    outage.id as outage_id,
    outage.source,
    outage.external_id,
    outage.title,
    outage.starts_at,
    outage.ends_at,
    outage.municipality,
    address.id as address_id,
    address.municipality as address_municipality,
    address.street,
    address.house_number,
    address.orientation_number,
    address.postal_code,
    address.raw_address
  from active_batch
  join public.complete_power_outage_contact_discovery_batch_items batch_item
    on batch_item.batch_id = active_batch.id
  join public.complete_power_outage_company_profiles profile
    on profile.id = batch_item.company_profile_id and profile.ico = batch_item.ico
  join public.complete_power_outage_contact_classification_effective_v1 effective
    on effective.company_profile_id = batch_item.company_profile_id
   and effective.ico = batch_item.ico
   and effective.contact_type = 'email'
   and effective.notification_eligible
   and effective.is_primary
  join public.complete_power_outage_companies company
    on company.ico = batch_item.ico
   and company.candidate_status = 'confirmed'
   and company.business_relevance_status = 'eligible'
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where outage.source_status = 'scheduled'
    and outage.starts_at > now()
    and not exists (
      select 1
      from public.complete_power_outage_companies linked_company
      join public.complete_power_outage_addresses linked_address
        on linked_address.id = linked_company.outage_address_id
      join public.complete_power_outage_job_links job_link
        on job_link.candidate_id = linked_company.id
      where linked_company.ico = company.ico
        and linked_address.outage_id = outage.id
    )
), grouped as (
  select
    scoped.batch_id,
    scoped.selector_key,
    scoped.company_profile_id,
    scoped.ico,
    scoped.company_name,
    scoped.recipient_contact_id,
    lower(scoped.recipient_email) as recipient_email,
    scoped.contact_class,
    scoped.outage_id,
    scoped.source,
    scoped.external_id,
    scoped.title,
    scoped.starts_at,
    scoped.ends_at,
    scoped.municipality,
    jsonb_agg(
      jsonb_build_object(
        'municipality', scoped.address_municipality,
        'street', scoped.street,
        'houseNumber', scoped.house_number,
        'orientationNumber', scoped.orientation_number,
        'postalCode', scoped.postal_code,
        'rawAddress', scoped.raw_address
      ) order by scoped.address_municipality, scoped.street,
        scoped.house_number, scoped.orientation_number, scoped.address_id
    ) as address_snapshot
  from scoped_addresses scoped
  group by
    scoped.batch_id, scoped.selector_key, scoped.company_profile_id,
    scoped.ico, scoped.company_name, scoped.recipient_contact_id,
    lower(scoped.recipient_email), scoped.contact_class, scoped.outage_id,
    scoped.source, scoped.external_id, scoped.title, scoped.starts_at,
    scoped.ends_at, scoped.municipality
)
select
  grouped.*,
  encode(extensions.digest(
    concat('complete-notification-email-v1:new_outage:', grouped.ico, ':', grouped.outage_id),
    'sha256'
  ), 'hex') as dedupe_key,
  coalesce(suppression.is_suppressed, false) as is_suppressed,
  format(
    'Planovana odstavka elektriny - %s - %s',
    grouped.company_name,
    to_char(grouped.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY')
  ) as subject_snapshot,
  format(
    E'Dobry den,\n\nupozornujeme na planovanou odstavku elektriny, ktera se muze tykat provozu firmy %s. Termin: %s az %s. Distributor: %s.\n\nPred odeslanim bude zprava doplnena o jasnou moznost odhlaseni dalsich upozorneni.',
    grouped.company_name,
    grouped.starts_at at time zone 'Europe/Prague',
    grouped.ends_at at time zone 'Europe/Prague',
    upper(grouped.source)
  ) as text_snapshot
from grouped
left join public.complete_power_outage_notification_email_suppressions_v1 suppression
  on suppression.normalized_email = grouped.recipient_email;

revoke all on table public.complete_power_outage_notification_email_candidates_v1
  from public, anon, authenticated;
grant select on table public.complete_power_outage_notification_email_candidates_v1
  to service_role;

create or replace function public.refresh_complete_power_outage_notification_email_plans_v1(
  requested_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare state_row public.complete_power_outage_notification_email_state%rowtype;
declare v_run_id uuid := gen_random_uuid();
declare v_selected_batch_id uuid;
declare v_processed_count integer := 0;
declare v_ready_count integer := 0;
declare v_suppressed_count integer := 0;
declare v_out_of_scope_count integer := 0;
declare v_expired_count integer := 0;
begin
  if requested_limit < 1 or requested_limit > 5000 then
    raise exception 'Velikost planovaci davky musi byt mezi 1 a 5000.';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_planner_v1', 0)
  ) then
    return jsonb_build_object(
      'status', 'skipped', 'reason', 'already_running',
      'sendingAttempted', false
    );
  end if;

  select * into state_row
  from public.complete_power_outage_notification_email_state
  where singleton;

  if state_row.singleton is null or not state_row.planning_enabled
     or state_row.runtime_mode <> 'shadow'
  then
    return jsonb_build_object(
      'status', coalesce(state_row.runtime_mode, 'disabled'),
      'plannedCount', 0, 'sendingAttempted', false
    );
  end if;

  -- Selector je sdilen pouze jako vstupni volba; stav a zpracovani zustavaji
  -- ve vlastnim subsystému KOMPLETNI.
  update public.complete_power_outage_notification_email_state email_state
  set active_selector_key = contact_state.selected_selector_key
  from public.complete_power_outage_contact_discovery_state contact_state
  where email_state.singleton and contact_state.singleton
    and email_state.active_selector_key is distinct from contact_state.selected_selector_key;

  select * into state_row
  from public.complete_power_outage_notification_email_state
  where singleton;

  select batch.id into v_selected_batch_id
  from public.complete_power_outage_notification_email_state email_state
  join lateral (
    select candidate_batch.id
    from public.complete_power_outage_contact_discovery_batches candidate_batch
    where candidate_batch.selector_key = email_state.active_selector_key
      and candidate_batch.batch_status in ('ready', 'active', 'paused', 'completed')
    order by candidate_batch.created_at desc
    limit 1
  ) batch on true
  where email_state.singleton;

  if v_selected_batch_id is null then
    update public.complete_power_outage_notification_email_state
    set last_planned_at = now(),
        last_error_code = null,
        last_error_message = null
    where singleton;
    return jsonb_build_object(
      'status', 'waiting_batch', 'plannedCount', 0,
      'sendingAttempted', false
    );
  end if;

  insert into public.complete_power_outage_notification_email_planning_runs (
    id, run_status, selector_key, batch_id, metadata
  ) values (
    v_run_id, 'running', state_row.active_selector_key, v_selected_batch_id,
    jsonb_build_object('contract', 'complete-notification-email-planner-run-v1')
  );

  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'expired'
  where plan.plan_status in ('shadow_ready', 'suppressed')
    and plan.expires_at <= now();
  get diagnostics v_expired_count = row_count;

  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'out_of_scope'
  where plan.plan_status in ('shadow_ready', 'suppressed')
    and plan.batch_id <> v_selected_batch_id;
  get diagnostics v_out_of_scope_count = row_count;

  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'out_of_scope'
  where plan.plan_status in ('shadow_ready', 'suppressed')
    and plan.batch_id = v_selected_batch_id
    and not exists (
      select 1
      from public.complete_power_outage_notification_email_candidates_v1 candidate
      where candidate.dedupe_key = plan.dedupe_key
    );
  get diagnostics v_processed_count = row_count;
  v_out_of_scope_count := v_out_of_scope_count + v_processed_count;

  insert into public.complete_power_outage_notification_email_plans (
    batch_id, selector_key, ico, company_profile_id, outage_id,
    event_kind, dedupe_key, plan_status, recipient_email,
    recipient_contact_id, contact_class, company_name_snapshot,
    source_snapshot, external_id_snapshot, outage_title_snapshot,
    starts_at_snapshot, ends_at_snapshot, municipality_snapshot,
    address_snapshot, subject_snapshot, text_snapshot,
    not_before_at, expires_at, metadata
  )
  select
    candidate.batch_id,
    candidate.selector_key,
    candidate.ico,
    candidate.company_profile_id,
    candidate.outage_id,
    'new_outage',
    candidate.dedupe_key,
    case when candidate.is_suppressed then 'suppressed' else 'shadow_ready' end,
    candidate.recipient_email,
    candidate.recipient_contact_id,
    candidate.contact_class,
    candidate.company_name,
    candidate.source,
    candidate.external_id,
    candidate.title,
    candidate.starts_at,
    candidate.ends_at,
    candidate.municipality,
    candidate.address_snapshot,
    candidate.subject_snapshot,
    candidate.text_snapshot,
    now(),
    candidate.starts_at,
    jsonb_build_object(
      'contract', 'complete-notification-email-plan-v1',
      'plannerMode', 'shadow',
      'sendingAttempted', false,
      'unsubscribeRequired', true,
      'existingJobExcluded', true,
      'marketEmailIsolation', true
    )
  from public.complete_power_outage_notification_email_candidates_v1 candidate
  where not exists (
    select 1
    from public.complete_power_outage_notification_email_plans current_plan
    where current_plan.dedupe_key = candidate.dedupe_key
      and current_plan.batch_id = candidate.batch_id
      and current_plan.selector_key = candidate.selector_key
      and current_plan.plan_status = case
        when candidate.is_suppressed then 'suppressed' else 'shadow_ready'
      end
      and current_plan.recipient_email = candidate.recipient_email
      and current_plan.recipient_contact_id = candidate.recipient_contact_id
      and current_plan.contact_class = candidate.contact_class
      and current_plan.company_name_snapshot = candidate.company_name
      and current_plan.source_snapshot = candidate.source
      and current_plan.external_id_snapshot = candidate.external_id
      and current_plan.outage_title_snapshot is not distinct from candidate.title
      and current_plan.starts_at_snapshot = candidate.starts_at
      and current_plan.ends_at_snapshot = candidate.ends_at
      and current_plan.municipality_snapshot is not distinct from candidate.municipality
      and current_plan.address_snapshot = candidate.address_snapshot
      and current_plan.subject_snapshot = candidate.subject_snapshot
      and current_plan.text_snapshot = candidate.text_snapshot
      and current_plan.expires_at = candidate.starts_at
  )
  order by candidate.starts_at, candidate.ico, candidate.outage_id
  limit requested_limit
  on conflict (dedupe_key) do update
  set batch_id = excluded.batch_id,
      selector_key = excluded.selector_key,
      company_profile_id = excluded.company_profile_id,
      outage_id = excluded.outage_id,
      plan_status = excluded.plan_status,
      recipient_email = excluded.recipient_email,
      recipient_contact_id = excluded.recipient_contact_id,
      contact_class = excluded.contact_class,
      company_name_snapshot = excluded.company_name_snapshot,
      source_snapshot = excluded.source_snapshot,
      external_id_snapshot = excluded.external_id_snapshot,
      outage_title_snapshot = excluded.outage_title_snapshot,
      starts_at_snapshot = excluded.starts_at_snapshot,
      ends_at_snapshot = excluded.ends_at_snapshot,
      municipality_snapshot = excluded.municipality_snapshot,
      address_snapshot = excluded.address_snapshot,
      subject_snapshot = excluded.subject_snapshot,
      text_snapshot = excluded.text_snapshot,
      expires_at = excluded.expires_at,
      metadata = excluded.metadata,
      updated_at = now()
  where (
    public.complete_power_outage_notification_email_plans.batch_id,
    public.complete_power_outage_notification_email_plans.selector_key,
    public.complete_power_outage_notification_email_plans.company_profile_id,
    public.complete_power_outage_notification_email_plans.outage_id,
    public.complete_power_outage_notification_email_plans.plan_status,
    public.complete_power_outage_notification_email_plans.recipient_email,
    public.complete_power_outage_notification_email_plans.recipient_contact_id,
    public.complete_power_outage_notification_email_plans.contact_class,
    public.complete_power_outage_notification_email_plans.company_name_snapshot,
    public.complete_power_outage_notification_email_plans.source_snapshot,
    public.complete_power_outage_notification_email_plans.external_id_snapshot,
    public.complete_power_outage_notification_email_plans.outage_title_snapshot,
    public.complete_power_outage_notification_email_plans.starts_at_snapshot,
    public.complete_power_outage_notification_email_plans.ends_at_snapshot,
    public.complete_power_outage_notification_email_plans.municipality_snapshot,
    public.complete_power_outage_notification_email_plans.address_snapshot,
    public.complete_power_outage_notification_email_plans.subject_snapshot,
    public.complete_power_outage_notification_email_plans.text_snapshot,
    public.complete_power_outage_notification_email_plans.expires_at,
    public.complete_power_outage_notification_email_plans.metadata
  ) is distinct from (
    excluded.batch_id,
    excluded.selector_key,
    excluded.company_profile_id,
    excluded.outage_id,
    excluded.plan_status,
    excluded.recipient_email,
    excluded.recipient_contact_id,
    excluded.contact_class,
    excluded.company_name_snapshot,
    excluded.source_snapshot,
    excluded.external_id_snapshot,
    excluded.outage_title_snapshot,
    excluded.starts_at_snapshot,
    excluded.ends_at_snapshot,
    excluded.municipality_snapshot,
    excluded.address_snapshot,
    excluded.subject_snapshot,
    excluded.text_snapshot,
    excluded.expires_at,
    excluded.metadata
  );
  get diagnostics v_processed_count = row_count;

  select
    count(*) filter (where plan_status = 'shadow_ready'),
    count(*) filter (where plan_status = 'suppressed')
  into v_ready_count, v_suppressed_count
  from public.complete_power_outage_notification_email_plans
  where batch_id = v_selected_batch_id;

  update public.complete_power_outage_notification_email_planning_runs
  set run_status = 'succeeded',
      processed_count = v_processed_count,
      ready_count = v_ready_count,
      suppressed_count = v_suppressed_count,
      out_of_scope_count = v_out_of_scope_count,
      expired_count = v_expired_count,
      finished_at = now()
  where id = v_run_id;

  update public.complete_power_outage_notification_email_state
  set last_planned_at = now(),
      last_success_at = now(),
      consecutive_failure_count = 0,
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'activeBatchId', v_selected_batch_id,
        'lastProcessedCount', v_processed_count,
        'readyPlanCount', v_ready_count,
        'suppressedPlanCount', v_suppressed_count,
        'sendingAttempted', false
      )
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'batchId', v_selected_batch_id,
    'processedCount', v_processed_count,
    'readyCount', v_ready_count,
    'suppressedCount', v_suppressed_count,
    'outOfScopeCount', v_out_of_scope_count,
    'expiredCount', v_expired_count,
    'sendingAttempted', false
  );
exception
  when others then
    insert into public.complete_power_outage_notification_email_planning_runs (
      id, run_status, selector_key, batch_id, sending_attempted,
      error_code, error_message, finished_at, metadata
    ) values (
      v_run_id,
      'failed',
      state_row.active_selector_key,
      v_selected_batch_id,
      false,
      'COMPLETE_NOTIFICATION_EMAIL_PLAN_FAILED',
      left(sqlerrm, 2000),
      now(),
      jsonb_build_object('contract', 'complete-notification-email-planner-run-v1')
    ) on conflict (id) do update
      set run_status = 'failed',
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          finished_at = excluded.finished_at;

    update public.complete_power_outage_notification_email_state
    set consecutive_failure_count = consecutive_failure_count + 1,
        planning_enabled = case
          when consecutive_failure_count + 1 >= auto_pause_after_failures then false
          else planning_enabled
        end,
        runtime_mode = case
          when consecutive_failure_count + 1 >= auto_pause_after_failures then 'paused'
          else runtime_mode
        end,
        last_error_at = now(),
        last_error_code = 'COMPLETE_NOTIFICATION_EMAIL_PLAN_FAILED',
        last_error_message = left(sqlerrm, 2000),
        metadata = metadata || jsonb_build_object(
          'autoPaused', consecutive_failure_count + 1 >= auto_pause_after_failures,
          'sendingAttempted', false
        )
    where singleton;

    return jsonb_build_object(
      'status', 'failed',
      'errorCode', 'COMPLETE_NOTIFICATION_EMAIL_PLAN_FAILED',
      'errorMessage', sqlerrm,
      'sendingAttempted', false
    );
end;
$$;

revoke all on function public.refresh_complete_power_outage_notification_email_plans_v1(integer)
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_notification_email_plans_v1(integer)
  to service_role;

create or replace view public.complete_power_outage_notification_email_planning_overview
with (security_invoker = true)
as
select
  state_row.runtime_mode,
  state_row.planning_enabled,
  state_row.dispatch_enabled,
  state_row.provider_namespace,
  state_row.active_selector_key,
  state_row.consecutive_failure_count,
  state_row.auto_pause_after_failures,
  state_row.last_planned_at,
  state_row.last_success_at,
  state_row.last_error_at,
  state_row.last_error_code,
  state_row.last_error_message,
  count(plan.id) filter (where plan.plan_status = 'shadow_ready') as ready_plan_count,
  count(plan.id) filter (where plan.plan_status = 'suppressed') as suppressed_plan_count,
  count(plan.id) filter (where plan.plan_status = 'out_of_scope') as out_of_scope_plan_count,
  count(plan.id) filter (where plan.plan_status = 'expired') as expired_plan_count,
  count(distinct plan.ico) filter (where plan.plan_status = 'shadow_ready') as ready_company_count,
  max(plan.updated_at) as latest_plan_activity_at
from public.complete_power_outage_notification_email_state state_row
left join public.complete_power_outage_notification_email_plans plan on true
where state_row.singleton
group by
  state_row.runtime_mode, state_row.planning_enabled, state_row.dispatch_enabled,
  state_row.provider_namespace, state_row.active_selector_key,
  state_row.consecutive_failure_count, state_row.auto_pause_after_failures,
  state_row.last_planned_at, state_row.last_success_at, state_row.last_error_at,
  state_row.last_error_code, state_row.last_error_message;

revoke all on table public.complete_power_outage_notification_email_planning_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_notification_email_planning_overview
  to service_role;

create or replace function public.get_complete_power_outage_notification_email_planning_summary_v1()
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
    raise exception 'Planovani e-mailu KOMPLETNI je dostupne pouze administratorum.';
  end if;

  select to_jsonb(overview.*) into result
  from public.complete_power_outage_notification_email_planning_overview overview;
  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_complete_power_outage_notification_email_planning_summary_v1()
  from public, anon;
grant execute on function public.get_complete_power_outage_notification_email_planning_summary_v1()
  to authenticated, service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_notification_email_shadow_planning_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_notification_email_shadow_planning_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_notification_email_plans_v1(1000);$job$
  );
end
$$;

select public.refresh_complete_power_outage_notification_email_plans_v1(1000);

notify pgrst, 'reload schema';

commit;
