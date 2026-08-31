begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

alter table public.profiles
  add column if not exists can_view_power_outages boolean not null default false;

update public.profiles
set can_view_power_outages = true
where role = 'admin'
  and can_view_power_outages = false;

create or replace function public.current_user_can_view_power_outages()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or profiles.can_view_power_outages = true
      )
  )
$$;

revoke all on function public.current_user_can_view_power_outages()
  from public, anon;
grant execute on function public.current_user_can_view_power_outages()
  to authenticated;

create or replace function public.profiles_protect_power_outages_access_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.can_view_power_outages is distinct from old.can_view_power_outages
    and coalesce(auth.role(), '') <> 'service_role'
    and not public.current_user_is_admin()
  then
    raise exception 'Přístup do sekce Odstávky může měnit pouze administrátor.';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_protect_power_outages_access_flag()
  from public, anon, authenticated;

drop trigger if exists profiles_protect_power_outages_access_flag
  on public.profiles;
create trigger profiles_protect_power_outages_access_flag
before update of can_view_power_outages on public.profiles
for each row
execute function public.profiles_protect_power_outages_access_flag();

create table if not exists public.power_outage_store_catalog_state (
  singleton boolean primary key default true,
  revision bigint not null default 1,
  last_changed_at timestamptz not null default now(),
  last_change_kind text not null default 'initial',
  last_changed_store_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_store_catalog_state_singleton_check
    check (singleton),
  constraint power_outage_store_catalog_state_revision_check
    check (revision >= 1),
  constraint power_outage_store_catalog_state_change_kind_check
    check (last_change_kind in ('initial', 'insert', 'update', 'delete'))
);

comment on table public.power_outage_store_catalog_state is
  'Monotónní revize seznamu prodejen. Změna adresy, vložení i smazání vynutí nové porovnání odstávek.';

insert into public.power_outage_store_catalog_state (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.mark_power_outage_store_catalog_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  change_kind text;
begin
  change_kind := lower(tg_op);

  insert into public.power_outage_store_catalog_state (
    singleton,
    revision,
    last_changed_at,
    last_change_kind,
    last_changed_store_id,
    updated_at
  )
  values (true, 1, now(), change_kind, null, now())
  on conflict (singleton) do update
  set revision = public.power_outage_store_catalog_state.revision + 1,
      last_changed_at = excluded.last_changed_at,
      last_change_kind = excluded.last_change_kind,
      last_changed_store_id = excluded.last_changed_store_id,
      updated_at = excluded.updated_at;

  return null;
end;
$$;

revoke all on function public.mark_power_outage_store_catalog_changed()
  from public, anon, authenticated;

drop trigger if exists stores_mark_power_outage_catalog_changed
  on public.stores;
create trigger stores_mark_power_outage_catalog_changed
after insert or delete
on public.stores
for each statement
execute function public.mark_power_outage_store_catalog_changed();

drop trigger if exists stores_mark_power_outage_catalog_updated
  on public.stores;
create trigger stores_mark_power_outage_catalog_updated
after update of chain_name, store_number, city, address
on public.stores
for each statement
execute function public.mark_power_outage_store_catalog_changed();

create table if not exists public.power_outage_source_state (
  source text primary key,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_change_at timestamptz,
  latest_source_ref text,
  latest_payload_sha256 text,
  active_outage_count integer not null default 0,
  future_outage_count integer not null default 0,
  consecutive_failure_count integer not null default 0,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  data_version bigint not null default 0,
  store_revision_processed bigint not null default 0,
  lock_token uuid,
  lock_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_source_state_source_check
    check (source in ('cez', 'egd')),
  constraint power_outage_source_state_counts_check
    check (
      active_outage_count >= 0
      and future_outage_count >= 0
      and consecutive_failure_count >= 0
      and data_version >= 0
      and store_revision_processed >= 0
    ),
  constraint power_outage_source_state_payload_hash_check
    check (
      latest_payload_sha256 is null
      or latest_payload_sha256 ~ '^[a-f0-9]{64}$'
    ),
  constraint power_outage_source_state_lock_pair_check
    check (
      (lock_token is null and lock_expires_at is null)
      or (lock_token is not null and lock_expires_at is not null)
    ),
  constraint power_outage_source_state_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.power_outage_source_state is
  'Oddělený provozní stav načítání ČEZ a EG.D včetně watchdog údajů a revize zpracovaných prodejen.';

insert into public.power_outage_source_state (source)
values ('cez'), ('egd')
on conflict (source) do nothing;

create table if not exists public.power_outage_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  trigger_kind text not null default 'scheduled',
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source_record_count integer not null default 0,
  outage_upsert_count integer not null default 0,
  address_upsert_count integer not null default 0,
  store_match_count integer not null default 0,
  store_review_count integer not null default 0,
  store_revision bigint not null default 0,
  payload_sha256 text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint power_outage_sync_runs_source_check
    check (source in ('cez', 'egd')),
  constraint power_outage_sync_runs_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'store_change', 'retry')),
  constraint power_outage_sync_runs_status_check
    check (status in ('running', 'succeeded', 'no_change', 'failed', 'skipped')),
  constraint power_outage_sync_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint power_outage_sync_runs_counts_check
    check (
      source_record_count >= 0
      and outage_upsert_count >= 0
      and address_upsert_count >= 0
      and store_match_count >= 0
      and store_review_count >= 0
      and store_revision >= 0
    ),
  constraint power_outage_sync_runs_payload_hash_check
    check (payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint power_outage_sync_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists power_outage_sync_runs_one_running_per_source_uidx
  on public.power_outage_sync_runs (source)
  where status = 'running';

create index if not exists power_outage_sync_runs_started_idx
  on public.power_outage_sync_runs (source, started_at desc);

create table if not exists public.power_outages (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  source_status text not null default 'scheduled',
  title text,
  description text,
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
  constraint power_outages_source_check
    check (source in ('cez', 'egd')),
  constraint power_outages_status_check
    check (source_status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint power_outages_period_check
    check (ends_at > starts_at and archive_at = ends_at + interval '24 hours'),
  constraint power_outages_payload_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint power_outages_seen_check
    check (last_seen_at >= first_seen_at),
  constraint power_outages_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint power_outages_source_external_unique
    unique (source, external_id)
);

comment on column public.power_outages.archive_at is
  'Záznam se na stránce přesune do archivu přesně 24 hodin po termínu konce.';

create index if not exists power_outages_timeline_idx
  on public.power_outages (archive_at, starts_at, ends_at);

create index if not exists power_outages_source_status_idx
  on public.power_outages (source, source_status, starts_at);

create table if not exists public.power_outage_addresses (
  id uuid primary key default gen_random_uuid(),
  outage_id uuid not null references public.power_outages(id) on delete cascade,
  external_address_id text,
  address_key text not null,
  municipality text not null default '',
  municipality_code text,
  town_part text,
  street text not null default '',
  house_number text,
  orientation_number text,
  postal_code text,
  raw_address text not null default '',
  normalized_municipality text not null,
  normalized_street text not null,
  latitude double precision,
  longitude double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_addresses_key_check
    check (length(address_key) between 1 and 256),
  constraint power_outage_addresses_normalized_check
    check (normalized_municipality <> ''),
  constraint power_outage_addresses_coordinates_check
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    ),
  constraint power_outage_addresses_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint power_outage_addresses_outage_key_unique
    unique (outage_id, address_key)
);

create index if not exists power_outage_addresses_match_idx
  on public.power_outage_addresses (normalized_municipality, normalized_street);

create index if not exists power_outage_addresses_outage_idx
  on public.power_outage_addresses (outage_id);

create table if not exists public.power_outage_store_matches (
  id uuid primary key default gen_random_uuid(),
  outage_id uuid not null references public.power_outages(id) on delete cascade,
  outage_address_id uuid references public.power_outage_addresses(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  match_status text not null,
  match_method text not null default 'city_street',
  confidence numeric(5,4) not null,
  match_reasons jsonb not null default '[]'::jsonb,
  store_chain_name text not null,
  store_number text not null,
  store_city text not null,
  store_address text not null,
  store_revision bigint not null,
  first_matched_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_store_matches_status_check
    check (match_status in ('confirmed', 'needs_review', 'dismissed')),
  constraint power_outage_store_matches_method_check
    check (match_method in ('city_street', 'manual')),
  constraint power_outage_store_matches_confidence_check
    check (confidence between 0 and 1),
  constraint power_outage_store_matches_revision_check
    check (store_revision >= 1),
  constraint power_outage_store_matches_reasons_check
    check (jsonb_typeof(match_reasons) = 'array'),
  constraint power_outage_store_matches_resolution_check
    check (
      (match_status = 'needs_review' and resolved_at is null and resolved_by is null)
      or (
        match_status = 'confirmed'
        and (
          (resolved_at is null and resolved_by is null)
          or (resolved_at is not null and resolved_by is not null)
        )
      )
      or (match_status = 'dismissed' and resolved_at is not null)
    )
);

create unique index if not exists power_outage_store_matches_outage_store_uidx
  on public.power_outage_store_matches (outage_id, store_id)
  where store_id is not null;

create index if not exists power_outage_store_matches_store_idx
  on public.power_outage_store_matches (store_id, match_status, last_verified_at desc);

create index if not exists power_outage_store_matches_outage_idx
  on public.power_outage_store_matches (outage_id, match_status);

create or replace function public.set_power_outage_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prepare_power_outage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.archive_at := new.ends_at + interval '24 hours';
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists power_outage_source_state_set_updated_at
  on public.power_outage_source_state;
create trigger power_outage_source_state_set_updated_at
before update on public.power_outage_source_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outages_set_updated_at
  on public.power_outages;
create trigger power_outages_set_updated_at
before insert or update on public.power_outages
for each row execute function public.prepare_power_outage_row();

drop trigger if exists power_outage_addresses_set_updated_at
  on public.power_outage_addresses;
create trigger power_outage_addresses_set_updated_at
before update on public.power_outage_addresses
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_store_matches_set_updated_at
  on public.power_outage_store_matches;
create trigger power_outage_store_matches_set_updated_at
before update on public.power_outage_store_matches
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_store_catalog_state enable row level security;
alter table public.power_outage_source_state enable row level security;
alter table public.power_outage_sync_runs enable row level security;
alter table public.power_outages enable row level security;
alter table public.power_outage_addresses enable row level security;
alter table public.power_outage_store_matches enable row level security;

drop policy if exists power_outage_store_catalog_state_authorized_read
  on public.power_outage_store_catalog_state;
create policy power_outage_store_catalog_state_authorized_read
  on public.power_outage_store_catalog_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outage_source_state_authorized_read
  on public.power_outage_source_state;
create policy power_outage_source_state_authorized_read
  on public.power_outage_source_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outage_sync_runs_authorized_read
  on public.power_outage_sync_runs;
create policy power_outage_sync_runs_authorized_read
  on public.power_outage_sync_runs
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outages_authorized_read
  on public.power_outages;
create policy power_outages_authorized_read
  on public.power_outages
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outage_addresses_authorized_read
  on public.power_outage_addresses;
create policy power_outage_addresses_authorized_read
  on public.power_outage_addresses
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outage_store_matches_authorized_read
  on public.power_outage_store_matches;
create policy power_outage_store_matches_authorized_read
  on public.power_outage_store_matches
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_store_catalog_state
  from public, anon, authenticated;
revoke all on table public.power_outage_source_state
  from public, anon, authenticated;
revoke all on table public.power_outage_sync_runs
  from public, anon, authenticated;
revoke all on table public.power_outages
  from public, anon, authenticated;
revoke all on table public.power_outage_addresses
  from public, anon, authenticated;
revoke all on table public.power_outage_store_matches
  from public, anon, authenticated;

grant select on table public.power_outage_store_catalog_state to authenticated;
grant select on table public.power_outage_source_state to authenticated;
grant select on table public.power_outage_sync_runs to authenticated;
grant select on table public.power_outages to authenticated;
grant select on table public.power_outage_addresses to authenticated;
grant select on table public.power_outage_store_matches to authenticated;

grant all on table public.power_outage_store_catalog_state to service_role;
grant all on table public.power_outage_source_state to service_role;
grant all on table public.power_outage_sync_runs to service_role;
grant all on table public.power_outages to service_role;
grant all on table public.power_outage_addresses to service_role;
grant all on table public.power_outage_store_matches to service_role;

commit;

-- Ověřovací dotaz po spuštění celé migrace:
select 'COLUMN' as check_type,
  'profiles.can_view_power_outages' as object_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'can_view_power_outages'
  ) as is_correct
union all
select 'FUNCTION', 'current_user_can_view_power_outages',
  to_regprocedure('public.current_user_can_view_power_outages()') is not null
union all
select 'PROFILE', 'all current admins have access',
  not exists (
    select 1 from public.profiles
    where role = 'admin' and can_view_power_outages is not true
  )
union all
select 'TRIGGER', 'stores_mark_power_outage_catalog_changed',
  exists (
    select 1
    from pg_trigger
    where tgname = 'stores_mark_power_outage_catalog_changed'
      and not tgisinternal
  )
union all
select 'TRIGGER', 'stores_mark_power_outage_catalog_updated',
  exists (
    select 1
    from pg_trigger
    where tgname = 'stores_mark_power_outage_catalog_updated'
      and not tgisinternal
  )
union all
select 'STATE', 'power outage sources initialized',
  (select count(*) = 2
   from public.power_outage_source_state
   where source in ('cez', 'egd'))
union all
select 'TABLE', object_name,
  to_regclass('public.' || object_name) is not null
from unnest(array[
  'power_outage_store_catalog_state',
  'power_outage_source_state',
  'power_outage_sync_runs',
  'power_outages',
  'power_outage_addresses',
  'power_outage_store_matches'
]) as object_name
union all
select 'RLS', object_name,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = object_name
  ), false)
from unnest(array[
  'power_outage_store_catalog_state',
  'power_outage_source_state',
  'power_outage_sync_runs',
  'power_outages',
  'power_outage_addresses',
  'power_outage_store_matches'
]) as object_name
union all
select 'INDEX', 'power_outage_sync_runs_one_running_per_source_uidx',
  to_regclass('public.power_outage_sync_runs_one_running_per_source_uidx') is not null
order by check_type, object_name;
