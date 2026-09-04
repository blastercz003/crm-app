begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_scan_cycles') is null
    or to_regclass('public.complete_power_outage_cez_cycle_outages') is null
    or to_regclass('public.complete_power_outage_cez_staged_outages') is null
    or to_regclass('public.complete_power_outage_cez_staged_addresses') is null
    or to_regclass('public.complete_power_outage_cez_staged_address_targets') is null
  then
    raise exception 'Nejdříve dokončete migrace celoplošného ČEZ snapshotu a RÚIAN normalizace.';
  end if;
end
$$;

-- Audit každého průběžného promítnutí. Úspěšně zkontrolované obce lze
-- publikovat ihned; úplný cyklus je nutný pouze pro označení chybějících dat.
create table if not exists public.complete_power_outage_cez_projection_runs (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.complete_power_outage_cez_scan_cycles(id) on delete restrict,
  status text not null default 'building',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  observed_outage_count integer not null default 0,
  upserted_outage_count integer not null default 0,
  refreshed_outage_count integer not null default 0,
  projected_address_count integer not null default 0,
  exact_address_count integer not null default 0,
  broad_address_count integer not null default 0,
  review_address_count integer not null default 0,
  pending_normalization_count integer not null default 0,
  missing_outage_count integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_cez_projection_runs_status_check
    check (status in ('building', 'partial_ready', 'ready', 'failed')),
  constraint cpo_cez_projection_runs_counts_check check (
    observed_outage_count >= 0 and upserted_outage_count >= 0
    and refreshed_outage_count >= 0 and projected_address_count >= 0
    and exact_address_count >= 0 and broad_address_count >= 0
    and review_address_count >= 0 and pending_normalization_count >= 0
    and missing_outage_count >= 0
  ),
  constraint cpo_cez_projection_runs_period_check check (
    (status = 'building' and finished_at is null)
    or (status <> 'building' and finished_at is not null)
  ),
  constraint cpo_cez_projection_runs_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_cez_projection_runs_timeline_idx
  on public.complete_power_outage_cez_projection_runs (started_at desc);

-- Průběžný stínový katalog. Není napojený na uživatelské tabulky KOMPLETNÍ.
create table if not exists public.complete_power_outage_cez_projection_outages (
  external_id text primary key,
  source_status text not null,
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
  last_seen_cycle_id uuid not null references public.complete_power_outage_cez_scan_cycles(id) on delete restrict,
  addresses_projected_cycle_id uuid
    references public.complete_power_outage_cez_scan_cycles(id) on delete restrict,
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_cez_projection_outages_status_check
    check (source_status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint cpo_cez_projection_outages_period_check check (ends_at > starts_at and archive_at = ends_at),
  constraint cpo_cez_projection_outages_hash_check check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_projection_outages_seen_check check (last_seen_at >= first_seen_at),
  constraint cpo_cez_projection_outages_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_cez_projection_outages_timeline_idx
  on public.complete_power_outage_cez_projection_outages (archive_at, starts_at, external_id);

create table if not exists public.complete_power_outage_cez_projection_addresses (
  id uuid primary key default gen_random_uuid(),
  outage_external_id text not null
    references public.complete_power_outage_cez_projection_outages(external_id) on delete cascade,
  -- Auditní kopie bez FK: hotová projekce nesmí blokovat čištění stagingu.
  source_address_id uuid not null,
  address_key text not null,
  address_scope text not null,
  validation_status text not null,
  ruian_address_id bigint,
  ruian_building_type text,
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
  query_text text not null,
  last_seen_cycle_id uuid not null references public.complete_power_outage_cez_scan_cycles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_cez_projection_addresses_scope_check
    check (address_scope in ('exact', 'street', 'municipality')),
  constraint cpo_cez_projection_addresses_validation_check
    check (validation_status in ('verified', 'fallback', 'needs_review')),
  constraint cpo_cez_projection_addresses_ruian_check check (
    (address_scope = 'exact' and validation_status = 'verified' and ruian_address_id > 0)
    or (address_scope <> 'exact' and validation_status in ('fallback', 'needs_review'))
  ),
  constraint cpo_cez_projection_addresses_key_check check (address_key ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_projection_addresses_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_cez_projection_addresses_unique unique (outage_external_id, address_key)
);

create index if not exists cpo_cez_projection_addresses_outage_idx
  on public.complete_power_outage_cez_projection_addresses (outage_external_id);
create index if not exists cpo_cez_projection_addresses_ruian_idx
  on public.complete_power_outage_cez_projection_addresses (ruian_address_id)
  where ruian_address_id is not null;

-- Samostatný budoucí krok vytvoří vratné přepnutí; tato migrace ho neumí.
create table if not exists public.complete_power_outage_cez_projection_state (
  singleton boolean primary key default true check (singleton),
  active_source text not null default 'legacy',
  latest_applied_cycle_id uuid references public.complete_power_outage_cez_scan_cycles(id) on delete set null,
  latest_complete_cycle_id uuid references public.complete_power_outage_cez_scan_cycles(id) on delete set null,
  last_projection_at timestamptz,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_cez_projection_state_source_check check (active_source in ('legacy', 'shadow')),
  constraint cpo_cez_projection_state_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_cez_projection_state (singleton, active_source)
values (true, 'legacy') on conflict (singleton) do nothing;
update public.complete_power_outage_cez_projection_state
set active_source = 'legacy', updated_at = now() where singleton;

alter table public.complete_power_outage_cez_projection_runs enable row level security;
alter table public.complete_power_outage_cez_projection_outages enable row level security;
alter table public.complete_power_outage_cez_projection_addresses enable row level security;
alter table public.complete_power_outage_cez_projection_state enable row level security;

drop policy if exists cpo_cez_projection_runs_authorized_read on public.complete_power_outage_cez_projection_runs;
create policy cpo_cez_projection_runs_authorized_read on public.complete_power_outage_cez_projection_runs
  for select to authenticated using (public.current_user_can_view_power_outages());
drop policy if exists cpo_cez_projection_outages_authorized_read on public.complete_power_outage_cez_projection_outages;
create policy cpo_cez_projection_outages_authorized_read on public.complete_power_outage_cez_projection_outages
  for select to authenticated using (public.current_user_can_view_power_outages());
drop policy if exists cpo_cez_projection_addresses_authorized_read on public.complete_power_outage_cez_projection_addresses;
create policy cpo_cez_projection_addresses_authorized_read on public.complete_power_outage_cez_projection_addresses
  for select to authenticated using (public.current_user_can_view_power_outages());
drop policy if exists cpo_cez_projection_state_authorized_read on public.complete_power_outage_cez_projection_state;
create policy cpo_cez_projection_state_authorized_read on public.complete_power_outage_cez_projection_state
  for select to authenticated using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_projection_runs from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_projection_outages from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_projection_addresses from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_projection_state from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_projection_runs to authenticated;
grant select on table public.complete_power_outage_cez_projection_outages to authenticated;
grant select on table public.complete_power_outage_cez_projection_addresses to authenticated;
grant select on table public.complete_power_outage_cez_projection_state to authenticated;
grant all on table public.complete_power_outage_cez_projection_runs to service_role;
grant all on table public.complete_power_outage_cez_projection_outages to service_role;
grant all on table public.complete_power_outage_cez_projection_addresses to service_role;
grant all on table public.complete_power_outage_cez_projection_state to service_role;

create or replace function public.build_complete_power_outage_cez_shadow_projection()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected_cycle public.complete_power_outage_cez_scan_cycles%rowtype;
  projection_run_id uuid;
  observed_count integer := 0;
  upserted_count integer := 0;
  refreshable_count integer := 0;
  built_address_count integer := 0;
  built_exact_count integer := 0;
  built_broad_count integer := 0;
  built_review_count integer := 0;
  pending_count integer := 0;
  missing_count integer := 0;
  final_status text;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('complete_power_outage_cez_shadow_projection', 0)) then
    return jsonb_build_object('ok', true, 'status', 'busy');
  end if;

  select cycle.* into selected_cycle
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot and cycle.snapshot_contract_version = 2
    and cycle.status in ('running', 'succeeded', 'no_change')
    and exists (select 1 from public.complete_power_outage_cez_cycle_outages member
      where member.cycle_id = cycle.id)
  order by cycle.started_at desc, cycle.id desc limit 1;

  if selected_cycle.id is null then
    return jsonb_build_object('ok', true, 'status', 'blocked', 'reason', 'no_cycle_data');
  end if;

  insert into public.complete_power_outage_cez_projection_runs (cycle_id, metadata)
  values (selected_cycle.id, jsonb_build_object(
    'cycleStatus', selected_cycle.status, 'snapshotStatus', selected_cycle.snapshot_status,
    'snapshotPublishable', selected_cycle.snapshot_publishable,
    'source', 'complete_cez_nationwide_v1')) returning id into projection_run_id;

  begin
    select count(*)::integer into observed_count
    from public.complete_power_outage_cez_cycle_outages where cycle_id = selected_cycle.id;

    insert into public.complete_power_outage_cez_projection_outages (
      external_id, source_status, title, description, starts_at, ends_at,
      archive_at, municipality, municipality_code, district, region,
      source_url, announcement_url, payload_sha256, source_updated_at,
      first_seen_at, last_seen_at, last_seen_cycle_id, missing_since, metadata, updated_at)
    select member.outage_external_id, member.source_status,
      member.outage_payload->>'title', member.outage_payload->>'description',
      member.starts_at, member.ends_at, member.ends_at,
      member.outage_payload->>'municipality', member.outage_payload->>'municipality_code',
      member.outage_payload->>'district', member.outage_payload->>'region',
      member.outage_payload->>'source_url', member.outage_payload->>'announcement_url',
      member.payload_sha256, nullif(member.outage_payload->>'source_updated_at', '')::timestamptz,
      member.observed_at, member.observed_at, selected_cycle.id, null,
      coalesce(member.outage_payload->'metadata', '{}'::jsonb)
        || jsonb_build_object('completeCezSnapshotCycleId', selected_cycle.id), now()
    from public.complete_power_outage_cez_cycle_outages member
    where member.cycle_id = selected_cycle.id
    on conflict (external_id) do update set
      source_status = excluded.source_status, title = excluded.title,
      description = excluded.description, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at, archive_at = excluded.archive_at,
      municipality = excluded.municipality, municipality_code = excluded.municipality_code,
      district = excluded.district, region = excluded.region,
      source_url = excluded.source_url, announcement_url = excluded.announcement_url,
      payload_sha256 = excluded.payload_sha256, source_updated_at = excluded.source_updated_at,
      last_seen_at = excluded.last_seen_at, last_seen_cycle_id = excluded.last_seen_cycle_id,
      missing_since = null, metadata = excluded.metadata, updated_at = now();
    get diagnostics upserted_count = row_count;

    create temporary table if not exists pg_temp.cpo_cez_projection_refreshable_outages
      (external_id text primary key) on commit drop;
    truncate table pg_temp.cpo_cez_projection_refreshable_outages;
    insert into pg_temp.cpo_cez_projection_refreshable_outages (external_id)
    select member.outage_external_id
    from public.complete_power_outage_cez_cycle_outages member
    left join public.complete_power_outage_cez_staged_addresses address
      on address.outage_external_id = member.outage_external_id
    left join public.complete_power_outage_cez_staged_outages staged_outage
      on staged_outage.external_id = member.outage_external_id
    join public.complete_power_outage_cez_projection_outages projected_outage
      on projected_outage.external_id = member.outage_external_id
    where member.cycle_id = selected_cycle.id
      and staged_outage.last_seen_cycle_id = selected_cycle.id
      and projected_outage.addresses_projected_cycle_id is distinct from selected_cycle.id
    group by member.outage_external_id, member.address_count
    having count(address.id) = member.address_count
      and count(address.id) filter (where address.normalization_version >= 3
        and address.normalization_status = 'succeeded') = member.address_count
      and count(address.id) filter (where exists (
        select 1 from public.complete_power_outage_cez_staged_address_targets target
        where target.staged_address_id = address.id
          and target.validation_status in ('verified', 'fallback', 'needs_review')
          and ((target.target_kind = 'exact_number' and target.validation_status = 'verified'
              and target.ruian_address_code ~ '^[0-9]+$')
            or (target.target_kind in ('street', 'municipality')
              and target.validation_status in ('fallback', 'needs_review')))
      )) = member.address_count;
    get diagnostics refreshable_count = row_count;

    delete from public.complete_power_outage_cez_projection_addresses projected
    using pg_temp.cpo_cez_projection_refreshable_outages refreshable
    where projected.outage_external_id = refreshable.external_id;

    insert into public.complete_power_outage_cez_projection_addresses (
      outage_external_id, source_address_id, address_key, address_scope,
      validation_status, ruian_address_id, ruian_building_type, municipality,
      municipality_code, town_part, street, house_number, orientation_number,
      postal_code, raw_address, normalized_municipality, normalized_street,
      query_text, last_seen_cycle_id, metadata)
    select address.outage_external_id, address.id, target.target_key,
      case target.target_kind when 'exact_number' then 'exact'
        when 'street' then 'street' else 'municipality' end,
      target.validation_status,
      case when target.ruian_address_code ~ '^[0-9]+$'
        then target.ruian_address_code::bigint else null end,
      target.ruian_building_type, target.municipality, address.municipality_code,
      target.town_part, target.street, target.verified_house_number,
      target.verified_orientation_number, coalesce(target.postal_code, address.postal_code),
      address.raw_address, address.normalized_municipality, address.normalized_street,
      target.query_text, selected_cycle.id,
      target.metadata || jsonb_build_object('sourceAddressKey', address.address_key,
        'sourceValidationVersion', target.validation_version)
    from public.complete_power_outage_cez_staged_addresses address
    join pg_temp.cpo_cez_projection_refreshable_outages refreshable
      on refreshable.external_id = address.outage_external_id
    join public.complete_power_outage_cez_staged_address_targets target
      on target.staged_address_id = address.id
    where target.validation_status in ('verified', 'fallback', 'needs_review')
      and ((target.target_kind = 'exact_number' and target.validation_status = 'verified'
          and target.ruian_address_code ~ '^[0-9]+$')
        or (target.target_kind in ('street', 'municipality')
          and target.validation_status in ('fallback', 'needs_review')));
    get diagnostics built_address_count = row_count;

    update public.complete_power_outage_cez_projection_outages outage
    set addresses_projected_cycle_id = selected_cycle.id, updated_at = now()
    from pg_temp.cpo_cez_projection_refreshable_outages refreshable
    where outage.external_id = refreshable.external_id;

    select count(*)::integer into pending_count
    from public.complete_power_outage_cez_cycle_outages member
    join public.complete_power_outage_cez_projection_outages outage
      on outage.external_id = member.outage_external_id
    where member.cycle_id = selected_cycle.id
      and outage.addresses_projected_cycle_id is distinct from selected_cycle.id;

    select count(*) filter (where address_scope = 'exact')::integer,
      count(*) filter (where address_scope <> 'exact')::integer,
      count(*) filter (where validation_status = 'needs_review')::integer
    into built_exact_count, built_broad_count, built_review_count
    from public.complete_power_outage_cez_projection_addresses
    where last_seen_cycle_id = selected_cycle.id;

    -- Jen kompletní snapshot smí označit dřívější budoucí data jako chybějící.
    if selected_cycle.status in ('succeeded', 'no_change') and selected_cycle.snapshot_status = 'complete'
      and selected_cycle.snapshot_publishable then
      update public.complete_power_outage_cez_projection_outages outage
      set missing_since = coalesce(outage.missing_since, now()),
        source_status = 'cancelled', updated_at = now()
      where outage.missing_since is null and outage.ends_at > selected_cycle.started_at
        and not exists (select 1 from public.complete_power_outage_cez_cycle_outages member
          where member.cycle_id = selected_cycle.id and member.outage_external_id = outage.external_id);
      get diagnostics missing_count = row_count;
    end if;

    -- Archiv neuchovává odkaz na PDF; samotný soubor nikdy nestahujeme.
    update public.complete_power_outage_cez_projection_outages
    set announcement_url = null, updated_at = now()
    where ends_at <= now() and announcement_url is not null;

    final_status := case when selected_cycle.snapshot_publishable and pending_count = 0
      then 'ready' else 'partial_ready' end;
    update public.complete_power_outage_cez_projection_runs
    set status = final_status, finished_at = now(),
      observed_outage_count = observed_count, upserted_outage_count = upserted_count,
      refreshed_outage_count = refreshable_count,
      projected_address_count = built_address_count,
      exact_address_count = built_exact_count, broad_address_count = built_broad_count,
      review_address_count = built_review_count,
      pending_normalization_count = pending_count, missing_outage_count = missing_count
    where id = projection_run_id;

    update public.complete_power_outage_cez_projection_state
    set latest_applied_cycle_id = selected_cycle.id,
      latest_complete_cycle_id = case when selected_cycle.snapshot_publishable
        then selected_cycle.id else latest_complete_cycle_id end,
      last_projection_at = now(), updated_at = now(),
      metadata = jsonb_build_object('lastProjectionRunId', projection_run_id,
        'lastProjectionStatus', final_status, 'activationRequired', true)
    where singleton;
  exception when others then
    update public.complete_power_outage_cez_projection_runs
    set status = 'failed', finished_at = now(), observed_outage_count = observed_count,
      upserted_outage_count = upserted_count, refreshed_outage_count = refreshable_count,
      projected_address_count = built_address_count,
      pending_normalization_count = pending_count,
      error_code = 'CEZ_SHADOW_PROJECTION_FAILED', error_message = sqlerrm
    where id = projection_run_id;
    return jsonb_build_object('ok', false, 'status', 'failed',
      'cycleId', selected_cycle.id, 'runId', projection_run_id, 'error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'status', final_status,
    'cycleId', selected_cycle.id, 'runId', projection_run_id,
    'activeSource', 'legacy', 'observedOutageCount', observed_count,
    'upsertedOutageCount', upserted_count, 'refreshedOutageCount', refreshable_count,
    'projectedAddressCount', built_address_count,
    'pendingNormalizationCount', pending_count, 'missingOutageCount', missing_count);
end;
$$;

revoke all on function public.build_complete_power_outage_cez_shadow_projection()
  from public, anon, authenticated;
grant execute on function public.build_complete_power_outage_cez_shadow_projection() to service_role;

create or replace view public.complete_power_outage_cez_shadow_outages
with (security_invoker = true) as select * from public.complete_power_outage_cez_projection_outages;
create or replace view public.complete_power_outage_cez_shadow_addresses
with (security_invoker = true) as select * from public.complete_power_outage_cez_projection_addresses;
revoke all on table public.complete_power_outage_cez_shadow_outages from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_shadow_addresses from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_shadow_outages to authenticated;
grant select on table public.complete_power_outage_cez_shadow_addresses to authenticated;

comment on table public.complete_power_outage_cez_projection_outages is
  'Průběžný stínový ČEZ katalog pro KOMPLETNÍ; nové obce se přidávají ihned, chybějící data se označí až po úplném cyklu.';
comment on table public.complete_power_outage_cez_projection_state is
  'Stav stínové projekce. active_source zůstává legacy do samostatného řízeného přepnutí.';

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_cez_shadow_projection_every_five_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  -- Po skenu v minutě 1/6/... a normalizaci v minutě 2/7/... se nové hotové
  -- adresy promítnou do stínového katalogu v minutě 3/8/...
  perform cron.schedule(
    'complete_cez_shadow_projection_every_five_minutes',
    '3-59/5 * * * *',
    $job$select public.build_complete_power_outage_cez_shadow_projection();$job$
  );
end
$$;

commit;
