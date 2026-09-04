begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_scan_cycles') is null
    or to_regclass('public.complete_power_outage_cez_scan_attempts') is null
    or to_regclass('public.complete_power_outage_cez_staged_outages') is null
  then
    raise exception 'Nejdříve spusťte migrace celoplošného ČEZ skenu a stagingu.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_scan_cycles
  add column if not exists snapshot_contract_version integer,
  add column if not exists snapshot_status text not null default 'building',
  add column if not exists snapshot_finalized_at timestamptz,
  add column if not exists snapshot_publishable boolean not null default false,
  add column if not exists snapshot_outage_count integer not null default 0,
  add column if not exists snapshot_address_count integer not null default 0,
  add column if not exists snapshot_missing_count integer not null default 0,
  add column if not exists scope_catalog_count integer,
  add column if not exists scope_classified_count integer,
  add column if not exists scope_cez_count integer;

alter table public.complete_power_outage_cez_scan_cycles
  drop constraint if exists cpo_cez_scan_cycles_snapshot_status_check;
alter table public.complete_power_outage_cez_scan_cycles
  add constraint cpo_cez_scan_cycles_snapshot_status_check
  check (snapshot_status in ('building', 'complete', 'incomplete', 'pilot', 'rejected'));

alter table public.complete_power_outage_cez_scan_cycles
  drop constraint if exists cpo_cez_scan_cycles_snapshot_counts_check;
alter table public.complete_power_outage_cez_scan_cycles
  add constraint cpo_cez_scan_cycles_snapshot_counts_check
  check (
    (snapshot_contract_version is null or snapshot_contract_version >= 1)
    and snapshot_outage_count >= 0
    and snapshot_address_count >= 0
    and snapshot_missing_count >= 0
    and (scope_catalog_count is null or scope_catalog_count >= 0)
    and (scope_classified_count is null or scope_classified_count >= 0)
    and (scope_cez_count is null or scope_cez_count >= 0)
    and (not snapshot_publishable or snapshot_status = 'complete')
    and (
      (snapshot_status = 'building' and snapshot_finalized_at is null)
      or (snapshot_status <> 'building' and snapshot_finalized_at is not null)
    )
  );

-- Obce zahrnuté do cyklu se po jeho založení nemění. Nově zmapované obce
-- vstoupí až do následujícího cyklu a nemohou vytlačit původní rozsah.
create table if not exists public.complete_power_outage_cez_cycle_municipalities (
  cycle_id uuid not null
    references public.complete_power_outage_cez_scan_cycles(id) on delete cascade,
  municipality_code text not null
    references public.complete_power_outage_cez_municipalities(municipality_code) on delete restrict,
  municipality_name text not null,
  cez_address_id bigint not null,
  cez_town_code bigint not null,
  created_at timestamptz not null default now(),
  primary key (cycle_id, municipality_code),
  constraint cpo_cez_cycle_municipalities_ids_check
    check (cez_address_id > 0 and cez_town_code > 0)
);

create index if not exists cpo_cez_cycle_municipalities_code_idx
  on public.complete_power_outage_cez_cycle_municipalities (municipality_code, cycle_id);

-- Toto je vlastní neměnný snapshot. Vedle členství uchovává i payload
-- odstávky a adres tak, jak vypadal v okamžiku daného cyklu.
create table if not exists public.complete_power_outage_cez_cycle_outages (
  cycle_id uuid not null
    references public.complete_power_outage_cez_scan_cycles(id) on delete cascade,
  outage_external_id text not null
    references public.complete_power_outage_cez_staged_outages(external_id) on delete restrict,
  observed_municipality_code text not null,
  source_status text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  payload_sha256 text not null,
  addresses_sha256 text not null,
  address_count integer not null,
  outage_payload jsonb not null,
  addresses_payload jsonb not null,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (cycle_id, outage_external_id),
  constraint cpo_cez_cycle_outages_status_check
    check (source_status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint cpo_cez_cycle_outages_period_check check (ends_at > starts_at),
  constraint cpo_cez_cycle_outages_hashes_check
    check (
      payload_sha256 ~ '^[a-f0-9]{64}$'
      and addresses_sha256 ~ '^[a-f0-9]{64}$'
    ),
  constraint cpo_cez_cycle_outages_payload_check
    check (
      address_count >= 0
      and jsonb_typeof(outage_payload) = 'object'
      and jsonb_typeof(addresses_payload) = 'array'
      and jsonb_array_length(addresses_payload) = address_count
    )
);

create index if not exists cpo_cez_cycle_outages_timeline_idx
  on public.complete_power_outage_cez_cycle_outages (cycle_id, starts_at, outage_external_id);

create index if not exists cpo_cez_cycle_outages_external_idx
  on public.complete_power_outage_cez_cycle_outages (outage_external_id, cycle_id);

alter table public.complete_power_outage_cez_cycle_municipalities enable row level security;
alter table public.complete_power_outage_cez_cycle_outages enable row level security;

drop policy if exists cpo_cez_cycle_municipalities_authorized_read
  on public.complete_power_outage_cez_cycle_municipalities;
create policy cpo_cez_cycle_municipalities_authorized_read
  on public.complete_power_outage_cez_cycle_municipalities
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_cycle_outages_authorized_read
  on public.complete_power_outage_cez_cycle_outages;
create policy cpo_cez_cycle_outages_authorized_read
  on public.complete_power_outage_cez_cycle_outages
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_cycle_municipalities
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_cycle_outages
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_cycle_municipalities to authenticated;
grant select on table public.complete_power_outage_cez_cycle_outages to authenticated;
grant all on table public.complete_power_outage_cez_cycle_municipalities to service_role;
grant all on table public.complete_power_outage_cez_cycle_outages to service_role;

-- Starší cykly nebyly vytvořeny snapshotovým kontraktem v2 a nesmějí být
-- zpětně označeny jako publikovatelné.
update public.complete_power_outage_cez_scan_cycles cycle
set snapshot_contract_version = coalesce(cycle.snapshot_contract_version, 1),
    snapshot_status = case
      when cycle.status = 'running' then 'building'
      when cycle.is_pilot then 'pilot'
      else 'incomplete'
    end,
    snapshot_finalized_at = case
      when cycle.status = 'running' then null
      else coalesce(cycle.snapshot_finalized_at, cycle.finished_at, now())
    end,
    snapshot_publishable = false;

-- Běžící legacy cyklus necháme bezpečně doběhnout. Rozsah doplníme na jeho
-- původní total; kvůli kontraktu v1 se přesto nikdy nestane publikovatelným.
insert into public.complete_power_outage_cez_cycle_municipalities (
  cycle_id,
  municipality_code,
  municipality_name,
  cez_address_id,
  cez_town_code
)
select
  cycle.id,
  municipality.municipality_code,
  municipality.municipality_name,
  municipality.cez_address_id,
  municipality.cez_town_code
from public.complete_power_outage_cez_scan_cycles cycle
cross join lateral (
  select municipality.*
  from public.complete_power_outage_cez_municipalities municipality
  where municipality.is_active
    and municipality.distribution_status = 'cez'
    and municipality.mapping_status = 'resolved'
    and municipality.cez_address_id is not null
    and municipality.cez_town_code is not null
  order by
    case when exists (
      select 1
      from public.complete_power_outage_cez_scan_attempts attempt
      where attempt.cycle_id = cycle.id
        and attempt.municipality_code = municipality.municipality_code
    ) then 0 else 1 end,
    municipality.municipality_code
  limit cycle.municipality_total_count
) municipality
where cycle.status = 'running'
on conflict (cycle_id, municipality_code) do nothing;

insert into public.complete_power_outage_cez_cycle_outages (
  cycle_id,
  outage_external_id,
  observed_municipality_code,
  source_status,
  starts_at,
  ends_at,
  payload_sha256,
  addresses_sha256,
  address_count,
  outage_payload,
  addresses_payload,
  observed_at
)
select
  outage.last_seen_cycle_id,
  outage.external_id,
  coalesce(outage.metadata #>> '{completeCezScan,municipalityCode}', outage.municipality_code, ''),
  outage.source_status,
  outage.starts_at,
  outage.ends_at,
  outage.payload_sha256,
  encode(digest(coalesce(addresses.payload, '[]'::jsonb)::text, 'sha256'), 'hex'),
  coalesce(addresses.address_count, 0),
  jsonb_build_object(
    'external_id', outage.external_id,
    'source_status', outage.source_status,
    'title', outage.title,
    'description', outage.description,
    'starts_at', outage.starts_at,
    'ends_at', outage.ends_at,
    'archive_at', outage.archive_at,
    'municipality', outage.municipality,
    'municipality_code', outage.municipality_code,
    'district', outage.district,
    'region', outage.region,
    'source_url', outage.source_url,
    'announcement_url', outage.announcement_url,
    'payload_sha256', outage.payload_sha256,
    'source_updated_at', outage.source_updated_at,
    'metadata', outage.metadata
  ),
  coalesce(addresses.payload, '[]'::jsonb),
  outage.last_seen_at
from public.complete_power_outage_cez_staged_outages outage
join public.complete_power_outage_cez_scan_cycles cycle
  on cycle.id = outage.last_seen_cycle_id
 and cycle.status = 'running'
left join lateral (
  select
    count(*)::integer as address_count,
    jsonb_agg(
      jsonb_build_object(
        'external_address_id', address.external_address_id,
        'address_key', address.address_key,
        'municipality', address.municipality,
        'municipality_code', address.municipality_code,
        'town_part', address.town_part,
        'street', address.street,
        'house_number', address.house_number,
        'orientation_number', address.orientation_number,
        'postal_code', address.postal_code,
        'raw_address', address.raw_address,
        'normalized_municipality', address.normalized_municipality,
        'normalized_street', address.normalized_street,
        'latitude', address.latitude,
        'longitude', address.longitude,
        'payload_sha256', address.payload_sha256,
        'metadata', address.metadata
      ) order by address.address_key
    ) as payload
  from public.complete_power_outage_cez_staged_addresses address
  where address.outage_external_id = outage.external_id
) addresses on true
where outage.last_seen_cycle_id is not null
on conflict (cycle_id, outage_external_id) do nothing;

-- Členství rozsahu i výsledků je append-only. Po uzavření cyklu nelze přidat
-- ani nový člen; existující člen nelze měnit nikdy.
create or replace function public.protect_complete_power_outage_cez_cycle_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_status text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Členství ČEZ snapshotu je neměnné.';
  end if;

  select cycle.status into parent_status
  from public.complete_power_outage_cez_scan_cycles cycle
  where cycle.id = new.cycle_id;

  if parent_status is distinct from 'running' then
    raise exception 'Do uzavřeného ČEZ snapshotu nelze zapisovat.';
  end if;
  return new;
end;
$$;

drop trigger if exists cpo_cez_cycle_municipalities_immutable
  on public.complete_power_outage_cez_cycle_municipalities;
create trigger cpo_cez_cycle_municipalities_immutable
before insert or update or delete on public.complete_power_outage_cez_cycle_municipalities
for each row execute function public.protect_complete_power_outage_cez_cycle_member();

drop trigger if exists cpo_cez_cycle_outages_immutable
  on public.complete_power_outage_cez_cycle_outages;
create trigger cpo_cez_cycle_outages_immutable
before insert or update or delete on public.complete_power_outage_cez_cycle_outages
for each row execute function public.protect_complete_power_outage_cez_cycle_member();

create or replace function public.initialize_complete_power_outage_cez_cycle_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog_count integer;
  classified_count integer;
  cez_count integer;
begin
  if new.snapshot_contract_version is null then
    new.snapshot_contract_version := 2;
  end if;
  new.snapshot_status := 'building';
  new.snapshot_finalized_at := null;
  new.snapshot_publishable := false;

  select
    count(*) filter (where municipality.is_active)::integer,
    count(*) filter (
      where municipality.is_active
        and (
          municipality.representative_status = 'no_address'
          or (
            municipality.representative_status = 'resolved'
            and municipality.mapping_status in ('resolved', 'not_cez')
          )
        )
    )::integer,
    count(*) filter (
      where municipality.is_active
        and municipality.representative_status = 'resolved'
        and municipality.mapping_status = 'resolved'
        and municipality.distribution_status = 'cez'
        and municipality.cez_address_id is not null
        and municipality.cez_town_code is not null
    )::integer
  into catalog_count, classified_count, cez_count
  from public.complete_power_outage_cez_municipalities municipality;

  new.scope_catalog_count := catalog_count;
  new.scope_classified_count := classified_count;
  new.scope_cez_count := cez_count;
  new.municipality_total_count := case
    when new.is_pilot then least(new.municipality_total_count, cez_count)
    else cez_count
  end;
  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object('snapshotContract', 'complete-cez-cycle-snapshot-v2');
  return new;
end;
$$;

drop trigger if exists cpo_cez_scan_cycle_initialize_snapshot
  on public.complete_power_outage_cez_scan_cycles;
create trigger cpo_cez_scan_cycle_initialize_snapshot
before insert on public.complete_power_outage_cez_scan_cycles
for each row execute function public.initialize_complete_power_outage_cez_cycle_snapshot();

create or replace function public.populate_complete_power_outage_cez_cycle_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.complete_power_outage_cez_cycle_municipalities (
    cycle_id,
    municipality_code,
    municipality_name,
    cez_address_id,
    cez_town_code
  )
  select
    new.id,
    municipality.municipality_code,
    municipality.municipality_name,
    municipality.cez_address_id,
    municipality.cez_town_code
  from public.complete_power_outage_cez_municipalities municipality
  where municipality.is_active
    and municipality.representative_status = 'resolved'
    and municipality.mapping_status = 'resolved'
    and municipality.distribution_status = 'cez'
    and municipality.cez_address_id is not null
    and municipality.cez_town_code is not null
  order by municipality.scan_priority, municipality.municipality_code
  limit new.municipality_total_count;
  return new;
end;
$$;

drop trigger if exists cpo_cez_scan_cycle_populate_scope
  on public.complete_power_outage_cez_scan_cycles;
create trigger cpo_cez_scan_cycle_populate_scope
after insert on public.complete_power_outage_cez_scan_cycles
for each row execute function public.populate_complete_power_outage_cez_cycle_scope();

-- Bezpečný serverový zápis snapshotu jednoho výsledku obce. Opakovaný shodný
-- zápis je idempotentní; rozdílný payload stejné odstávky v témže cyklu cyklus
-- raději zneplatní než aby skryl nekonzistenci.
create or replace function public.record_complete_power_outage_cez_cycle_outages(
  requested_cycle_id uuid,
  requested_municipality_code text,
  requested_outages jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  existing_payload_hash text;
  existing_addresses_hash text;
  item_addresses_hash text;
  inserted_count integer := 0;
begin
  if jsonb_typeof(requested_outages) <> 'array' then
    raise exception 'Snapshot odstávek musí být JSON pole.';
  end if;
  if not exists (
    select 1
    from public.complete_power_outage_cez_scan_cycles cycle
    where cycle.id = requested_cycle_id and cycle.status = 'running'
  ) then
    raise exception 'ČEZ snapshot není otevřený pro zápis.';
  end if;
  if not exists (
    select 1
    from public.complete_power_outage_cez_cycle_municipalities scope
    where scope.cycle_id = requested_cycle_id
      and scope.municipality_code = requested_municipality_code
  ) then
    raise exception 'Obec není součástí rozsahu ČEZ snapshotu.';
  end if;

  for item in select value from jsonb_array_elements(requested_outages)
  loop
    item_addresses_hash := encode(
      digest(coalesce(item->'addressesPayload', '[]'::jsonb)::text, 'sha256'),
      'hex'
    );

    select member.payload_sha256, member.addresses_sha256
    into existing_payload_hash, existing_addresses_hash
    from public.complete_power_outage_cez_cycle_outages member
    where member.cycle_id = requested_cycle_id
      and member.outage_external_id = item->>'externalId';

    if found then
      if existing_payload_hash is distinct from item->>'payloadSha256'
        or existing_addresses_hash is distinct from item_addresses_hash
      then
        raise exception 'Odstávka % má v jednom ČEZ cyklu rozdílný payload.', item->>'externalId';
      end if;
      continue;
    end if;

    insert into public.complete_power_outage_cez_cycle_outages (
      cycle_id,
      outage_external_id,
      observed_municipality_code,
      source_status,
      starts_at,
      ends_at,
      payload_sha256,
      addresses_sha256,
      address_count,
      outage_payload,
      addresses_payload
    ) values (
      requested_cycle_id,
      item->>'externalId',
      requested_municipality_code,
      item->>'sourceStatus',
      (item->>'startsAt')::timestamptz,
      (item->>'endsAt')::timestamptz,
      item->>'payloadSha256',
      item_addresses_hash,
      jsonb_array_length(coalesce(item->'addressesPayload', '[]'::jsonb)),
      item->'outagePayload',
      coalesce(item->'addressesPayload', '[]'::jsonb)
    );
    inserted_count := inserted_count + 1;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.record_complete_power_outage_cez_cycle_outages(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_complete_power_outage_cez_cycle_outages(uuid, text, jsonb)
  to service_role;

-- Claim v2 vybírá výhradně obce zmrazené při vytvoření cyklu. Termín další
-- kontroly rozhoduje jen o startu nového cyklu, ne o jeho vnitřním rozsahu.
create or replace function public.claim_complete_power_outage_cez_scan_batch(
  requested_limit integer default 3,
  requested_pilot boolean default true
)
returns table (
  cycle_id uuid,
  municipality_code text,
  municipality_name text,
  cez_address_id bigint,
  cez_town_code bigint,
  scan_attempt_count integer,
  scan_consecutive_error_count integer,
  scan_lock_token uuid,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(20, greatest(1, coalesce(requested_limit, 3)));
  active_cycle public.complete_power_outage_cez_scan_cycles%rowtype;
  batch_token uuid := gen_random_uuid();
  due_count integer;
  scope_count integer;
  cycle_claimed_count integer;
begin
  update public.complete_power_outage_cez_municipalities municipality
  set scan_status = 'error', scan_next_attempt_at = now(),
      scan_error_code = 'CEZ_SCAN_LOCK_EXPIRED',
      scan_error_message = 'Předchozí sken obce nebyl dokončen v bezpečnostním limitu.',
      scan_lock_token = null, scan_lock_expires_at = null
  where municipality.scan_status = 'processing'
    and municipality.scan_lock_expires_at <= now();

  update public.complete_power_outage_cez_scan_attempts attempt
  set status = 'failed', finished_at = now(),
      error_code = 'CEZ_SCAN_LOCK_EXPIRED',
      error_message = 'Předchozí sken obce nebyl dokončen v bezpečnostním limitu.'
  where attempt.status = 'running'
    and attempt.started_at <= now() - interval '12 minutes';

  update public.complete_power_outage_cez_scan_cycles cycle
  set status = 'failed', finished_at = now(),
      snapshot_status = 'rejected', snapshot_finalized_at = now(),
      snapshot_publishable = false,
      error_code = 'CEZ_SCAN_CYCLE_STALE',
      error_message = 'Skenovací cyklus nebyl dokončen v bezpečnostním limitu.'
  where cycle.status = 'running'
    and coalesce((
      select max(attempt.updated_at)
      from public.complete_power_outage_cez_scan_attempts attempt
      where attempt.cycle_id = cycle.id
    ), cycle.started_at) <= now() - interval '30 minutes'
    and not exists (
      select 1
      from public.complete_power_outage_cez_scan_attempts running_attempt
      where running_attempt.cycle_id = cycle.id
        and running_attempt.status = 'running'
    );

  select * into active_cycle
  from public.complete_power_outage_cez_scan_cycles cycle
  where cycle.status = 'running'
  order by cycle.started_at desc
  limit 1
  for update;

  if found and active_cycle.is_pilot <> coalesce(requested_pilot, true) then
    raise exception 'Již běží jiný typ celoplošného ČEZ cyklu.';
  end if;

  if not found then
    select count(*)::integer into due_count
    from public.complete_power_outage_cez_municipalities municipality
    where municipality.is_active
      and municipality.distribution_status = 'cez'
      and municipality.mapping_status = 'resolved'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null
      and municipality.scan_status in ('pending', 'succeeded', 'no_change', 'partial', 'error')
      and (municipality.scan_next_attempt_at is null or municipality.scan_next_attempt_at <= now());

    if due_count = 0 then return; end if;

    select count(*)::integer into scope_count
    from public.complete_power_outage_cez_municipalities municipality
    where municipality.is_active
      and municipality.distribution_status = 'cez'
      and municipality.mapping_status = 'resolved'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null
      and municipality.scan_status <> 'disabled';

    insert into public.complete_power_outage_cez_scan_cycles (
      trigger_kind, status, is_pilot, municipality_total_count, metadata
    ) values (
      case when coalesce(requested_pilot, true) then 'pilot' else 'scheduled' end,
      'running', coalesce(requested_pilot, true),
      case when coalesce(requested_pilot, true) then least(safe_limit, scope_count) else scope_count end,
      jsonb_build_object('contract', 'complete-cez-municipality-scan-v2')
    ) returning * into active_cycle;
  end if;

  select count(*)::integer into cycle_claimed_count
  from public.complete_power_outage_cez_scan_attempts attempt
  where attempt.cycle_id = active_cycle.id;
  if cycle_claimed_count >= active_cycle.municipality_total_count then return; end if;

  return query
  with candidates as (
    select scope.municipality_code
    from public.complete_power_outage_cez_cycle_municipalities scope
    join public.complete_power_outage_cez_municipalities municipality
      on municipality.municipality_code = scope.municipality_code
    where scope.cycle_id = active_cycle.id
      and not exists (
        select 1 from public.complete_power_outage_cez_scan_attempts previous_attempt
        where previous_attempt.cycle_id = active_cycle.id
          and previous_attempt.municipality_code = scope.municipality_code
      )
    order by municipality.scan_priority, municipality.scan_last_success_at nulls first,
      scope.municipality_code
    for update of municipality skip locked
    limit least(safe_limit, greatest(0, active_cycle.municipality_total_count - cycle_claimed_count))
  ), claimed as (
    update public.complete_power_outage_cez_municipalities municipality
    set scan_status = 'processing',
        scan_attempt_count = municipality.scan_attempt_count + 1,
        scan_last_attempt_at = now(), scan_lock_token = batch_token,
        scan_lock_expires_at = now() + interval '12 minutes',
        scan_error_code = null, scan_error_message = null
    from candidates
    where municipality.municipality_code = candidates.municipality_code
    returning municipality.*
  ), attempts as (
    insert into public.complete_power_outage_cez_scan_attempts (
      cycle_id, municipality_code, attempt_number, status, cez_address_id, cez_town_code
    )
    select active_cycle.id, claimed.municipality_code, claimed.scan_attempt_count,
      'running', claimed.cez_address_id, claimed.cez_town_code
    from claimed
    returning complete_power_outage_cez_scan_attempts.municipality_code,
      complete_power_outage_cez_scan_attempts.attempt_number
  )
  select active_cycle.id, claimed.municipality_code, claimed.municipality_name,
    claimed.cez_address_id, claimed.cez_town_code, claimed.scan_attempt_count,
    claimed.scan_consecutive_error_count, claimed.scan_lock_token, attempts.attempt_number
  from claimed
  join attempts on attempts.municipality_code = claimed.municipality_code
    and attempts.attempt_number = claimed.scan_attempt_count
  order by claimed.municipality_code;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_scan_batch(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_scan_batch(integer, boolean)
  to service_role;

create or replace function public.finish_complete_power_outage_cez_scan_cycle(
  requested_cycle_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.complete_power_outage_cez_scan_cycles%rowtype;
  processed_count integer; success_count integer; error_count integer; skipped_count integer;
  snapshot_recorded_count integer;
  member_count integer; member_address_count integer; missing_count integer := 0;
  v_changed_outage_count integer; v_changed_address_count integer;
  current_catalog_count integer; current_classified_count integer; current_cez_count integer;
  final_status text; safe_complete boolean;
begin
  select * into cycle_row
  from public.complete_power_outage_cez_scan_cycles cycle
  where cycle.id = requested_cycle_id for update;
  if not found then raise exception 'ČEZ skenovací cyklus neexistuje.'; end if;
  if cycle_row.status <> 'running' then return cycle_row.status; end if;

  select
    count(*) filter (where attempt.status <> 'running')::integer,
    count(*) filter (where attempt.status in ('succeeded', 'no_change'))::integer,
    count(*) filter (where attempt.status = 'failed')::integer,
    count(*) filter (where attempt.status = 'skipped')::integer,
    count(*) filter (
      where attempt.status in ('succeeded', 'no_change')
        and coalesce(attempt.metadata->>'snapshotRecorded', 'false') = 'true'
    )::integer,
    coalesce(sum(case when attempt.metadata->>'changedOutageCount' ~ '^[0-9]+$'
      then (attempt.metadata->>'changedOutageCount')::integer else 0 end), 0)::integer,
    coalesce(sum(case when attempt.metadata->>'changedAddressCount' ~ '^[0-9]+$'
      then (attempt.metadata->>'changedAddressCount')::integer else 0 end), 0)::integer
  into processed_count, success_count, error_count, skipped_count, snapshot_recorded_count,
    v_changed_outage_count, v_changed_address_count
  from public.complete_power_outage_cez_scan_attempts attempt
  where attempt.cycle_id = requested_cycle_id;

  select count(*)::integer, coalesce(sum(member.address_count), 0)::integer
  into member_count, member_address_count
  from public.complete_power_outage_cez_cycle_outages member
  where member.cycle_id = requested_cycle_id;

  update public.complete_power_outage_cez_scan_cycles
  set municipality_processed_count = processed_count,
      municipality_success_count = success_count,
      municipality_error_count = error_count,
      municipality_skipped_count = skipped_count,
      outage_count = member_count, address_count = member_address_count,
      snapshot_outage_count = member_count, snapshot_address_count = member_address_count,
      changed_outage_count = v_changed_outage_count,
      changed_address_count = v_changed_address_count
  where id = requested_cycle_id;

  if processed_count < cycle_row.municipality_total_count then return 'running'; end if;

  final_status := case
    when error_count = 0 and v_changed_outage_count = 0 and v_changed_address_count = 0 then 'no_change'
    when error_count = 0 then 'succeeded'
    when success_count > 0 then 'partial'
    else 'failed' end;

  select
    count(*) filter (where municipality.is_active)::integer,
    count(*) filter (where municipality.is_active and (
      municipality.representative_status = 'no_address'
      or (municipality.representative_status = 'resolved'
        and municipality.mapping_status in ('resolved', 'not_cez'))
    ))::integer,
    count(*) filter (where municipality.is_active
      and municipality.representative_status = 'resolved'
      and municipality.mapping_status = 'resolved'
      and municipality.distribution_status = 'cez'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null)::integer
  into current_catalog_count, current_classified_count, current_cez_count
  from public.complete_power_outage_cez_municipalities municipality;

  safe_complete := cycle_row.snapshot_contract_version = 2
    and not cycle_row.is_pilot
    and error_count = 0 and skipped_count = 0
    and success_count = cycle_row.municipality_total_count
    and snapshot_recorded_count = cycle_row.municipality_total_count
    and cycle_row.scope_catalog_count = cycle_row.scope_classified_count
    and current_catalog_count = current_classified_count
    and cycle_row.scope_catalog_count = current_catalog_count
    and cycle_row.scope_cez_count = cycle_row.municipality_total_count
    and current_cez_count = cycle_row.municipality_total_count
    and (select count(*) from public.complete_power_outage_cez_cycle_municipalities scope
      where scope.cycle_id = requested_cycle_id) = cycle_row.municipality_total_count;

  if safe_complete then
    update public.complete_power_outage_cez_staged_outages outage
    set missing_since = now()
    where outage.missing_since is null
      and outage.ends_at > cycle_row.started_at
      and not exists (
        select 1 from public.complete_power_outage_cez_cycle_outages member
        where member.cycle_id = requested_cycle_id
          and member.outage_external_id = outage.external_id
      );
    get diagnostics missing_count = row_count;
  end if;

  update public.complete_power_outage_cez_scan_cycles
  set status = final_status, finished_at = now(),
      snapshot_status = case
        when is_pilot then 'pilot'
        when safe_complete then 'complete'
        when error_count > 0 or skipped_count > 0 then 'rejected'
        else 'incomplete' end,
      snapshot_finalized_at = now(), snapshot_publishable = safe_complete,
      snapshot_missing_count = missing_count,
      payload_sha256 = case when member_count > 0 then (
        select encode(digest(string_agg(member.outage_external_id || ':' || member.payload_sha256
          || ':' || member.addresses_sha256, '|' order by member.outage_external_id), 'sha256'), 'hex')
        from public.complete_power_outage_cez_cycle_outages member
        where member.cycle_id = requested_cycle_id
      ) else encode(digest('', 'sha256'), 'hex') end,
      error_code = case
        when error_count > 0 then 'CEZ_SCAN_MUNICIPALITY_ERRORS'
        when not safe_complete and not is_pilot then 'CEZ_SNAPSHOT_SCOPE_INCOMPLETE'
        else null end,
      error_message = case
        when error_count > 0 then error_count::text || ' obcí nebylo úspěšně zkontrolováno.'
        when not safe_complete and not is_pilot then
          'Cyklus doběhl, ale katalog nebo mapování obcí ještě nebyly celoplošně dokončeny.'
        else null end
  where id = requested_cycle_id;
  return final_status;
end;
$$;

revoke all on function public.finish_complete_power_outage_cez_scan_cycle(uuid)
  from public, anon, authenticated;
grant execute on function public.finish_complete_power_outage_cez_scan_cycle(uuid)
  to service_role;

commit;
