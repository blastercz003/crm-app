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

-- Samostatný katalog obcí a restartovatelná fronta pouze pro budoucí
-- celoplošný sběr ČEZ v režimu KOMPLETNÍ. Tabulky režimu MARKETY ani jeho
-- synchronizační funkce tato migrace nemění.
create table if not exists public.complete_power_outage_cez_municipalities (
  municipality_code text primary key,
  municipality_name text not null,
  municipality_name_normalized text not null,
  district_code text,
  district_name text,
  region_code text,
  region_name text,

  representative_address_code text,
  representative_street text,
  representative_house_number text,
  representative_orientation_number text,
  representative_postal_code text,
  representative_latitude double precision,
  representative_longitude double precision,

  distribution_status text not null default 'unknown',
  mapping_status text not null default 'pending',
  cez_address_id bigint,
  cez_town_code bigint,
  cez_town_name text,
  cez_town_part text,
  cez_district text,
  mapping_attempt_count integer not null default 0,
  mapping_last_attempt_at timestamptz,
  mapping_last_success_at timestamptz,
  mapping_next_attempt_at timestamptz,
  mapping_error_code text,
  mapping_error_message text,
  mapping_lock_token uuid,
  mapping_lock_expires_at timestamptz,

  scan_status text not null default 'pending',
  scan_priority integer not null default 100,
  scan_attempt_count integer not null default 0,
  scan_last_attempt_at timestamptz,
  scan_last_success_at timestamptz,
  scan_last_change_at timestamptz,
  scan_next_attempt_at timestamptz,
  scan_error_code text,
  scan_error_message text,
  scan_lock_token uuid,
  scan_lock_expires_at timestamptz,
  latest_payload_sha256 text,
  latest_outage_count integer not null default 0,
  latest_address_count integer not null default 0,

  catalog_version integer not null default 1,
  source_valid_on date,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_municipalities_code_check
    check (municipality_code ~ '^[0-9]{1,12}$'),
  constraint cpo_cez_municipalities_name_check
    check (
      length(btrim(municipality_name)) between 1 and 160
      and length(btrim(municipality_name_normalized)) between 1 and 160
    ),
  constraint cpo_cez_municipalities_coordinates_check
    check (
      (representative_latitude is null and representative_longitude is null)
      or (
        representative_latitude between -90 and 90
        and representative_longitude between -180 and 180
      )
    ),
  constraint cpo_cez_municipalities_distribution_check
    check (distribution_status in ('unknown', 'cez', 'not_cez', 'needs_review', 'disabled')),
  constraint cpo_cez_municipalities_mapping_status_check
    check (mapping_status in ('pending', 'processing', 'resolved', 'not_cez', 'needs_review', 'error', 'disabled')),
  constraint cpo_cez_municipalities_mapping_result_check
    check (
      mapping_status <> 'resolved'
      or (cez_address_id is not null and cez_address_id > 0 and cez_town_code is not null and cez_town_code > 0)
    ),
  constraint cpo_cez_municipalities_mapping_lock_check
    check (
      (mapping_lock_token is null and mapping_lock_expires_at is null)
      or (mapping_lock_token is not null and mapping_lock_expires_at is not null)
    ),
  constraint cpo_cez_municipalities_scan_status_check
    check (scan_status in ('pending', 'processing', 'succeeded', 'no_change', 'partial', 'error', 'needs_review', 'disabled')),
  constraint cpo_cez_municipalities_scan_lock_check
    check (
      (scan_lock_token is null and scan_lock_expires_at is null)
      or (scan_lock_token is not null and scan_lock_expires_at is not null)
    ),
  constraint cpo_cez_municipalities_counts_check
    check (
      mapping_attempt_count >= 0
      and scan_priority >= 0
      and scan_attempt_count >= 0
      and latest_outage_count >= 0
      and latest_address_count >= 0
      and catalog_version >= 1
    ),
  constraint cpo_cez_municipalities_hash_check
    check (latest_payload_sha256 is null or latest_payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_municipalities_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.complete_power_outage_cez_municipalities is
  'Katalog obcí RÚIAN, mapování na ČEZ a restartovatelná fronta celoplošného sběru pouze pro režim KOMPLETNÍ.';

create unique index if not exists cpo_cez_municipalities_address_code_uidx
  on public.complete_power_outage_cez_municipalities (representative_address_code)
  where representative_address_code is not null;

create unique index if not exists cpo_cez_municipalities_town_code_uidx
  on public.complete_power_outage_cez_municipalities (cez_town_code)
  where mapping_status = 'resolved' and cez_town_code is not null;

create index if not exists cpo_cez_municipalities_mapping_queue_idx
  on public.complete_power_outage_cez_municipalities (
    mapping_status,
    mapping_next_attempt_at,
    mapping_attempt_count,
    municipality_code
  )
  where is_active and mapping_status in ('pending', 'error');

create index if not exists cpo_cez_municipalities_scan_queue_idx
  on public.complete_power_outage_cez_municipalities (
    scan_priority,
    scan_next_attempt_at,
    scan_last_success_at,
    municipality_code
  )
  where is_active
    and distribution_status = 'cez'
    and mapping_status = 'resolved'
    and scan_status in ('pending', 'succeeded', 'no_change', 'partial', 'error');

create index if not exists cpo_cez_municipalities_expired_locks_idx
  on public.complete_power_outage_cez_municipalities (
    mapping_lock_expires_at,
    scan_lock_expires_at
  )
  where mapping_lock_token is not null or scan_lock_token is not null;

create table if not exists public.complete_power_outage_cez_scan_cycles (
  id uuid primary key default gen_random_uuid(),
  trigger_kind text not null default 'scheduled',
  status text not null default 'running',
  is_pilot boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  municipality_total_count integer not null default 0,
  municipality_processed_count integer not null default 0,
  municipality_success_count integer not null default 0,
  municipality_error_count integer not null default 0,
  municipality_skipped_count integer not null default 0,
  outage_count integer not null default 0,
  address_count integer not null default 0,
  changed_outage_count integer not null default 0,
  changed_address_count integer not null default 0,
  payload_sha256 text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_scan_cycles_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'retry', 'pilot')),
  constraint cpo_cez_scan_cycles_status_check
    check (status in ('running', 'succeeded', 'no_change', 'partial', 'failed', 'cancelled')),
  constraint cpo_cez_scan_cycles_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint cpo_cez_scan_cycles_counts_check
    check (
      municipality_total_count >= 0
      and municipality_processed_count >= 0
      and municipality_success_count >= 0
      and municipality_error_count >= 0
      and municipality_skipped_count >= 0
      and outage_count >= 0
      and address_count >= 0
      and changed_outage_count >= 0
      and changed_address_count >= 0
      and municipality_processed_count <= municipality_total_count
      and municipality_success_count + municipality_error_count + municipality_skipped_count
        <= municipality_processed_count
    ),
  constraint cpo_cez_scan_cycles_hash_check
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_scan_cycles_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.complete_power_outage_cez_scan_cycles is
  'Audit a atomický stav celoplošných a pilotních cyklů ČEZ pouze pro režim KOMPLETNÍ.';

create unique index if not exists cpo_cez_scan_cycles_one_running_uidx
  on public.complete_power_outage_cez_scan_cycles ((true))
  where status = 'running';

create index if not exists cpo_cez_scan_cycles_timeline_idx
  on public.complete_power_outage_cez_scan_cycles (started_at desc);

create table if not exists public.complete_power_outage_cez_scan_attempts (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null
    references public.complete_power_outage_cez_scan_cycles(id) on delete cascade,
  municipality_code text not null
    references public.complete_power_outage_cez_municipalities(municipality_code) on delete restrict,
  attempt_number integer not null default 1,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cez_address_id bigint,
  cez_town_code bigint,
  exact_outage_count integer not null default 0,
  town_outage_count integer not null default 0,
  unique_outage_count integer not null default 0,
  address_count integer not null default 0,
  http_status integer,
  payload_sha256 text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_scan_attempts_cycle_municipality_unique
    unique (cycle_id, municipality_code, attempt_number),
  constraint cpo_cez_scan_attempts_number_check
    check (attempt_number >= 1),
  constraint cpo_cez_scan_attempts_status_check
    check (status in ('running', 'succeeded', 'no_change', 'partial', 'failed', 'skipped')),
  constraint cpo_cez_scan_attempts_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint cpo_cez_scan_attempts_counts_check
    check (
      exact_outage_count >= 0
      and town_outage_count >= 0
      and unique_outage_count >= 0
      and address_count >= 0
    ),
  constraint cpo_cez_scan_attempts_http_check
    check (http_status is null or http_status between 100 and 599),
  constraint cpo_cez_scan_attempts_hash_check
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_scan_attempts_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.complete_power_outage_cez_scan_attempts is
  'Audit jednotlivých kontrol obcí ČEZ; chyba jedné obce nesmí zneplatnit celý cyklus.';

create index if not exists cpo_cez_scan_attempts_cycle_idx
  on public.complete_power_outage_cez_scan_attempts (cycle_id, status, started_at);

create index if not exists cpo_cez_scan_attempts_municipality_idx
  on public.complete_power_outage_cez_scan_attempts (municipality_code, started_at desc);

drop trigger if exists cpo_cez_municipalities_set_updated_at
  on public.complete_power_outage_cez_municipalities;
create trigger cpo_cez_municipalities_set_updated_at
before update on public.complete_power_outage_cez_municipalities
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_cez_scan_cycles_set_updated_at
  on public.complete_power_outage_cez_scan_cycles;
create trigger cpo_cez_scan_cycles_set_updated_at
before update on public.complete_power_outage_cez_scan_cycles
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_cez_scan_attempts_set_updated_at
  on public.complete_power_outage_cez_scan_attempts;
create trigger cpo_cez_scan_attempts_set_updated_at
before update on public.complete_power_outage_cez_scan_attempts
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_municipalities enable row level security;
alter table public.complete_power_outage_cez_scan_cycles enable row level security;
alter table public.complete_power_outage_cez_scan_attempts enable row level security;

drop policy if exists cpo_cez_municipalities_authorized_read
  on public.complete_power_outage_cez_municipalities;
create policy cpo_cez_municipalities_authorized_read
  on public.complete_power_outage_cez_municipalities
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_scan_cycles_authorized_read
  on public.complete_power_outage_cez_scan_cycles;
create policy cpo_cez_scan_cycles_authorized_read
  on public.complete_power_outage_cez_scan_cycles
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_scan_attempts_authorized_read
  on public.complete_power_outage_cez_scan_attempts;
create policy cpo_cez_scan_attempts_authorized_read
  on public.complete_power_outage_cez_scan_attempts
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_municipalities
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_scan_cycles
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_scan_attempts
  from public, anon, authenticated;

grant select on table public.complete_power_outage_cez_municipalities to authenticated;
grant select on table public.complete_power_outage_cez_scan_cycles to authenticated;
grant select on table public.complete_power_outage_cez_scan_attempts to authenticated;

grant all on table public.complete_power_outage_cez_municipalities to service_role;
grant all on table public.complete_power_outage_cez_scan_cycles to service_role;
grant all on table public.complete_power_outage_cez_scan_attempts to service_role;

commit;

-- Ověřovací výstup po spuštění migrace v Supabase SQL Editoru.
select 'INDEX' as check_type,
  'one running complete CEZ cycle' as object_name,
  to_regclass('public.cpo_cez_scan_cycles_one_running_uidx') is not null as is_correct
union all
select 'ISOLATION', 'no MARKET table changed by this migration',
  true
union all
select 'POLICY', 'complete CEZ municipalities authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'complete_power_outage_cez_municipalities'
      and policyname = 'cpo_cez_municipalities_authorized_read'
  )
union all
select 'POLICY', 'complete CEZ scan attempts authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'complete_power_outage_cez_scan_attempts'
      and policyname = 'cpo_cez_scan_attempts_authorized_read'
  )
union all
select 'POLICY', 'complete CEZ scan cycles authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'complete_power_outage_cez_scan_cycles'
      and policyname = 'cpo_cez_scan_cycles_authorized_read'
  )
union all
select 'RLS', 'complete_power_outage_cez_municipalities',
  coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_cez_municipalities'::regclass
  ), false)
union all
select 'RLS', 'complete_power_outage_cez_scan_attempts',
  coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_cez_scan_attempts'::regclass
  ), false)
union all
select 'RLS', 'complete_power_outage_cez_scan_cycles',
  coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_cez_scan_cycles'::regclass
  ), false)
union all
select 'SAFETY', 'no active complete CEZ cycle created',
  not exists (
    select 1 from public.complete_power_outage_cez_scan_cycles
    where status = 'running'
  )
union all
select 'TABLE', 'complete_power_outage_cez_municipalities',
  to_regclass('public.complete_power_outage_cez_municipalities') is not null
union all
select 'TABLE', 'complete_power_outage_cez_scan_attempts',
  to_regclass('public.complete_power_outage_cez_scan_attempts') is not null
union all
select 'TABLE', 'complete_power_outage_cez_scan_cycles',
  to_regclass('public.complete_power_outage_cez_scan_cycles') is not null
order by check_type, object_name;
