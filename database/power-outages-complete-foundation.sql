begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regprocedure('public.current_user_can_view_power_outages()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.current_user_can_view_power_outages().';
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.set_power_outage_updated_at().';
  end if;
end
$$;

-- Tento model je úmyslně oddělený od tabulek power_outages,
-- power_outage_addresses, power_outage_store_matches a stores.
create table if not exists public.complete_power_outage_source_state (
  source text primary key,
  coverage_status text not null default 'idle',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_change_at timestamptz,
  last_complete_at timestamptz,
  horizon_from timestamptz,
  horizon_to timestamptz,
  latest_source_ref text,
  latest_payload_sha256 text,
  published_outage_count integer not null default 0,
  published_address_count integer not null default 0,
  active_outage_count integer not null default 0,
  future_outage_count integer not null default 0,
  coverage_total_count integer not null default 0,
  coverage_processed_count integer not null default 0,
  consecutive_failure_count integer not null default 0,
  data_version bigint not null default 0,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  lock_token uuid,
  lock_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_source_state_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint cpo_source_state_status_check
    check (coverage_status in ('idle', 'processing', 'complete', 'partial', 'error')),
  constraint cpo_source_state_counts_check
    check (
      published_outage_count >= 0
      and published_address_count >= 0
      and active_outage_count >= 0
      and future_outage_count >= 0
      and coverage_total_count >= 0
      and coverage_processed_count >= 0
      and coverage_processed_count <= coverage_total_count
      and consecutive_failure_count >= 0
      and data_version >= 0
    ),
  constraint cpo_source_state_horizon_check
    check (horizon_from is null or horizon_to is null or horizon_to >= horizon_from),
  constraint cpo_source_state_hash_check
    check (latest_payload_sha256 is null or latest_payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_source_state_lock_check
    check (
      (lock_token is null and lock_expires_at is null)
      or (lock_token is not null and lock_expires_at is not null)
    ),
  constraint cpo_source_state_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.complete_power_outage_source_state is
  'Provozní stav celoplošného sběru ČEZ, EG.D a PRE pro oddělený režim KOMPLETNÍ.';

insert into public.complete_power_outage_source_state (source)
values ('cez'), ('egd'), ('pre')
on conflict (source) do nothing;

create table if not exists public.complete_power_outage_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null,
  source text,
  provider text,
  trigger_kind text not null default 'scheduled',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_record_count integer not null default 0,
  outage_upsert_count integer not null default 0,
  address_upsert_count integer not null default 0,
  company_upsert_count integer not null default 0,
  evidence_upsert_count integer not null default 0,
  cache_hit_count integer not null default 0,
  error_count integer not null default 0,
  payload_sha256 text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_runs_kind_check check (
    run_kind in (
      'source_sync', 'address_normalization', 'company_discovery',
      'company_reconciliation', 'archive', 'watchdog'
    )
  ),
  constraint cpo_runs_source_check
    check (source is null or source in ('cez', 'egd', 'pre')),
  constraint cpo_runs_provider_check
    check (provider is null or provider in ('ares', 'res', 'mapy', 'google')),
  constraint cpo_runs_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'retry', 'upstream_snapshot')),
  constraint cpo_runs_status_check
    check (status in ('running', 'succeeded', 'no_change', 'partial', 'failed', 'skipped')),
  constraint cpo_runs_finished_check check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  ),
  constraint cpo_runs_counts_check check (
    source_record_count >= 0
    and outage_upsert_count >= 0
    and address_upsert_count >= 0
    and company_upsert_count >= 0
    and evidence_upsert_count >= 0
    and cache_hit_count >= 0
    and error_count >= 0
  ),
  constraint cpo_runs_hash_check
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_runs_one_running_uidx
  on public.complete_power_outage_runs (
    run_kind,
    coalesce(source, ''),
    coalesce(provider, '')
  )
  where status = 'running';

create index if not exists cpo_runs_timeline_idx
  on public.complete_power_outage_runs (run_kind, started_at desc);

create index if not exists cpo_runs_source_idx
  on public.complete_power_outage_runs (source, status, started_at desc)
  where source is not null;

create index if not exists cpo_runs_provider_idx
  on public.complete_power_outage_runs (provider, status, started_at desc)
  where provider is not null;

create table if not exists public.complete_power_outages (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  source_status text not null default 'scheduled',
  title text,
  description text,
  reason text,
  contractor text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  archive_at timestamptz not null,
  municipality text,
  municipality_code text,
  district text,
  region text,
  source_url text,
  announcement_url text,
  payload_sha256 text not null,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complete_power_outages_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint complete_power_outages_external_id_check
    check (length(btrim(external_id)) between 1 and 256),
  constraint complete_power_outages_status_check
    check (source_status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint complete_power_outages_period_check
    check (ends_at > starts_at and archive_at = ends_at),
  constraint complete_power_outages_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint complete_power_outages_seen_check
    check (last_seen_at >= first_seen_at),
  constraint complete_power_outages_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint complete_power_outages_source_external_unique
    unique (source, external_id)
);

comment on table public.complete_power_outages is
  'Samostatný celoplošný katalog odstávek. Nemá vazbu na marketové shody ani Prodejny.';

create index if not exists complete_power_outages_timeline_idx
  on public.complete_power_outages (archive_at, starts_at, ends_at);

create index if not exists complete_power_outages_source_status_idx
  on public.complete_power_outages (source, source_status, starts_at);

create table if not exists public.complete_power_outage_addresses (
  id uuid primary key default gen_random_uuid(),
  outage_id uuid not null references public.complete_power_outages(id) on delete cascade,
  external_address_id text,
  address_key text not null,
  address_scope text not null default 'unresolved',
  lookup_status text not null default 'pending',
  ruian_address_id bigint,
  municipality text not null default '',
  municipality_code text,
  town_part text,
  street text not null default '',
  house_number text,
  orientation_number text,
  postal_code text,
  raw_address text not null default '',
  normalized_municipality text not null default '',
  normalized_street text not null default '',
  latitude double precision,
  longitude double precision,
  lookup_fingerprint text,
  lookup_priority integer not null default 100,
  lookup_attempt_count integer not null default 0,
  lookup_next_attempt_at timestamptz,
  lookup_started_at timestamptz,
  lookup_finished_at timestamptz,
  lookup_error_code text,
  lookup_error_message text,
  processing_token uuid,
  processing_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_addresses_key_check
    check (length(btrim(address_key)) between 1 and 256),
  constraint cpo_addresses_scope_check
    check (address_scope in ('exact', 'street', 'municipality', 'unresolved')),
  constraint cpo_addresses_lookup_status_check check (
    lookup_status in ('pending', 'processing', 'complete', 'needs_review', 'error', 'skipped')
  ),
  constraint cpo_addresses_ruian_check
    check (ruian_address_id is null or ruian_address_id > 0),
  constraint cpo_addresses_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint cpo_addresses_fingerprint_check check (
    lookup_fingerprint is null or lookup_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_addresses_queue_check check (
    lookup_priority >= 0
    and lookup_attempt_count >= 0
    and (
      (processing_token is null and processing_expires_at is null)
      or (processing_token is not null and processing_expires_at is not null)
    )
  ),
  constraint cpo_addresses_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_addresses_outage_key_unique
    unique (outage_id, address_key)
);

comment on table public.complete_power_outage_addresses is
  'Normalizované adresy celoplošných odstávek a samostatná fronta jejich firemního dohledání.';

create index if not exists cpo_addresses_outage_idx
  on public.complete_power_outage_addresses (outage_id);

create index if not exists cpo_addresses_ruian_idx
  on public.complete_power_outage_addresses (ruian_address_id)
  where ruian_address_id is not null;

create index if not exists cpo_addresses_match_idx
  on public.complete_power_outage_addresses (
    normalized_municipality,
    normalized_street,
    house_number,
    orientation_number
  );

create index if not exists cpo_addresses_queue_idx
  on public.complete_power_outage_addresses (
    lookup_status,
    lookup_priority,
    lookup_next_attempt_at,
    created_at
  )
  where lookup_status in ('pending', 'error');

create table if not exists public.complete_power_outage_companies (
  id uuid primary key default gen_random_uuid(),
  outage_address_id uuid not null
    references public.complete_power_outage_addresses(id) on delete cascade,
  candidate_key text not null,
  entity_kind text not null,
  company_name text not null,
  normalized_company_name text not null,
  ico text,
  legal_form text,
  nace_codes text[] not null default '{}'::text[],
  employee_category text,
  ruian_address_id bigint,
  display_address text,
  latitude double precision,
  longitude double precision,
  confidence numeric(5,4) not null default 0,
  candidate_status text not null default 'new',
  source_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_companies_key_check
    check (length(btrim(candidate_key)) between 1 and 256),
  constraint cpo_companies_kind_check
    check (entity_kind in ('registered_office', 'establishment', 'mixed')),
  constraint cpo_companies_name_check
    check (btrim(company_name) <> '' and btrim(normalized_company_name) <> ''),
  constraint cpo_companies_ico_check
    check (ico is null or ico ~ '^[0-9]{8}$'),
  constraint cpo_companies_ruian_check
    check (ruian_address_id is null or ruian_address_id > 0),
  constraint cpo_companies_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint cpo_companies_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint cpo_companies_status_check check (
    candidate_status in ('new', 'confirmed', 'needs_review', 'dismissed', 'stale')
  ),
  constraint cpo_companies_counts_check
    check (source_count >= 1),
  constraint cpo_companies_seen_check
    check (last_seen_at >= first_seen_at and last_verified_at >= first_seen_at),
  constraint cpo_companies_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_companies_address_candidate_unique
    unique (outage_address_id, candidate_key)
);

comment on table public.complete_power_outage_companies is
  'Sloučené kandidátní firmy a provozovny nalezené na adresách kompletních odstávek.';

create index if not exists cpo_companies_status_idx
  on public.complete_power_outage_companies (candidate_status, confidence desc, last_seen_at desc);

create index if not exists cpo_companies_address_idx
  on public.complete_power_outage_companies (outage_address_id, candidate_status);

create index if not exists cpo_companies_ico_idx
  on public.complete_power_outage_companies (ico, last_seen_at desc)
  where ico is not null;

create index if not exists cpo_companies_name_idx
  on public.complete_power_outage_companies (normalized_company_name);

create table if not exists public.complete_power_outage_company_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  provider text not null,
  provider_entity_id text not null,
  evidence_kind text not null,
  match_level text not null,
  display_name text not null,
  display_address text,
  source_url text,
  distance_meters integer,
  confidence numeric(5,4) not null default 0,
  payload_sha256 text,
  observed_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_evidence_provider_check
    check (provider in ('ares', 'res', 'mapy', 'google')),
  constraint cpo_evidence_provider_id_check
    check (btrim(provider_entity_id) <> ''),
  constraint cpo_evidence_display_name_check
    check (btrim(display_name) <> ''),
  constraint cpo_evidence_kind_check check (
    evidence_kind in ('registered_office', 'establishment', 'address_match', 'nearby')
  ),
  constraint cpo_evidence_level_check
    check (match_level in ('exact_address', 'same_building', 'nearby', 'unresolved')),
  constraint cpo_evidence_distance_check
    check (distance_meters is null or distance_meters >= 0),
  constraint cpo_evidence_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint cpo_evidence_hash_check
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_evidence_expiry_check
    check (expires_at is null or expires_at > observed_at),
  constraint cpo_evidence_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_evidence_company_provider_unique
    unique (company_id, provider, provider_entity_id)
);

comment on table public.complete_power_outage_company_evidence is
  'Normalizované důkazy ARES/RES, Mapy.com a Google. Metadata nesmí obsahovat API klíče ani nepovolená surová data poskytovatelů.';

create index if not exists cpo_evidence_company_idx
  on public.complete_power_outage_company_evidence (company_id, provider);

create index if not exists cpo_evidence_provider_idx
  on public.complete_power_outage_company_evidence (provider, observed_at desc);

create index if not exists cpo_evidence_expiry_idx
  on public.complete_power_outage_company_evidence (expires_at)
  where expires_at is not null;

create table if not exists public.complete_power_outage_lookup_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  lookup_kind text not null,
  lookup_key text not null,
  request_fingerprint text not null,
  lookup_status text not null,
  response_count integer not null default 0,
  response_sha256 text,
  normalized_results jsonb not null default '[]'::jsonb,
  attempt_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_cache_provider_check
    check (provider in ('ares', 'res', 'mapy', 'google')),
  constraint cpo_cache_kind_check
    check (lookup_kind in ('address', 'nearby', 'text')),
  constraint cpo_cache_key_check
    check (lookup_key ~ '^[a-f0-9]{64}$'),
  constraint cpo_cache_request_hash_check
    check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_cache_status_check
    check (lookup_status in ('ready', 'not_found', 'error')),
  constraint cpo_cache_counts_check
    check (response_count >= 0 and attempt_count >= 0),
  constraint cpo_cache_response_hash_check
    check (response_sha256 is null or response_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cache_results_check
    check (jsonb_typeof(normalized_results) = 'array'),
  constraint cpo_cache_expiry_check
    check (expires_at is null or expires_at > fetched_at),
  constraint cpo_cache_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_cache_provider_lookup_unique
    unique (provider, lookup_kind, lookup_key)
);

comment on table public.complete_power_outage_lookup_cache is
  'Oddělená cache adresních dotazů. Ukládá jen normalizované výsledky povolené podmínkami jednotlivých poskytovatelů.';

create index if not exists cpo_cache_expiry_idx
  on public.complete_power_outage_lookup_cache (provider, expires_at)
  where expires_at is not null;

create index if not exists cpo_cache_retry_idx
  on public.complete_power_outage_lookup_cache (provider, next_attempt_at)
  where lookup_status = 'error';

create table if not exists public.complete_power_outage_task_state (
  task_key text primary key,
  last_status text not null default 'idle',
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_processed_count integer not null default 0,
  consecutive_failure_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  cursor jsonb not null default '{}'::jsonb,
  lock_token uuid,
  lock_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_task_state_key_check check (
    task_key in (
      'sync_cez', 'sync_egd', 'sync_pre', 'normalize_addresses',
      'discover_ares', 'discover_res', 'discover_mapy', 'discover_google',
      'reconcile_companies', 'archive', 'watchdog'
    )
  ),
  constraint cpo_task_state_status_check
    check (last_status in ('idle', 'running', 'succeeded', 'partial', 'failed', 'skipped')),
  constraint cpo_task_state_counts_check
    check (last_processed_count >= 0 and consecutive_failure_count >= 0),
  constraint cpo_task_state_cursor_check
    check (jsonb_typeof(cursor) = 'object'),
  constraint cpo_task_state_lock_check check (
    (lock_token is null and lock_expires_at is null)
    or (lock_token is not null and lock_expires_at is not null)
  ),
  constraint cpo_task_state_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.complete_power_outage_task_state is
  'Restartovatelný stav samostatných úloh režimu KOMPLETNÍ včetně kurzoru a pronájmu zámku.';

insert into public.complete_power_outage_task_state (task_key)
select task_key
from unnest(array[
  'sync_cez', 'sync_egd', 'sync_pre', 'normalize_addresses',
  'discover_ares', 'discover_res', 'discover_mapy', 'discover_google',
  'reconcile_companies', 'archive', 'watchdog'
]) as task_key
on conflict (task_key) do nothing;

create or replace function public.prepare_complete_power_outage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.archive_at := new.ends_at;
  if tg_op = 'INSERT' and new.last_seen_at < new.first_seen_at then
    new.first_seen_at := new.last_seen_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.prepare_complete_power_outage_row()
  from public, anon, authenticated;

create or replace function public.claim_complete_power_outage_task(
  requested_task_key text,
  requested_lease_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_token uuid := gen_random_uuid();
  claimed_token uuid;
  safe_lease_seconds integer := least(
    7200,
    greatest(60, coalesce(requested_lease_seconds, 60))
  );
begin
  if requested_task_key is null or requested_task_key not in (
    'sync_cez', 'sync_egd', 'sync_pre', 'normalize_addresses',
    'discover_ares', 'discover_res', 'discover_mapy', 'discover_google',
    'reconcile_companies', 'archive', 'watchdog'
  ) then
    raise exception 'Neznámý úkol kompletních odstávek: %', requested_task_key;
  end if;

  insert into public.complete_power_outage_task_state (
    task_key, lock_token, lock_expires_at, last_started_at, last_status,
    last_error_code, last_error_message
  ) values (
    requested_task_key,
    next_token,
    now() + make_interval(secs => safe_lease_seconds),
    now(),
    'running',
    null,
    null
  )
  on conflict (task_key) do update
    set lock_token = excluded.lock_token,
        lock_expires_at = excluded.lock_expires_at,
        last_started_at = excluded.last_started_at,
        last_status = 'running',
        last_error_code = null,
        last_error_message = null
    where public.complete_power_outage_task_state.lock_token is null
       or public.complete_power_outage_task_state.lock_expires_at <= now()
  returning lock_token into claimed_token;

  return claimed_token;
end;
$$;

revoke all on function public.claim_complete_power_outage_task(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_task(text, integer)
  to service_role;

create or replace function public.finish_complete_power_outage_task(
  requested_task_key text,
  requested_lock_token uuid,
  requested_status text,
  requested_processed_count integer default 0,
  requested_error_code text default null,
  requested_error_message text default null,
  requested_cursor jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if requested_status is null
     or requested_status not in ('succeeded', 'partial', 'failed', 'skipped') then
    raise exception 'Neplatný výsledný stav kompletní úlohy: %', requested_status;
  end if;
  if requested_processed_count is null or requested_processed_count < 0 then
    raise exception 'Počet zpracovaných záznamů nesmí být záporný.';
  end if;
  if requested_cursor is null or jsonb_typeof(requested_cursor) <> 'object' then
    raise exception 'Kurzor kompletní úlohy musí být JSON objekt.';
  end if;

  update public.complete_power_outage_task_state
  set lock_token = null,
      lock_expires_at = null,
      last_finished_at = now(),
      last_success_at = case
        when requested_status in ('succeeded', 'partial', 'skipped') then now()
        else last_success_at
      end,
      last_status = requested_status,
      last_processed_count = requested_processed_count,
      consecutive_failure_count = case
        when requested_status = 'failed' then consecutive_failure_count + 1
        else 0
      end,
      last_error_code = case when requested_status = 'failed' then requested_error_code else null end,
      last_error_message = case when requested_status = 'failed' then requested_error_message else null end,
      cursor = requested_cursor
  where task_key = requested_task_key
    and lock_token = requested_lock_token;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function public.finish_complete_power_outage_task(
  text, uuid, text, integer, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finish_complete_power_outage_task(
  text, uuid, text, integer, text, text, jsonb
) to service_role;

drop trigger if exists cpo_source_state_set_updated_at
  on public.complete_power_outage_source_state;
create trigger cpo_source_state_set_updated_at
before update on public.complete_power_outage_source_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_runs_set_updated_at
  on public.complete_power_outage_runs;
create trigger cpo_runs_set_updated_at
before update on public.complete_power_outage_runs
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists complete_power_outages_prepare_row
  on public.complete_power_outages;
create trigger complete_power_outages_prepare_row
before insert or update on public.complete_power_outages
for each row execute function public.prepare_complete_power_outage_row();

drop trigger if exists cpo_addresses_set_updated_at
  on public.complete_power_outage_addresses;
create trigger cpo_addresses_set_updated_at
before update on public.complete_power_outage_addresses
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_companies_set_updated_at
  on public.complete_power_outage_companies;
create trigger cpo_companies_set_updated_at
before update on public.complete_power_outage_companies
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_evidence_set_updated_at
  on public.complete_power_outage_company_evidence;
create trigger cpo_evidence_set_updated_at
before update on public.complete_power_outage_company_evidence
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_cache_set_updated_at
  on public.complete_power_outage_lookup_cache;
create trigger cpo_cache_set_updated_at
before update on public.complete_power_outage_lookup_cache
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_task_state_set_updated_at
  on public.complete_power_outage_task_state;
create trigger cpo_task_state_set_updated_at
before update on public.complete_power_outage_task_state
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_source_state enable row level security;
alter table public.complete_power_outage_runs enable row level security;
alter table public.complete_power_outages enable row level security;
alter table public.complete_power_outage_addresses enable row level security;
alter table public.complete_power_outage_companies enable row level security;
alter table public.complete_power_outage_company_evidence enable row level security;
alter table public.complete_power_outage_lookup_cache enable row level security;
alter table public.complete_power_outage_task_state enable row level security;

drop policy if exists cpo_source_state_authorized_read
  on public.complete_power_outage_source_state;
create policy cpo_source_state_authorized_read
  on public.complete_power_outage_source_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_runs_authorized_read
  on public.complete_power_outage_runs;
create policy cpo_runs_authorized_read
  on public.complete_power_outage_runs
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists complete_power_outages_authorized_read
  on public.complete_power_outages;
create policy complete_power_outages_authorized_read
  on public.complete_power_outages
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_addresses_authorized_read
  on public.complete_power_outage_addresses;
create policy cpo_addresses_authorized_read
  on public.complete_power_outage_addresses
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_companies_authorized_read
  on public.complete_power_outage_companies;
create policy cpo_companies_authorized_read
  on public.complete_power_outage_companies
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_evidence_authorized_read
  on public.complete_power_outage_company_evidence;
create policy cpo_evidence_authorized_read
  on public.complete_power_outage_company_evidence
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cache_authorized_read
  on public.complete_power_outage_lookup_cache;
create policy cpo_cache_authorized_read
  on public.complete_power_outage_lookup_cache
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_task_state_authorized_read
  on public.complete_power_outage_task_state;
create policy cpo_task_state_authorized_read
  on public.complete_power_outage_task_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_source_state from public, anon, authenticated;
revoke all on table public.complete_power_outage_runs from public, anon, authenticated;
revoke all on table public.complete_power_outages from public, anon, authenticated;
revoke all on table public.complete_power_outage_addresses from public, anon, authenticated;
revoke all on table public.complete_power_outage_companies from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_evidence from public, anon, authenticated;
revoke all on table public.complete_power_outage_lookup_cache from public, anon, authenticated;
revoke all on table public.complete_power_outage_task_state from public, anon, authenticated;

grant select on table public.complete_power_outage_source_state to authenticated;
grant select on table public.complete_power_outage_runs to authenticated;
grant select on table public.complete_power_outages to authenticated;
grant select on table public.complete_power_outage_addresses to authenticated;
grant select on table public.complete_power_outage_companies to authenticated;
grant select on table public.complete_power_outage_company_evidence to authenticated;
grant select on table public.complete_power_outage_lookup_cache to authenticated;
grant select on table public.complete_power_outage_task_state to authenticated;

grant all on table public.complete_power_outage_source_state to service_role;
grant all on table public.complete_power_outage_runs to service_role;
grant all on table public.complete_power_outages to service_role;
grant all on table public.complete_power_outage_addresses to service_role;
grant all on table public.complete_power_outage_companies to service_role;
grant all on table public.complete_power_outage_company_evidence to service_role;
grant all on table public.complete_power_outage_lookup_cache to service_role;
grant all on table public.complete_power_outage_task_state to service_role;

commit;

-- Ověřovací výstup po spuštění migrace v Supabase SQL Editoru.
select 'FUNCTION' as check_type,
  'claim_complete_power_outage_task' as object_name,
  to_regprocedure('public.claim_complete_power_outage_task(text,integer)') is not null as is_correct
union all
select 'FUNCTION', 'finish_complete_power_outage_task',
  to_regprocedure('public.finish_complete_power_outage_task(text,uuid,text,integer,text,text,jsonb)') is not null
union all
select 'INDEX', 'complete outage company deduplication',
  to_regclass('public.cpo_companies_address_candidate_unique') is not null
union all
select 'INDEX', 'complete provider lookup deduplication',
  to_regclass('public.cpo_cache_provider_lookup_unique') is not null
union all
select 'POLICY', 'all complete outage tables have authorized read policy',
  (
    select count(*) = 8
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'complete_power_outage_source_state',
        'complete_power_outage_runs',
        'complete_power_outages',
        'complete_power_outage_addresses',
        'complete_power_outage_companies',
        'complete_power_outage_company_evidence',
        'complete_power_outage_lookup_cache',
        'complete_power_outage_task_state'
      )
      and policyname in (
        'cpo_source_state_authorized_read',
        'cpo_runs_authorized_read',
        'complete_power_outages_authorized_read',
        'cpo_addresses_authorized_read',
        'cpo_companies_authorized_read',
        'cpo_evidence_authorized_read',
        'cpo_cache_authorized_read',
        'cpo_task_state_authorized_read'
      )
  )
union all
select 'RLS', 'all complete outage tables',
  not exists (
    select 1
    from unnest(array[
      'complete_power_outage_source_state',
      'complete_power_outage_runs',
      'complete_power_outages',
      'complete_power_outage_addresses',
      'complete_power_outage_companies',
      'complete_power_outage_company_evidence',
      'complete_power_outage_lookup_cache',
      'complete_power_outage_task_state'
    ]) as expected(table_name)
    where not coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.table_name
    ), false)
  )
union all
select 'GRANT', 'authenticated read-only complete outage tables',
  not exists (
    select 1
    from unnest(array[
      'complete_power_outage_source_state',
      'complete_power_outage_runs',
      'complete_power_outages',
      'complete_power_outage_addresses',
      'complete_power_outage_companies',
      'complete_power_outage_company_evidence',
      'complete_power_outage_lookup_cache',
      'complete_power_outage_task_state'
    ]) as expected(table_name)
    where not has_table_privilege('authenticated', 'public.' || expected.table_name, 'select')
       or has_table_privilege('authenticated', 'public.' || expected.table_name, 'insert')
       or has_table_privilege('authenticated', 'public.' || expected.table_name, 'update')
       or has_table_privilege('authenticated', 'public.' || expected.table_name, 'delete')
  )
union all
select 'STATE', 'complete outage sources initialized',
  (
    select count(*) = 3
    from public.complete_power_outage_source_state
    where source in ('cez', 'egd', 'pre')
  )
union all
select 'STATE', 'complete outage tasks initialized',
  (select count(*) = 11 from public.complete_power_outage_task_state)
union all
select 'TABLE', object_name,
  to_regclass('public.' || object_name) is not null
from unnest(array[
  'complete_power_outage_source_state',
  'complete_power_outage_runs',
  'complete_power_outages',
  'complete_power_outage_addresses',
  'complete_power_outage_companies',
  'complete_power_outage_company_evidence',
  'complete_power_outage_lookup_cache',
  'complete_power_outage_task_state'
]) as object_name
order by check_type, object_name;
