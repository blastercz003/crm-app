begin;

do $$
begin
  if to_regclass('public.power_outage_store_matches') is null
    or to_regclass('public.power_outage_cez_market_cycles') is null
    or to_regclass('public.power_outage_cez_market_cycle_targets') is null
  then
    raise exception 'Chybí databázový základ ČEZ MARKETY v2.';
  end if;
end
$$;

alter table public.power_outage_store_matches
  drop constraint if exists power_outage_store_matches_method_check;
alter table public.power_outage_store_matches
  add constraint power_outage_store_matches_method_check
  check (match_method in ('city_street', 'cez_v2_exact', 'manual'));

create table if not exists public.power_outage_cez_market_exact_store_observations (
  outage_id uuid not null references public.power_outages(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  external_id text not null,
  ruian_address_id bigint not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_cycle_id uuid references public.power_outage_cez_market_cycles(id) on delete set null,
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (outage_id, store_id),
  constraint po_cez_market_exact_store_external_check check (btrim(external_id) <> ''),
  constraint po_cez_market_exact_store_address_check check (ruian_address_id > 0),
  constraint po_cez_market_exact_store_seen_check check (last_seen_at >= first_seen_at),
  constraint po_cez_market_exact_store_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists po_cez_market_exact_store_cycle_idx
  on public.power_outage_cez_market_exact_store_observations (last_cycle_id, missing_since);

drop trigger if exists po_cez_market_exact_store_set_updated_at
  on public.power_outage_cez_market_exact_store_observations;
create trigger po_cez_market_exact_store_set_updated_at
before update on public.power_outage_cez_market_exact_store_observations
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_cez_market_exact_store_observations enable row level security;
drop policy if exists po_cez_market_exact_store_authorized_read
  on public.power_outage_cez_market_exact_store_observations;
create policy po_cez_market_exact_store_authorized_read
  on public.power_outage_cez_market_exact_store_observations
  for select to authenticated
  using (public.current_user_can_view_power_outages());
revoke all on table public.power_outage_cez_market_exact_store_observations
  from public, anon, authenticated;
grant select on table public.power_outage_cez_market_exact_store_observations to authenticated;
grant all on table public.power_outage_cez_market_exact_store_observations to service_role;

create or replace function public.record_power_outage_cez_market_exact_store_match(
  requested_target_id uuid,
  requested_external_id text,
  requested_outage_id uuid,
  requested_store_id uuid,
  requested_observed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_record record;
  store_record record;
  existing_match record;
  current_revision bigint;
  resulting_match_id uuid;
  result_action text := 'refreshed';
  result_changed boolean := false;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Přesnou shodu ČEZ MARKETY v2 může uložit pouze service role.';
  end if;
  if requested_observed_at is null then
    raise exception 'Chybí čas přesného pozorování ČEZ v2.';
  end if;

  select target.cycle_id, target.address_id
  into target_record
  from public.power_outage_cez_market_cycle_targets target
  where target.id = requested_target_id
    and target.collector_version = 'v2'
    and target.status = 'running'
    and target.store_ids ? requested_store_id::text;
  if target_record.cycle_id is null then
    raise exception 'Cíl ČEZ v2 neobsahuje požadovanou prodejnu nebo již neběží.';
  end if;

  if not exists (
    select 1 from public.power_outages outage
    where outage.id = requested_outage_id
      and outage.source = 'cez'
      and outage.external_id = requested_external_id
  ) then
    raise exception 'Přesná shoda neodpovídá uložené odstávce ČEZ.';
  end if;

  select store.id, store.chain_name, store.store_number, store.city, store.address
  into store_record
  from public.stores store
  where store.id = requested_store_id;
  if store_record.id is null then
    raise exception 'Prodejna přesné shody ČEZ v2 již neexistuje.';
  end if;

  select revision into current_revision
  from public.power_outage_store_catalog_state where singleton;
  if current_revision is null then
    raise exception 'Revize katalogu prodejen není dostupná.';
  end if;

  insert into public.power_outage_cez_market_exact_store_observations (
    outage_id, store_id, external_id, ruian_address_id,
    first_seen_at, last_seen_at, last_cycle_id, missing_since, metadata
  ) values (
    requested_outage_id, requested_store_id, requested_external_id,
    target_record.address_id, requested_observed_at, requested_observed_at,
    target_record.cycle_id, null,
    jsonb_build_object(
      'contract', 'cez-market-v2-exact-store-observation-v1',
      'collectorVersion', 'v2'
    )
  )
  on conflict (outage_id, store_id) do update
  set external_id = excluded.external_id,
      ruian_address_id = excluded.ruian_address_id,
      last_seen_at = greatest(
        public.power_outage_cez_market_exact_store_observations.last_seen_at,
        excluded.last_seen_at
      ),
      last_cycle_id = excluded.last_cycle_id,
      missing_since = null,
      metadata = public.power_outage_cez_market_exact_store_observations.metadata
        || excluded.metadata;

  select match.id, match.match_method, match.match_status, match.resolved_at,
    exists (
      select 1 from public.power_outage_match_audit audit where audit.match_id = match.id
    ) as has_manual_audit
  into existing_match
  from public.power_outage_store_matches match
  where match.outage_id = requested_outage_id
    and match.store_id = requested_store_id
  for update;

  if existing_match.id is null then
    insert into public.power_outage_store_matches (
      outage_id, outage_address_id, store_id, match_status, match_method,
      confidence, match_reasons, store_chain_name, store_number, store_city,
      store_address, store_revision, last_verified_at, resolved_at, resolved_by
    ) values (
      requested_outage_id, null, requested_store_id, 'confirmed', 'cez_v2_exact',
      1, jsonb_build_array(jsonb_build_object(
        'code', 'cez_v2_exact_ruian_address',
        'ruianAddressId', target_record.address_id,
        'collectorVersion', 'v2'
      )),
      store_record.chain_name, store_record.store_number, store_record.city,
      store_record.address, current_revision, requested_observed_at, null, null
    )
    on conflict (outage_id, store_id) where store_id is not null do nothing
    returning id into resulting_match_id;
    if resulting_match_id is null then
      -- Souběžný bezpečný worker mohl stejnou dvojici vložit mezi SELECT a INSERT.
      select match.id into resulting_match_id
      from public.power_outage_store_matches match
      where match.outage_id = requested_outage_id
        and match.store_id = requested_store_id;
      result_action := 'concurrent_preserved';
    else
      result_action := 'inserted';
      result_changed := true;
    end if;
  elsif existing_match.match_method = 'manual'
    or existing_match.resolved_at is not null
    or existing_match.has_manual_audit
  then
    resulting_match_id := existing_match.id;
    result_action := 'manual_preserved';
  else
    update public.power_outage_store_matches match
    set outage_address_id = null,
        match_status = 'confirmed',
        match_method = 'cez_v2_exact',
        confidence = 1,
        match_reasons = jsonb_build_array(jsonb_build_object(
          'code', 'cez_v2_exact_ruian_address',
          'ruianAddressId', target_record.address_id,
          'collectorVersion', 'v2'
        )),
        store_chain_name = store_record.chain_name,
        store_number = store_record.store_number,
        store_city = store_record.city,
        store_address = store_record.address,
        store_revision = current_revision,
        last_verified_at = requested_observed_at,
        resolved_at = null,
        resolved_by = null,
        updated_at = now()
    where match.id = existing_match.id
    returning match.id into resulting_match_id;
    result_action := case
      when existing_match.match_method = 'cez_v2_exact' then 'refreshed'
      else 'upgraded'
    end;
    result_changed := existing_match.match_method <> 'cez_v2_exact'
      or existing_match.match_status <> 'confirmed';
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', result_action,
    'changed', result_changed,
    'matchId', resulting_match_id,
    'outageId', requested_outage_id,
    'storeId', requested_store_id
  );
end;
$$;

create or replace function public.reconcile_power_outage_cez_market_exact_store_matches(
  requested_cycle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cycle_record record;
  restored_count integer := 0;
  marked_missing_count integer := 0;
  removed_count integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Životní cyklus přesných shod ČEZ v2 může řídit pouze service role.';
  end if;

  select cycle.id, cycle.started_at, cycle.finished_at
  into cycle_record
  from public.power_outage_cez_market_cycles cycle
  where cycle.id = requested_cycle_id
    and cycle.collector_version = 'v2'
    and cycle.status = 'succeeded'
    and cycle.is_complete_snapshot;
  if cycle_record.id is null then
    return jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'cycle_not_complete',
      'restoredCount', 0, 'markedMissingCount', 0, 'removedCount', 0
    );
  end if;

  update public.power_outage_cez_market_exact_store_observations observation
  set missing_since = null
  where observation.last_cycle_id = requested_cycle_id
    and observation.missing_since is not null;
  get diagnostics restored_count = row_count;

  update public.power_outage_cez_market_exact_store_observations observation
  set missing_since = coalesce(observation.missing_since, cycle_record.finished_at)
  where observation.last_cycle_id is distinct from requested_cycle_id
    and observation.missing_since is null;
  get diagnostics marked_missing_count = row_count;

  -- Mazání nastane až při druhém úplném cyklu bez stejného přesného důkazu.
  -- Ručně vyřešené shody zůstávají vždy zachované.
  delete from public.power_outage_store_matches match
  using public.power_outage_cez_market_exact_store_observations observation
  where match.outage_id = observation.outage_id
    and match.store_id = observation.store_id
    and match.match_method = 'cez_v2_exact'
    and match.resolved_at is null
    and observation.last_cycle_id is distinct from requested_cycle_id
    and observation.missing_since is not null
    and observation.missing_since < cycle_record.started_at
    and not exists (
      select 1 from public.power_outage_match_audit audit where audit.match_id = match.id
    );
  get diagnostics removed_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'skipped', false,
    'restoredCount', restored_count,
    'markedMissingCount', marked_missing_count,
    'removedCount', removed_count,
    'cycleId', requested_cycle_id
  );
end;
$$;

create or replace function public.update_power_outage_cez_market_exact_store_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.collector_version = 'v2'
    and new.status = 'succeeded'
    and new.is_complete_snapshot
    and old.status is distinct from 'succeeded'
  then
    perform public.reconcile_power_outage_cez_market_exact_store_matches(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists po_cez_market_v2_exact_store_lifecycle
  on public.power_outage_cez_market_cycles;
create trigger po_cez_market_v2_exact_store_lifecycle
after update on public.power_outage_cez_market_cycles
for each row execute function public.update_power_outage_cez_market_exact_store_lifecycle();

revoke all on function public.record_power_outage_cez_market_exact_store_match(
  uuid, text, uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.reconcile_power_outage_cez_market_exact_store_matches(uuid)
  from public, anon, authenticated;
revoke all on function public.update_power_outage_cez_market_exact_store_lifecycle()
  from public, anon, authenticated;
grant execute on function public.record_power_outage_cez_market_exact_store_match(
  uuid, text, uuid, uuid, timestamptz
) to service_role;
grant execute on function public.reconcile_power_outage_cez_market_exact_store_matches(uuid)
  to service_role;

-- Bezpečný backfill vychází výhradně z posledního úplného produkčního cyklu v2.
with latest_cycle as (
  select cycle.id
  from public.power_outage_cez_market_cycles cycle
  where cycle.collector_version = 'v2'
    and cycle.status = 'succeeded'
    and cycle.is_complete_snapshot
  order by cycle.finished_at desc
  limit 1
), exact_pairs as (
  select distinct outage.id as outage_id, store.id as store_id,
    outage.external_id, target.address_id as ruian_address_id,
    target.cycle_id, coalesce(target.finished_at, now()) as observed_at
  from latest_cycle
  join public.power_outage_cez_market_cycle_targets target
    on target.cycle_id = latest_cycle.id and target.status = 'succeeded'
  cross join lateral jsonb_array_elements_text(target.store_ids) store_item(store_id)
  cross join lateral jsonb_array_elements_text(target.exact_outage_ids) outage_item(external_id)
  join public.stores store on store.id = store_item.store_id::uuid
  join public.power_outages outage
    on outage.source = 'cez' and outage.external_id = outage_item.external_id
)
insert into public.power_outage_cez_market_exact_store_observations (
  outage_id, store_id, external_id, ruian_address_id,
  first_seen_at, last_seen_at, last_cycle_id, missing_since, metadata
)
select outage_id, store_id, external_id, ruian_address_id,
  observed_at, observed_at, cycle_id, null,
  jsonb_build_object(
    'contract', 'cez-market-v2-exact-store-observation-v1',
    'collectorVersion', 'v2',
    'backfilledFromCompleteCycle', true
  )
from exact_pairs
on conflict (outage_id, store_id) do update
set external_id = excluded.external_id,
    ruian_address_id = excluded.ruian_address_id,
    last_seen_at = greatest(
      public.power_outage_cez_market_exact_store_observations.last_seen_at,
      excluded.last_seen_at
    ),
    last_cycle_id = excluded.last_cycle_id,
    missing_since = null,
    metadata = public.power_outage_cez_market_exact_store_observations.metadata
      || excluded.metadata;

with exact_pairs as (
  select observation.outage_id, observation.store_id, observation.ruian_address_id,
    observation.last_seen_at, store.chain_name, store.store_number, store.city,
    store.address, catalog.revision
  from public.power_outage_cez_market_exact_store_observations observation
  join public.stores store on store.id = observation.store_id
  cross join public.power_outage_store_catalog_state catalog
  where catalog.singleton and observation.missing_since is null
)
update public.power_outage_store_matches match
set outage_address_id = null,
    match_status = 'confirmed',
    match_method = 'cez_v2_exact',
    confidence = 1,
    match_reasons = jsonb_build_array(jsonb_build_object(
      'code', 'cez_v2_exact_ruian_address',
      'ruianAddressId', exact_pairs.ruian_address_id,
      'collectorVersion', 'v2'
    )),
    store_chain_name = exact_pairs.chain_name,
    store_number = exact_pairs.store_number,
    store_city = exact_pairs.city,
    store_address = exact_pairs.address,
    store_revision = exact_pairs.revision,
    last_verified_at = exact_pairs.last_seen_at,
    updated_at = now()
from exact_pairs
where match.outage_id = exact_pairs.outage_id
  and match.store_id = exact_pairs.store_id
  and match.match_method = 'city_street'
  and match.resolved_at is null
  and not exists (
    select 1 from public.power_outage_match_audit audit where audit.match_id = match.id
  );

with exact_pairs as (
  select observation.outage_id, observation.store_id, observation.ruian_address_id,
    observation.last_seen_at, store.chain_name, store.store_number, store.city,
    store.address, catalog.revision
  from public.power_outage_cez_market_exact_store_observations observation
  join public.stores store on store.id = observation.store_id
  cross join public.power_outage_store_catalog_state catalog
  where catalog.singleton and observation.missing_since is null
)
insert into public.power_outage_store_matches (
  outage_id, outage_address_id, store_id, match_status, match_method,
  confidence, match_reasons, store_chain_name, store_number, store_city,
  store_address, store_revision, last_verified_at, resolved_at, resolved_by
)
select exact_pairs.outage_id, null, exact_pairs.store_id, 'confirmed', 'cez_v2_exact',
  1, jsonb_build_array(jsonb_build_object(
    'code', 'cez_v2_exact_ruian_address',
    'ruianAddressId', exact_pairs.ruian_address_id,
    'collectorVersion', 'v2'
  )), exact_pairs.chain_name, exact_pairs.store_number, exact_pairs.city,
  exact_pairs.address, exact_pairs.revision, exact_pairs.last_seen_at, null, null
from exact_pairs
where not exists (
  select 1 from public.power_outage_store_matches match
  where match.outage_id = exact_pairs.outage_id
    and match.store_id = exact_pairs.store_id
)
on conflict (outage_id, store_id) where store_id is not null do nothing;

select public.reconcile_power_outage_job_links();

notify pgrst, 'reload schema';
commit;

select 'CONSTRAINT' as check_type, 'authoritative CEZ v2 match method' as object_name,
  pg_get_constraintdef(constraint_row.oid) like '%cez_v2_exact%' as is_correct
from pg_constraint constraint_row
where constraint_row.conname = 'power_outage_store_matches_method_check'
  and constraint_row.conrelid = 'public.power_outage_store_matches'::regclass
union all
select 'TABLE', 'CEZ v2 exact store observations',
  to_regclass('public.power_outage_cez_market_exact_store_observations') is not null
union all
select 'FUNCTION', 'record authoritative CEZ v2 store match',
  to_regprocedure('public.record_power_outage_cez_market_exact_store_match(uuid,text,uuid,uuid,timestamptz)') is not null
union all
select 'FUNCTION', 'reconcile authoritative CEZ v2 store matches',
  to_regprocedure('public.reconcile_power_outage_cez_market_exact_store_matches(uuid)') is not null
union all
select 'GRANT', 'authenticated cannot mutate authoritative CEZ v2 matches',
  not has_function_privilege(
    'authenticated',
    'public.record_power_outage_cez_market_exact_store_match(uuid,text,uuid,uuid,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.reconcile_power_outage_cez_market_exact_store_matches(uuid)',
    'execute'
  )
union all
select 'TRIGGER', 'complete CEZ v2 cycle updates authoritative matches', exists (
  select 1 from pg_trigger
  where tgname = 'po_cez_market_v2_exact_store_lifecycle' and not tgisinternal
)
union all
select 'SAFETY', 'authoritative matches use distinct cleanup-safe method',
  pg_get_constraintdef(constraint_row.oid) like '%cez_v2_exact%'
from pg_constraint constraint_row
where constraint_row.conname = 'power_outage_store_matches_method_check'
  and constraint_row.conrelid = 'public.power_outage_store_matches'::regclass
union all
select 'SAFETY', 'manual decisions remain outside authoritative overwrite',
  pg_get_functiondef(
    'public.record_power_outage_cez_market_exact_store_match(uuid,text,uuid,uuid,timestamptz)'::regprocedure
  ) like '%has_manual_audit%'
union all
select 'SAFETY', 'authoritative removal requires second complete cycle',
  pg_get_functiondef(
    'public.reconcile_power_outage_cez_market_exact_store_matches(uuid)'::regprocedure
  ) like '%observation.missing_since < cycle_record.started_at%'
union all
select 'DATA', 'PENNY Ricany exact match restored', exists (
  select 1
  from public.power_outage_store_matches match
  join public.power_outages outage on outage.id = match.outage_id
  where outage.source = 'cez'
    and outage.external_id = '110061101274'
    and match.store_chain_name = 'PENNY MARKET'
    and match.store_number = '501100'
    and match.match_method = 'cez_v2_exact'
    and match.match_status = 'confirmed'
)
union all
select 'DATA', 'PENNY Ricany job link restored', exists (
  select 1
  from public.power_outage_job_links link
  join public.power_outage_store_matches match on match.id = link.match_id
  join public.power_outages outage on outage.id = match.outage_id
  where outage.source = 'cez'
    and outage.external_id = '110061101274'
    and match.store_number = '501100'
    and link.job_number = 'H628'
)
union all
select 'RLS', 'CEZ v2 exact store observations has RLS', coalesce((
  select relrowsecurity from pg_class
  where oid = 'public.power_outage_cez_market_exact_store_observations'::regclass
), false)
union all
select 'ISOLATION', 'authoritative CEZ v2 matches stay in MARKET scope',
  pg_get_functiondef(
    'public.record_power_outage_cez_market_exact_store_match(uuid,text,uuid,uuid,timestamptz)'::regprocedure
  ) not ilike '%complete_power_outage%'
order by check_type, object_name;
