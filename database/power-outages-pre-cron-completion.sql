begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

-- Perzistentní registr a fronta ověření všech prodejen.
create table if not exists public.power_outage_store_registry (
  id uuid primary key default gen_random_uuid(),
  store_id uuid unique references public.stores(id) on delete set null,
  store_chain_name text not null,
  store_number text not null,
  store_city text not null,
  store_address text not null,
  address_fingerprint text not null,
  normalized_municipality text not null default '',
  normalized_street text not null default '',
  house_number text,
  orientation_number text,
  ruian_address_id bigint,
  municipality_code text,
  distributor text not null default 'unknown',
  verification_status text not null default 'pending',
  needs_refresh boolean not null default true,
  is_active boolean not null default true,
  last_attempt_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_store_registry_fingerprint_check
    check (address_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint power_outage_store_registry_distributor_check
    check (distributor in ('cez', 'egd', 'unknown')),
  constraint power_outage_store_registry_verification_check
    check (verification_status in ('pending', 'verified', 'probable', 'needs_review', 'not_found', 'error')),
  constraint power_outage_store_registry_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.power_outage_store_registry is
  'Snapshot, otisk a ověření adresy každé Prodejny; needs_refresh tvoří bezpečnou frontu změn.';

create index if not exists power_outage_store_registry_queue_idx
  on public.power_outage_store_registry (needs_refresh, updated_at)
  where is_active;

create index if not exists power_outage_store_registry_distributor_idx
  on public.power_outage_store_registry (distributor, verification_status)
  where is_active;

create or replace function public.power_outage_store_fingerprint(
  p_chain_name text,
  p_store_number text,
  p_city text,
  p_address text
)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(
    digest(
      concat_ws(
        '|',
        lower(unaccent(trim(coalesce(p_chain_name, '')))),
        lower(unaccent(trim(coalesce(p_store_number, '')))),
        lower(unaccent(trim(coalesce(p_city, '')))),
        lower(unaccent(trim(coalesce(p_address, ''))))
      ),
      'sha256'
    ),
    'hex'
  )
$$;

create or replace function public.sync_power_outage_store_registry()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_fingerprint text;
begin
  if tg_op = 'DELETE' then
    update public.power_outage_store_registry
    set store_id = null,
        is_active = false,
        needs_refresh = false,
        metadata = metadata || jsonb_build_object('deletedAt', now()),
        updated_at = now()
    where store_id = old.id;
    return old;
  end if;

  next_fingerprint := public.power_outage_store_fingerprint(
    new.chain_name,
    new.store_number,
    new.city,
    new.address
  );

  insert into public.power_outage_store_registry (
    store_id,
    store_chain_name,
    store_number,
    store_city,
    store_address,
    address_fingerprint,
    needs_refresh,
    is_active,
    verification_status,
    updated_at
  )
  values (
    new.id,
    new.chain_name,
    new.store_number,
    new.city,
    new.address,
    next_fingerprint,
    true,
    true,
    'pending',
    now()
  )
  on conflict (store_id) do update
  set store_chain_name = excluded.store_chain_name,
      store_number = excluded.store_number,
      store_city = excluded.store_city,
      store_address = excluded.store_address,
      address_fingerprint = excluded.address_fingerprint,
      needs_refresh = public.power_outage_store_registry.needs_refresh or (
        public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      ),
      verification_status = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then 'pending'
        else public.power_outage_store_registry.verification_status
      end,
      ruian_address_id = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then null
        else public.power_outage_store_registry.ruian_address_id
      end,
      municipality_code = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then null
        else public.power_outage_store_registry.municipality_code
      end,
      distributor = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then 'unknown'
        else public.power_outage_store_registry.distributor
      end,
      normalized_municipality = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then ''
        else public.power_outage_store_registry.normalized_municipality
      end,
      normalized_street = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then ''
        else public.power_outage_store_registry.normalized_street
      end,
      house_number = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then null
        else public.power_outage_store_registry.house_number
      end,
      orientation_number = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then null
        else public.power_outage_store_registry.orientation_number
      end,
      last_verified_at = case
        when public.power_outage_store_registry.address_fingerprint
          is distinct from excluded.address_fingerprint
        then null
        else public.power_outage_store_registry.last_verified_at
      end,
      is_active = true,
      last_error_code = null,
      last_error_message = null,
      updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_power_outage_store_registry()
  from public, anon, authenticated;

drop trigger if exists stores_sync_power_outage_registry on public.stores;
create trigger stores_sync_power_outage_registry
after insert
on public.stores
for each row execute function public.sync_power_outage_store_registry();

drop trigger if exists stores_delete_power_outage_registry on public.stores;
create trigger stores_delete_power_outage_registry
before delete
on public.stores
for each row execute function public.sync_power_outage_store_registry();

drop trigger if exists stores_update_power_outage_registry on public.stores;
create trigger stores_update_power_outage_registry
after update of chain_name, store_number, city, address
on public.stores
for each row execute function public.sync_power_outage_store_registry();

insert into public.power_outage_store_registry (
  store_id,
  store_chain_name,
  store_number,
  store_city,
  store_address,
  address_fingerprint,
  needs_refresh,
  is_active,
  verification_status
)
select
  stores.id,
  stores.chain_name,
  stores.store_number,
  stores.city,
  stores.address,
  public.power_outage_store_fingerprint(
    stores.chain_name,
    stores.store_number,
    stores.city,
    stores.address
  ),
  true,
  true,
  'pending'
from public.stores
on conflict (store_id) do update
set store_chain_name = excluded.store_chain_name,
    store_number = excluded.store_number,
    store_city = excluded.store_city,
    store_address = excluded.store_address,
    needs_refresh = (
      public.power_outage_store_registry.address_fingerprint
      is distinct from excluded.address_fingerprint
    ) or public.power_outage_store_registry.needs_refresh,
    verification_status = case
      when public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      then 'pending'
      else public.power_outage_store_registry.verification_status
    end,
    ruian_address_id = case
      when public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      then null else public.power_outage_store_registry.ruian_address_id
    end,
    municipality_code = case
      when public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      then null else public.power_outage_store_registry.municipality_code
    end,
    distributor = case
      when public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      then 'unknown' else public.power_outage_store_registry.distributor
    end,
    last_verified_at = case
      when public.power_outage_store_registry.address_fingerprint
        is distinct from excluded.address_fingerprint
      then null else public.power_outage_store_registry.last_verified_at
    end,
    address_fingerprint = excluded.address_fingerprint,
    is_active = true,
    updated_at = now();

create table if not exists public.power_outage_store_audit_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  trigger_kind text not null default 'scheduled',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  store_count integer not null default 0,
  queued_count integer not null default 0,
  orphaned_count integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint power_outage_store_audit_runs_status_check
    check (status in ('running', 'succeeded', 'failed')),
  constraint power_outage_store_audit_runs_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'retry')),
  constraint power_outage_store_audit_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint power_outage_store_audit_runs_counts_check
    check (store_count >= 0 and queued_count >= 0 and orphaned_count >= 0),
  constraint power_outage_store_audit_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists power_outage_store_audit_runs_one_running_uidx
  on public.power_outage_store_audit_runs ((true))
  where status = 'running';

-- Zdrojové snapshoty a neměnná historie každé změny odstávky.
create table if not exists public.power_outage_source_payloads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  payload_sha256 text not null,
  observed_at timestamptz not null default now(),
  record_count integer not null default 0,
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint power_outage_source_payloads_source_check
    check (source in ('cez', 'egd')),
  constraint power_outage_source_payloads_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint power_outage_source_payloads_count_check
    check (record_count >= 0),
  constraint power_outage_source_payloads_payload_check
    check (jsonb_typeof(payload) in ('array', 'object')),
  constraint power_outage_source_payloads_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint power_outage_source_payloads_source_hash_unique
    unique (source, payload_sha256)
);

create index if not exists power_outage_source_payloads_observed_idx
  on public.power_outage_source_payloads (source, observed_at desc);

create table if not exists public.power_outage_versions (
  id uuid primary key default gen_random_uuid(),
  outage_id uuid not null references public.power_outages(id) on delete cascade,
  version_number integer not null,
  payload_sha256 text not null,
  change_reasons text[] not null default '{}'::text[],
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint power_outage_versions_number_check check (version_number >= 1),
  constraint power_outage_versions_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint power_outage_versions_snapshot_check
    check (jsonb_typeof(snapshot) = 'object'),
  constraint power_outage_versions_outage_number_unique
    unique (outage_id, version_number),
  constraint power_outage_versions_outage_hash_unique
    unique (outage_id, payload_sha256)
);

create index if not exists power_outage_versions_created_idx
  on public.power_outage_versions (outage_id, created_at desc);

create or replace function public.capture_power_outage_version()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  reasons text[] := '{}'::text[];
  next_version integer;
  version_hash text;
begin
  if tg_op = 'INSERT' then
    reasons := array['new_outage'];
  else
    if new.payload_sha256 = old.payload_sha256
      and new.source_status = old.source_status
      and new.starts_at = old.starts_at
      and new.ends_at = old.ends_at
      and new.missing_since is not distinct from old.missing_since
    then
      return new;
    end if;
    if new.starts_at <> old.starts_at or new.ends_at <> old.ends_at then
      reasons := array_append(reasons, 'schedule_changed');
    end if;
    if new.source_status <> old.source_status then
      reasons := array_append(reasons, 'status_changed');
    end if;
    if new.source_status = 'cancelled' and old.source_status <> 'cancelled' then
      reasons := array_append(reasons, 'cancelled');
    end if;
    if new.missing_since is not null and old.missing_since is null then
      reasons := array_append(reasons, 'missing_from_source');
    end if;
    if new.payload_sha256 <> old.payload_sha256 then
      reasons := array_append(reasons, 'content_changed');
    end if;
  end if;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.power_outage_versions
  where outage_id = new.id;

  version_hash := encode(
    digest(
      concat_ws(
        '|',
        new.payload_sha256,
        new.source_status,
        new.starts_at::text,
        new.ends_at::text,
        coalesce(new.missing_since::text, '')
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.power_outage_versions (
    outage_id,
    version_number,
    payload_sha256,
    change_reasons,
    snapshot
  )
  values (
    new.id,
    next_version,
    version_hash,
    reasons,
    to_jsonb(new) - 'updated_at'
  )
  on conflict (outage_id, payload_sha256) do nothing;

  return new;
end;
$$;

revoke all on function public.capture_power_outage_version()
  from public, anon, authenticated;

drop trigger if exists power_outages_capture_version on public.power_outages;
create trigger power_outages_capture_version
after insert or update of payload_sha256, source_status, starts_at, ends_at, missing_since
on public.power_outages
for each row execute function public.capture_power_outage_version();

insert into public.power_outage_versions (
  outage_id,
  version_number,
  payload_sha256,
  change_reasons,
  snapshot,
  created_at
)
select
  outages.id,
  1,
  outages.payload_sha256,
  array['migration_snapshot']::text[],
  to_jsonb(outages) - 'updated_at',
  outages.created_at
from public.power_outages as outages
where not exists (
  select 1
  from public.power_outage_versions as versions
  where versions.outage_id = outages.id
)
on conflict do nothing;

-- Preference, audit doručení a ruční označení Informováno jsou připravené,
-- ale před krokem 14 nic samy neodesílají.
create table if not exists public.power_outage_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  notifications_enabled boolean not null default false,
  reminder_24h_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_notification_preferences_reminder_check
    check (not reminder_24h_enabled or notifications_enabled)
);

create table if not exists public.power_outage_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  outage_id uuid not null references public.power_outages(id) on delete cascade,
  outage_version_id uuid references public.power_outage_versions(id) on delete set null,
  match_id uuid references public.power_outage_store_matches(id) on delete cascade,
  event_kind text not null,
  dedupe_key text not null,
  delivery_status text not null default 'planned',
  notification_id uuid references public.notifications(id) on delete set null,
  push_delivery jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_notification_deliveries_event_check
    check (event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h')),
  constraint power_outage_notification_deliveries_status_check
    check (delivery_status in ('planned', 'created', 'deduplicated', 'failed', 'skipped')),
  constraint power_outage_notification_deliveries_push_check
    check (jsonb_typeof(push_delivery) = 'object'),
  constraint power_outage_notification_deliveries_dedupe_unique
    unique (dedupe_key)
);

create index if not exists power_outage_notification_deliveries_user_idx
  on public.power_outage_notification_deliveries (user_id, created_at desc);

create table if not exists public.power_outage_informed_audit (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.power_outage_store_matches(id) on delete cascade,
  informed boolean not null,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists power_outage_informed_audit_match_idx
  on public.power_outage_informed_audit (match_id, created_at desc);

create table if not exists public.power_outage_match_audit (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.power_outage_store_matches(id) on delete cascade,
  previous_status text not null,
  next_status text not null,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  note text,
  created_at timestamptz not null default now(),
  constraint power_outage_match_audit_status_check
    check (
      previous_status in ('confirmed', 'needs_review', 'dismissed')
      and next_status in ('confirmed', 'needs_review', 'dismissed')
    )
);

create index if not exists power_outage_match_audit_match_idx
  on public.power_outage_match_audit (match_id, created_at desc);

drop trigger if exists power_outage_store_registry_set_updated_at
  on public.power_outage_store_registry;
create trigger power_outage_store_registry_set_updated_at
before update on public.power_outage_store_registry
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_notification_preferences_set_updated_at
  on public.power_outage_notification_preferences;
create trigger power_outage_notification_preferences_set_updated_at
before update on public.power_outage_notification_preferences
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_notification_deliveries_set_updated_at
  on public.power_outage_notification_deliveries;
create trigger power_outage_notification_deliveries_set_updated_at
before update on public.power_outage_notification_deliveries
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_store_registry enable row level security;
alter table public.power_outage_store_audit_runs enable row level security;
alter table public.power_outage_source_payloads enable row level security;
alter table public.power_outage_versions enable row level security;
alter table public.power_outage_notification_preferences enable row level security;
alter table public.power_outage_notification_deliveries enable row level security;
alter table public.power_outage_informed_audit enable row level security;
alter table public.power_outage_match_audit enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'power_outage_store_registry',
    'power_outage_store_audit_runs',
    'power_outage_source_payloads',
    'power_outage_versions',
    'power_outage_informed_audit',
    'power_outage_match_audit'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_authorized_read', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_can_view_power_outages())',
      table_name || '_authorized_read',
      table_name
    );
  end loop;
end
$$;

drop policy if exists power_outage_notification_preferences_own_read
  on public.power_outage_notification_preferences;
create policy power_outage_notification_preferences_own_read
  on public.power_outage_notification_preferences
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

drop policy if exists power_outage_notification_preferences_own_insert
  on public.power_outage_notification_preferences;
create policy power_outage_notification_preferences_own_insert
  on public.power_outage_notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_user_can_view_power_outages());

drop policy if exists power_outage_notification_preferences_own_update
  on public.power_outage_notification_preferences;
create policy power_outage_notification_preferences_own_update
  on public.power_outage_notification_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.current_user_can_view_power_outages())
  with check (user_id = auth.uid() and public.current_user_can_view_power_outages());

drop policy if exists power_outage_notification_deliveries_own_read
  on public.power_outage_notification_deliveries;
create policy power_outage_notification_deliveries_own_read
  on public.power_outage_notification_deliveries
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'power_outage_store_registry',
    'power_outage_store_audit_runs',
    'power_outage_source_payloads',
    'power_outage_versions',
    'power_outage_notification_deliveries',
    'power_outage_informed_audit',
    'power_outage_match_audit'
  ] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end
$$;

revoke all on table public.power_outage_notification_preferences
  from public, anon, authenticated;
grant select, insert, update on table public.power_outage_notification_preferences
  to authenticated;
grant all on table public.power_outage_notification_preferences to service_role;

commit;

select 'TABLE' as check_type, object_name,
  to_regclass('public.' || object_name) is not null as is_correct
from unnest(array[
  'power_outage_store_registry',
  'power_outage_store_audit_runs',
  'power_outage_source_payloads',
  'power_outage_versions',
  'power_outage_notification_preferences',
  'power_outage_notification_deliveries',
  'power_outage_informed_audit',
  'power_outage_match_audit'
]) as object_name
union all
select 'RLS', object_name,
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = ('public.' || object_name)::regclass
  ), false)
from unnest(array[
  'power_outage_store_registry',
  'power_outage_store_audit_runs',
  'power_outage_source_payloads',
  'power_outage_versions',
  'power_outage_notification_preferences',
  'power_outage_notification_deliveries',
  'power_outage_informed_audit',
  'power_outage_match_audit'
]) as object_name
union all
select 'TRIGGER', 'stores_sync_power_outage_registry',
  exists (
    select 1 from pg_trigger
    where tgname = 'stores_sync_power_outage_registry' and not tgisinternal
  )
union all
select 'TRIGGER', 'power_outages_capture_version',
  exists (
    select 1 from pg_trigger
    where tgname = 'power_outages_capture_version' and not tgisinternal
  )
union all
select 'TRIGGER', 'stores_update_power_outage_registry',
  exists (
    select 1 from pg_trigger
    where tgname = 'stores_update_power_outage_registry' and not tgisinternal
  )
union all
select 'TRIGGER', 'stores_delete_power_outage_registry',
  exists (
    select 1 from pg_trigger
    where tgname = 'stores_delete_power_outage_registry' and not tgisinternal
  )
union all
select 'STATE', 'all stores queued in registry',
  not exists (
    select 1
    from public.stores
    left join public.power_outage_store_registry registry
      on registry.store_id = stores.id
    where registry.id is null
  )
order by check_type, object_name;
