begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_collector_versions') is null
    or to_regclass('public.power_outage_cez_market_collector_state') is null
    or to_regclass('public.power_outages') is null
    or to_regclass('public.power_outage_addresses') is null
    or to_regclass('public.power_outage_store_matches') is null
    or to_regclass('public.power_outage_job_links') is null
  then
    raise exception 'Chybí databázový základ ČEZ MARKETY nebo produkční tabulky odstávek.';
  end if;

  if to_regprocedure('public.current_user_can_view_power_outages()') is null
    or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybí společné bezpečnostní funkce monitoringu odstávek.';
  end if;
end
$$;

-- Krok 2 pouze připravuje datový kontrakt souběžného režimu. Produkční režim
-- zůstává v1_only a tato migrace nezakládá žádný běh ani CRON sběrače v2.
insert into public.power_outage_cez_market_collector_versions (
  version,
  display_name,
  contract_name,
  strategy,
  settings,
  rollback_available
)
values (
  'v2',
  'ČEZ v2',
  'cez-public-address-v2',
  'every_verified_cez_ruian_address',
  jsonb_build_object(
    'scope', 'MARKETY',
    'grouping', 'unique_verified_ruian_address',
    'inspectionFields', jsonb_build_array('outages', 'outages_in_town'),
    'primaryEvidence', 'outages',
    'deduplicateOutagesBy', 'source_and_external_id',
    'productionTables', jsonb_build_array(
      'power_outages',
      'power_outage_addresses',
      'power_outage_store_matches'
    ),
    'activationState', 'foundation_only',
    'registeredAt', now()
  ),
  true
)
on conflict (version) do nothing;

create or replace function public.protect_power_outage_cez_market_collector_definitions()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.version in ('v1', 'v2') then
    raise exception 'Definice sběrače ČEZ MARKETY % je neměnná.', old.version;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists po_cez_market_collector_v1_immutable
  on public.power_outage_cez_market_collector_versions;
drop trigger if exists po_cez_market_collector_definitions_immutable
  on public.power_outage_cez_market_collector_versions;
create trigger po_cez_market_collector_definitions_immutable
before update or delete on public.power_outage_cez_market_collector_versions
for each row execute function public.protect_power_outage_cez_market_collector_definitions();

alter table public.power_outage_cez_market_collector_state
  add column if not exists operating_mode text not null default 'v1_only',
  add column if not exists primary_version text not null default 'v1',
  add column if not exists secondary_version text,
  add column if not exists activation_ready boolean not null default false,
  add column if not exists v1_verification_interval interval not null default interval '24 hours';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'po_cez_market_collector_state_mode_check'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ) then
    alter table public.power_outage_cez_market_collector_state
      add constraint po_cez_market_collector_state_mode_check
      check (operating_mode in ('v1_only', 'dual', 'v2_only'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'po_cez_market_collector_state_primary_fk'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ) then
    alter table public.power_outage_cez_market_collector_state
      add constraint po_cez_market_collector_state_primary_fk
      foreign key (primary_version)
      references public.power_outage_cez_market_collector_versions(version)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'po_cez_market_collector_state_secondary_fk'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ) then
    alter table public.power_outage_cez_market_collector_state
      add constraint po_cez_market_collector_state_secondary_fk
      foreign key (secondary_version)
      references public.power_outage_cez_market_collector_versions(version)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'po_cez_market_collector_state_combination_check'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ) then
    alter table public.power_outage_cez_market_collector_state
      add constraint po_cez_market_collector_state_combination_check
      check (
        (operating_mode = 'v1_only'
          and active_version = 'v1'
          and primary_version = 'v1'
          and secondary_version is null)
        or (operating_mode = 'dual'
          and active_version = 'v2'
          and primary_version = 'v2'
          and secondary_version = 'v1')
        or (operating_mode = 'v2_only'
          and active_version = 'v2'
          and primary_version = 'v2'
          and secondary_version is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'po_cez_market_collector_state_interval_check'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ) then
    alter table public.power_outage_cez_market_collector_state
      add constraint po_cez_market_collector_state_interval_check
      check (v1_verification_interval between interval '1 hour' and interval '7 days');
  end if;
end
$$;

update public.power_outage_cez_market_collector_state
set operating_mode = 'v1_only',
    active_version = 'v1',
    primary_version = 'v1',
    secondary_version = null,
    activation_ready = false
where singleton;

create table if not exists public.power_outage_cez_market_cycles (
  id uuid primary key default gen_random_uuid(),
  collector_version text not null
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  trigger_kind text not null default 'scheduled',
  status text not null default 'pending',
  is_complete_snapshot boolean not null default false,
  catalog_revision bigint not null,
  target_count integer not null default 0,
  processed_count integer not null default 0,
  success_count integer not null default 0,
  error_count integer not null default 0,
  discovered_outage_count integer not null default 0,
  exact_outage_count integer not null default 0,
  town_outage_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint po_cez_market_cycles_version_check check (collector_version in ('v1', 'v2')),
  constraint po_cez_market_cycles_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'continuation', 'verification', 'retry')),
  constraint po_cez_market_cycles_status_check
    check (status in ('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  constraint po_cez_market_cycles_counts_check
    check (
      catalog_revision >= 0
      and target_count >= 0
      and processed_count between 0 and target_count
      and success_count >= 0
      and error_count >= 0
      and success_count + error_count <= processed_count
      and discovered_outage_count >= 0
      and exact_outage_count >= 0
      and town_outage_count >= 0
    ),
  constraint po_cez_market_cycles_time_check
    check (
      (status = 'pending' and started_at is null and finished_at is null)
      or (status = 'running' and started_at is not null and finished_at is null)
      or (status in ('succeeded', 'partial', 'failed', 'cancelled')
        and started_at is not null and finished_at is not null)
    ),
  constraint po_cez_market_cycles_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists po_cez_market_cycles_one_open_per_version_uidx
  on public.power_outage_cez_market_cycles (collector_version)
  where status in ('pending', 'running');
create index if not exists po_cez_market_cycles_history_idx
  on public.power_outage_cez_market_cycles (collector_version, created_at desc);

create table if not exists public.power_outage_cez_market_cycle_targets (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null
    references public.power_outage_cez_market_cycles(id) on delete cascade,
  collector_version text not null
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  address_id bigint not null,
  municipality text not null,
  street text not null,
  house_number text,
  orientation_number text,
  store_ids jsonb not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  exact_outage_ids jsonb not null default '[]'::jsonb,
  town_outage_ids jsonb not null default '[]'::jsonb,
  lock_token uuid,
  lock_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint po_cez_market_cycle_targets_unique unique (cycle_id, address_id),
  constraint po_cez_market_cycle_targets_version_check check (collector_version in ('v1', 'v2')),
  constraint po_cez_market_cycle_targets_address_check
    check (address_id > 0 and btrim(municipality) <> '' and btrim(street) <> ''),
  constraint po_cez_market_cycle_targets_status_check
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  constraint po_cez_market_cycle_targets_attempt_check check (attempt_count >= 0),
  constraint po_cez_market_cycle_targets_lock_check
    check (
      (status = 'running' and lock_token is not null and lock_expires_at is not null)
      or (status <> 'running' and lock_token is null and lock_expires_at is null)
    ),
  constraint po_cez_market_cycle_targets_json_check
    check (
      jsonb_typeof(store_ids) = 'array'
      and jsonb_typeof(exact_outage_ids) = 'array'
      and jsonb_typeof(town_outage_ids) = 'array'
      and jsonb_typeof(metadata) = 'object'
    )
);

create index if not exists po_cez_market_cycle_targets_queue_idx
  on public.power_outage_cez_market_cycle_targets (cycle_id, status, address_id);

-- Evidence je oddělená podle verze. Sdílená produkční odstávka zůstává jediná
-- díky (source, external_id), ale každá verze má vlastní stopu nálezu.
create table if not exists public.power_outage_cez_market_observations (
  collector_version text not null
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  external_id text not null,
  outage_id uuid references public.power_outages(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_cycle_id uuid references public.power_outage_cez_market_cycles(id) on delete set null,
  last_complete_cycle_id uuid references public.power_outage_cez_market_cycles(id) on delete set null,
  returned_for_exact_address boolean not null default false,
  returned_for_town boolean not null default false,
  seeded_baseline boolean not null default false,
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (collector_version, external_id),
  constraint po_cez_market_observations_version_check check (collector_version in ('v1', 'v2')),
  constraint po_cez_market_observations_external_check check (btrim(external_id) <> ''),
  constraint po_cez_market_observations_seen_check check (last_seen_at >= first_seen_at),
  constraint po_cez_market_observations_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists po_cez_market_observations_outage_idx
  on public.power_outage_cez_market_observations (outage_id, collector_version);
create index if not exists po_cez_market_observations_current_idx
  on public.power_outage_cez_market_observations (collector_version, missing_since, last_seen_at desc);

create table if not exists public.power_outage_cez_market_address_observations (
  collector_version text not null
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  external_id text not null,
  outage_id uuid references public.power_outages(id) on delete set null,
  outage_address_id uuid references public.power_outage_addresses(id) on delete set null,
  address_key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_cycle_id uuid references public.power_outage_cez_market_cycles(id) on delete set null,
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (collector_version, external_id, address_key),
  constraint po_cez_market_address_observations_version_check check (collector_version in ('v1', 'v2')),
  constraint po_cez_market_address_observations_keys_check
    check (btrim(external_id) <> '' and length(address_key) between 1 and 256),
  constraint po_cez_market_address_observations_seen_check check (last_seen_at >= first_seen_at),
  constraint po_cez_market_address_observations_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists po_cez_market_address_observations_address_idx
  on public.power_outage_cez_market_address_observations (outage_address_id, collector_version);

-- Neměnný kontrolní manifest slouží k porovnání počtu i konkrétních identit
-- před zapnutím dual režimu, při aktivaci a při případném návratu na v1.
create table if not exists public.power_outage_cez_market_preservation_manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_kind text not null,
  operating_mode text not null,
  catalog_revision bigint not null,
  outage_count integer not null default 0,
  address_count integer not null default 0,
  store_match_count integer not null default 0,
  job_link_count integer not null default 0,
  status text not null default 'building',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),

  constraint po_cez_market_manifests_kind_check
    check (manifest_kind in ('foundation', 'pre_activation', 'post_activation', 'rollback')),
  constraint po_cez_market_manifests_mode_check
    check (operating_mode in ('v1_only', 'dual', 'v2_only')),
  constraint po_cez_market_manifests_counts_check
    check (catalog_revision >= 0 and outage_count >= 0 and address_count >= 0
      and store_match_count >= 0 and job_link_count >= 0),
  constraint po_cez_market_manifests_status_check check (status in ('building', 'complete', 'failed')),
  constraint po_cez_market_manifests_note_check
    check (note is null or length(btrim(note)) between 1 and 1000),
  constraint po_cez_market_manifests_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.power_outage_cez_market_preservation_items (
  manifest_id uuid not null
    references public.power_outage_cez_market_preservation_manifests(id) on delete restrict,
  entity_kind text not null,
  entity_key text not null,
  outage_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now(),

  primary key (manifest_id, entity_kind, entity_key),
  constraint po_cez_market_manifest_items_kind_check
    check (entity_kind in ('outage', 'address', 'store_match', 'job_link')),
  constraint po_cez_market_manifest_items_key_check check (btrim(entity_key) <> ''),
  constraint po_cez_market_manifest_items_payload_check check (jsonb_typeof(payload) = 'object')
);

create index if not exists po_cez_market_manifest_items_outage_idx
  on public.power_outage_cez_market_preservation_items (manifest_id, outage_id, entity_kind);

create or replace function public.protect_power_outage_cez_market_preservation_manifest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Bezpečnostní manifest ČEZ MARKETY nelze smazat.';
  end if;
  if old.status = 'complete' then
    raise exception 'Dokončený bezpečnostní manifest ČEZ MARKETY je neměnný.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_power_outage_cez_market_preservation_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Položky bezpečnostního manifestu ČEZ MARKETY jsou neměnné.';
end;
$$;

drop trigger if exists po_cez_market_preservation_manifest_immutable
  on public.power_outage_cez_market_preservation_manifests;
create trigger po_cez_market_preservation_manifest_immutable
before update or delete on public.power_outage_cez_market_preservation_manifests
for each row execute function public.protect_power_outage_cez_market_preservation_manifest();

drop trigger if exists po_cez_market_preservation_items_immutable
  on public.power_outage_cez_market_preservation_items;
create trigger po_cez_market_preservation_items_immutable
before update or delete on public.power_outage_cez_market_preservation_items
for each row execute function public.protect_power_outage_cez_market_preservation_item();

create or replace function public.capture_power_outage_cez_market_preservation_manifest(
  requested_kind text,
  requested_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_manifest_id uuid;
  current_mode text;
  current_revision bigint;
  saved_outages integer := 0;
  saved_addresses integer := 0;
  saved_matches integer := 0;
  saved_links integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Bezpečnostní manifest může vytvořit pouze service role.';
  end if;
  if requested_kind not in ('foundation', 'pre_activation', 'post_activation', 'rollback') then
    raise exception 'Neznámý typ bezpečnostního manifestu: %', requested_kind;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('power_outage_cez_market_manifest', 0)) then
    raise exception 'Jiný bezpečnostní manifest ČEZ MARKETY se právě vytváří.';
  end if;

  -- Krátký konzistentní otisk. SHARE blokuje souběžný zápis sběrače pouze po
  -- dobu vytvoření manifestu, čtení aplikace zůstává dostupné.
  lock table public.power_outages in share mode;
  lock table public.power_outage_addresses in share mode;
  lock table public.power_outage_store_matches in share mode;
  lock table public.power_outage_job_links in share mode;

  select operating_mode into current_mode
  from public.power_outage_cez_market_collector_state
  where singleton
  for share;

  select revision into current_revision
  from public.power_outage_store_catalog_state
  where singleton;

  insert into public.power_outage_cez_market_preservation_manifests (
    manifest_kind, operating_mode, catalog_revision, note, created_by
  ) values (
    requested_kind, current_mode, coalesce(current_revision, 0),
    nullif(btrim(requested_note), ''), auth.uid()
  ) returning id into new_manifest_id;

  insert into public.power_outage_cez_market_preservation_items (
    manifest_id, entity_kind, entity_key, outage_id, payload
  )
  select new_manifest_id, 'outage', outage.id::text, outage.id, to_jsonb(outage)
  from public.power_outages outage
  where outage.source = 'cez';
  get diagnostics saved_outages = row_count;

  insert into public.power_outage_cez_market_preservation_items (
    manifest_id, entity_kind, entity_key, outage_id, payload
  )
  select new_manifest_id, 'address', address.id::text, outage.id, to_jsonb(address)
  from public.power_outage_addresses address
  join public.power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_addresses = row_count;

  insert into public.power_outage_cez_market_preservation_items (
    manifest_id, entity_kind, entity_key, outage_id, payload
  )
  select new_manifest_id, 'store_match', outage_match.id::text, outage.id, to_jsonb(outage_match)
  from public.power_outage_store_matches outage_match
  join public.power_outages outage on outage.id = outage_match.outage_id
  where outage.source = 'cez';
  get diagnostics saved_matches = row_count;

  insert into public.power_outage_cez_market_preservation_items (
    manifest_id, entity_kind, entity_key, outage_id, payload
  )
  select new_manifest_id, 'job_link', link.match_id::text || ':' || link.job_id::text,
    outage.id, to_jsonb(link)
  from public.power_outage_job_links link
  join public.power_outage_store_matches outage_match on outage_match.id = link.match_id
  join public.power_outages outage on outage.id = outage_match.outage_id
  where outage.source = 'cez';
  get diagnostics saved_links = row_count;

  update public.power_outage_cez_market_preservation_manifests
  set outage_count = saved_outages,
      address_count = saved_addresses,
      store_match_count = saved_matches,
      job_link_count = saved_links,
      status = 'complete',
      metadata = jsonb_build_object(
        'contract', 'cez-market-preservation-manifest-v1',
        'productionWritesMade', false
      )
  where id = new_manifest_id;

  return new_manifest_id;
end;
$$;

-- Existující produkční data jsou výchozí stopou v1. Jde pouze o aditivní
-- evidenci; žádný existující řádek odstávky, adresy ani vazby se nemění.
insert into public.power_outage_cez_market_observations (
  collector_version,
  external_id,
  outage_id,
  first_seen_at,
  last_seen_at,
  returned_for_exact_address,
  returned_for_town,
  seeded_baseline,
  missing_since,
  metadata
)
select
  'v1',
  outage.external_id,
  outage.id,
  outage.first_seen_at,
  outage.last_seen_at,
  false,
  true,
  true,
  outage.missing_since,
  jsonb_build_object('seededFromProduction', true)
from public.power_outages outage
where outage.source = 'cez'
on conflict (collector_version, external_id) do nothing;

insert into public.power_outage_cez_market_address_observations (
  collector_version,
  external_id,
  outage_id,
  outage_address_id,
  address_key,
  first_seen_at,
  last_seen_at,
  missing_since,
  metadata
)
select
  'v1',
  outage.external_id,
  outage.id,
  address.id,
  address.address_key,
  address.created_at,
  greatest(address.updated_at, outage.last_seen_at),
  outage.missing_since,
  jsonb_build_object('seededFromProduction', true)
from public.power_outage_addresses address
join public.power_outages outage on outage.id = address.outage_id
where outage.source = 'cez'
on conflict (collector_version, external_id, address_key) do nothing;

drop trigger if exists po_cez_market_cycles_set_updated_at
  on public.power_outage_cez_market_cycles;
create trigger po_cez_market_cycles_set_updated_at
before update on public.power_outage_cez_market_cycles
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists po_cez_market_cycle_targets_set_updated_at
  on public.power_outage_cez_market_cycle_targets;
create trigger po_cez_market_cycle_targets_set_updated_at
before update on public.power_outage_cez_market_cycle_targets
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists po_cez_market_observations_set_updated_at
  on public.power_outage_cez_market_observations;
create trigger po_cez_market_observations_set_updated_at
before update on public.power_outage_cez_market_observations
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists po_cez_market_address_observations_set_updated_at
  on public.power_outage_cez_market_address_observations;
create trigger po_cez_market_address_observations_set_updated_at
before update on public.power_outage_cez_market_address_observations
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_cez_market_cycles enable row level security;
alter table public.power_outage_cez_market_cycle_targets enable row level security;
alter table public.power_outage_cez_market_observations enable row level security;
alter table public.power_outage_cez_market_address_observations enable row level security;
alter table public.power_outage_cez_market_preservation_manifests enable row level security;
alter table public.power_outage_cez_market_preservation_items enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'power_outage_cez_market_cycles',
    'power_outage_cez_market_cycle_targets',
    'power_outage_cez_market_observations',
    'power_outage_cez_market_address_observations',
    'power_outage_cez_market_preservation_manifests',
    'power_outage_cez_market_preservation_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_authorized_read', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_can_view_power_outages())',
      table_name || '_authorized_read',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end
$$;

revoke all on function public.protect_power_outage_cez_market_collector_definitions()
  from public, anon, authenticated;
revoke all on function public.protect_power_outage_cez_market_preservation_manifest()
  from public, anon, authenticated;
revoke all on function public.protect_power_outage_cez_market_preservation_item()
  from public, anon, authenticated;
revoke all on function public.capture_power_outage_cez_market_preservation_manifest(text, text)
  from public, anon, authenticated;
grant execute on function public.capture_power_outage_cez_market_preservation_manifest(text, text)
  to service_role;

-- Starý jednovariantní přepínač nyní smí pouze bezpečně potvrdit/obnovit v1.
-- Zapnutí dual/v2 dostane později vlastní funkci s kontrolou auditu a manifestu.
create or replace function public.set_power_outage_cez_market_collector_version(
  requested_version text,
  requested_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Změnu verze sběrače může provést pouze service role.';
  end if;
  if requested_version is distinct from 'v1' then
    raise exception 'ČEZ MARKETY v2 zatím není aktivovatelný. Použijte až řízenou aktivaci dual režimu.';
  end if;

  update public.power_outage_cez_market_collector_state
  set previous_version = active_version,
      operating_mode = 'v1_only',
      active_version = 'v1',
      primary_version = 'v1',
      secondary_version = null,
      activation_ready = false,
      switched_at = now(),
      switched_by = auth.uid(),
      switch_note = coalesce(nullif(btrim(requested_note), ''), 'Bezpečný návrat na ČEZ MARKETY v1.')
  where singleton;

  return 'v1';
end;
$$;

revoke all on function public.set_power_outage_cez_market_collector_version(text, text)
  from public, anon, authenticated;
grant execute on function public.set_power_outage_cez_market_collector_version(text, text)
  to service_role;

do $$
begin
  if not exists (
    select 1
    from public.power_outage_cez_market_preservation_manifests
    where manifest_kind = 'foundation'
      and status = 'complete'
  ) then
    perform public.capture_power_outage_cez_market_preservation_manifest(
      'foundation',
      'Výchozí neměnný otisk produkčních dat ČEZ MARKETY před implementací dual režimu.'
    );
  end if;
end
$$;

comment on table public.power_outage_cez_market_cycles is
  'Oddělené cykly sběračů ČEZ v1 a v2 pouze pro režim MARKETY.';
comment on table public.power_outage_cez_market_observations is
  'Verzovaná evidence, která implementace ČEZ MARKETY viděla konkrétní sdílenou odstávku.';
comment on table public.power_outage_cez_market_address_observations is
  'Verzovaná evidence adres odstávky; brání jednomu sběrači odstranit adresu pozorovanou druhým.';
comment on table public.power_outage_cez_market_preservation_manifests is
  'Neměnné kontrolní otisky ČEZ dat, adres, vazeb na prodejny a zakázky před/po aktivaci.';

commit;

select 'FUNCTION' as check_type,
  'legacy switch cannot activate CEZ MARKET v2' as object_name,
  position(
    'requested_version is distinct from ''v1'''
    in pg_get_functiondef('public.set_power_outage_cez_market_collector_version(text,text)'::regprocedure)
  ) > 0 as is_correct
union all
select 'GRANT', 'authenticated cannot capture preservation manifest',
  not has_function_privilege(
    'authenticated',
    'public.capture_power_outage_cez_market_preservation_manifest(text,text)',
    'EXECUTE'
  )
union all
select 'GRANT', 'authenticated cannot mutate CEZ MARKET dual state',
  not exists (
    select 1
    from information_schema.role_table_grants role_grant
    where role_grant.grantee = 'authenticated'
      and role_grant.table_schema = 'public'
      and role_grant.table_name in (
        'power_outage_cez_market_cycles',
        'power_outage_cez_market_cycle_targets',
        'power_outage_cez_market_observations',
        'power_outage_cez_market_address_observations',
        'power_outage_cez_market_preservation_manifests',
        'power_outage_cez_market_preservation_items'
      )
      and role_grant.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  )
union all
select 'ISOLATION', 'dual foundation does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(pg_get_functiondef(
    'public.capture_power_outage_cez_market_preservation_manifest(text,text)'::regprocedure
  ))) = 0
union all
select 'LOGIC', 'dual mode keeps CEZ v2 primary and CEZ v1 running secondary',
  coalesce((
    select position('operating_mode = ''dual''' in pg_get_constraintdef(oid)) > 0
      and position('primary_version = ''v2''' in pg_get_constraintdef(oid)) > 0
      and position('secondary_version = ''v1''' in pg_get_constraintdef(oid)) > 0
    from pg_constraint
    where conname = 'po_cez_market_collector_state_combination_check'
      and conrelid = 'public.power_outage_cez_market_collector_state'::regclass
  ), false)
union all
select 'SAFETY', 'foundation manifest contains every current CEZ outage',
  coalesce((
    select manifest.outage_count = (
      select count(*) from public.power_outages outage where outage.source = 'cez'
    )
    from public.power_outage_cez_market_preservation_manifests manifest
    where manifest.manifest_kind = 'foundation' and manifest.status = 'complete'
    order by manifest.created_at desc
    limit 1
  ), false)
union all
select 'SAFETY', 'foundation manifest contains every current CEZ address',
  coalesce((
    select manifest.address_count = (
      select count(*)
      from public.power_outage_addresses address
      join public.power_outages outage on outage.id = address.outage_id
      where outage.source = 'cez'
    )
    from public.power_outage_cez_market_preservation_manifests manifest
    where manifest.manifest_kind = 'foundation' and manifest.status = 'complete'
    order by manifest.created_at desc
    limit 1
  ), false)
union all
select 'SAFETY', 'foundation manifest contains every current CEZ store match',
  coalesce((
    select manifest.store_match_count = (
      select count(*)
      from public.power_outage_store_matches outage_match
      join public.power_outages outage on outage.id = outage_match.outage_id
      where outage.source = 'cez'
    )
    from public.power_outage_cez_market_preservation_manifests manifest
    where manifest.manifest_kind = 'foundation' and manifest.status = 'complete'
    order by manifest.created_at desc
    limit 1
  ), false)
union all
select 'SAFETY', 'foundation manifest contains every current CEZ job link',
  coalesce((
    select manifest.job_link_count = (
      select count(*)
      from public.power_outage_job_links link
      join public.power_outage_store_matches outage_match on outage_match.id = link.match_id
      join public.power_outages outage on outage.id = outage_match.outage_id
      where outage.source = 'cez'
    )
    from public.power_outage_cez_market_preservation_manifests manifest
    where manifest.manifest_kind = 'foundation' and manifest.status = 'complete'
    order by manifest.created_at desc
    limit 1
  ), false)
union all
select 'SAFETY', 'all current CEZ outages seeded as v1 observations',
  not exists (
    select 1
    from public.power_outages outage
    where outage.source = 'cez'
      and not exists (
        select 1
        from public.power_outage_cez_market_observations observation
        where observation.collector_version = 'v1'
          and observation.external_id = outage.external_id
          and observation.outage_id = outage.id
      )
  )
union all
select 'SAFETY', 'all current CEZ addresses seeded as v1 observations',
  not exists (
    select 1
    from public.power_outage_addresses address
    join public.power_outages outage on outage.id = address.outage_id
    where outage.source = 'cez'
      and not exists (
        select 1
        from public.power_outage_cez_market_address_observations observation
        where observation.collector_version = 'v1'
          and observation.external_id = outage.external_id
          and observation.address_key = address.address_key
          and observation.outage_address_id = address.id
      )
  )
union all
select 'SAFETY', 'migration started no CEZ MARKET v2 cycle',
  not exists (
    select 1 from public.power_outage_cez_market_cycles
    where collector_version = 'v2'
  )
union all
select 'STATE', 'CEZ MARKET remains v1 only',
  coalesce((
    select operating_mode = 'v1_only'
      and active_version = 'v1'
      and primary_version = 'v1'
      and secondary_version is null
      and activation_ready is false
    from public.power_outage_cez_market_collector_state
    where singleton
  ), false)
union all
select 'TABLE', 'CEZ MARKET version observations',
  to_regclass('public.power_outage_cez_market_observations') is not null
union all
select 'TABLE', 'CEZ MARKET preservation manifests',
  to_regclass('public.power_outage_cez_market_preservation_manifests') is not null
union all
select 'TRIGGER', 'completed preservation manifests are immutable',
  exists (
    select 1 from pg_trigger
    where tgname = 'po_cez_market_preservation_manifest_immutable'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'po_cez_market_preservation_items_immutable'
      and not tgisinternal
  )
union all
select 'VERSION', 'CEZ MARKET v1 and v2 definitions are immutable',
  exists (
    select 1 from pg_trigger
    where tgname = 'po_cez_market_collector_definitions_immutable'
      and not tgisinternal
  )
  and (select count(*) = 2
    from public.power_outage_cez_market_collector_versions
    where version in ('v1', 'v2'))
order by check_type, object_name;
