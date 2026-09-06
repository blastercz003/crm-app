begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_cycles') is null
    or to_regclass('public.power_outage_cez_market_cycle_targets') is null
    or to_regclass('public.power_outage_cez_market_observations') is null
    or to_regclass('public.power_outage_cez_market_address_observations') is null
    or to_regclass('public.power_outage_store_registry') is null
  then
    raise exception 'Nejdříve spusťte power-outages-market-cez-dual-foundation.sql.';
  end if;
end
$$;

create or replace function public.request_power_outage_cez_market_v2_cycle(
  requested_trigger_kind text default 'scheduled'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_cycle_id uuid;
  current_revision bigint := 0;
  current_mode text;
  is_ready boolean := false;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cyklus ČEZ MARKETY v2 může založit pouze service role.';
  end if;
  if requested_trigger_kind not in ('scheduled', 'manual', 'continuation', 'verification', 'retry') then
    raise exception 'Neplatný typ spuštění cyklu ČEZ MARKETY v2.';
  end if;

  select operating_mode, activation_ready
  into current_mode, is_ready
  from public.power_outage_cez_market_collector_state
  where singleton
  for share;

  -- Bezpečné pořadí nasazení: endpoint může být nasazen před aktivací.
  if current_mode not in ('dual', 'v2_only') or not coalesce(is_ready, false) then
    return null;
  end if;

  if not pg_try_advisory_xact_lock(hashtextextended('power_outage_cez_market_v2_cycle', 0)) then
    select cycle.id into new_cycle_id
    from public.power_outage_cez_market_cycles cycle
    where cycle.collector_version = 'v2'
      and cycle.status in ('pending', 'running')
    order by cycle.created_at desc
    limit 1;
    return new_cycle_id;
  end if;

  select cycle.id into new_cycle_id
  from public.power_outage_cez_market_cycles cycle
  where cycle.collector_version = 'v2'
    and cycle.status in ('pending', 'running')
  order by cycle.created_at desc
  limit 1
  for update;
  if new_cycle_id is not null then
    return new_cycle_id;
  end if;

  select coalesce(revision, 0) into current_revision
  from public.power_outage_store_catalog_state
  where singleton;

  insert into public.power_outage_cez_market_cycles (
    collector_version,
    trigger_kind,
    status,
    is_complete_snapshot,
    catalog_revision,
    metadata
  ) values (
    'v2',
    requested_trigger_kind,
    'pending',
    false,
    current_revision,
    jsonb_build_object(
      'contract', 'cez-market-v2-production-cycle-v1',
      'selection', 'all unique active verified CEZ RUIAN addresses',
      'productionDeleteAllowed', false
    )
  ) returning id into new_cycle_id;

  insert into public.power_outage_cez_market_cycle_targets (
    cycle_id,
    collector_version,
    address_id,
    municipality,
    street,
    house_number,
    orientation_number,
    store_ids,
    metadata
  )
  select
    new_cycle_id,
    'v2',
    registry.ruian_address_id,
    min(registry.store_city),
    min(registry.store_address),
    min(registry.house_number),
    min(registry.orientation_number),
    jsonb_agg(distinct registry.store_id) filter (where registry.store_id is not null),
    jsonb_build_object(
      'storeCount', count(distinct registry.store_id),
      'catalogRevision', current_revision
    )
  from public.power_outage_store_registry registry
  where registry.is_active
    and registry.distributor = 'cez'
    and registry.verification_status = 'verified'
    and registry.needs_refresh is false
    and registry.ruian_address_id is not null
    and registry.store_id is not null
  group by registry.ruian_address_id
  order by registry.ruian_address_id;

  update public.power_outage_cez_market_cycles cycle
  set target_count = (
    select count(*)::integer
    from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = new_cycle_id
  )
  where cycle.id = new_cycle_id;

  if not exists (
    select 1 from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = new_cycle_id
  ) then
    update public.power_outage_cez_market_cycles
    set status = 'failed',
        started_at = now(),
        finished_at = now(),
        is_complete_snapshot = false,
        error_code = 'CEZ_MARKET_V2_NO_TARGETS',
        error_message = 'Pro ČEZ MARKETY v2 nebyla nalezena žádná bezpečně ověřená adresa.'
    where id = new_cycle_id;
    raise exception 'ČEZ MARKETY v2 nemá žádné bezpečně ověřené adresy.';
  end if;

  return new_cycle_id;
end;
$$;

create or replace function public.claim_power_outage_cez_market_v2_batch(
  requested_limit integer default 6
)
returns table (
  cycle_id uuid,
  target_id uuid,
  address_id bigint,
  municipality text,
  street text,
  house_number text,
  orientation_number text,
  store_ids jsonb,
  lock_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_cycle_id uuid;
  current_mode text;
  is_ready boolean := false;
  safe_limit integer := least(8, greatest(1, coalesce(requested_limit, 6)));
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Dávku ČEZ MARKETY v2 může převzít pouze service role.';
  end if;

  select operating_mode, activation_ready
  into current_mode, is_ready
  from public.power_outage_cez_market_collector_state
  where singleton;
  if current_mode not in ('dual', 'v2_only') or not coalesce(is_ready, false) then
    return;
  end if;

  update public.power_outage_cez_market_cycle_targets target
  set status = case when target.attempt_count >= 3 then 'failed' else 'pending' end,
      started_at = case when target.attempt_count >= 3 then target.started_at else null end,
      finished_at = case when target.attempt_count >= 3 then now() else null end,
      lock_token = null,
      lock_expires_at = null,
      error_code = 'CEZ_MARKET_V2_STALE_LEASE',
      error_message = 'Zámek adresního cíle ČEZ v2 vypršel.'
  where target.collector_version = 'v2'
    and target.status = 'running'
    and target.lock_expires_at < now();

  select cycle.id into active_cycle_id
  from public.power_outage_cez_market_cycles cycle
  where cycle.collector_version = 'v2'
    and cycle.status in ('pending', 'running')
  order by cycle.created_at desc
  limit 1
  for update;

  -- Pokud poslední běh skončil jen expirací posledního zámku, uzavřeme jej
  -- jako neúplný. Nikdy z něj nevznikne závěr o chybějících odstávkách.
  if active_cycle_id is not null and not exists (
    select 1
    from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = active_cycle_id
      and target.status in ('pending', 'running')
  ) then
    update public.power_outage_cez_market_cycles cycle
    set status = 'partial',
        processed_count = cycle.target_count,
        success_count = (
          select count(*)::integer
          from public.power_outage_cez_market_cycle_targets target
          where target.cycle_id = active_cycle_id and target.status = 'succeeded'
        ),
        error_count = (
          select count(*)::integer
          from public.power_outage_cez_market_cycle_targets target
          where target.cycle_id = active_cycle_id and target.status = 'failed'
        ),
        is_complete_snapshot = false,
        finished_at = now(),
        error_code = 'CEZ_MARKET_V2_STALE_TARGETS',
        error_message = 'Cyklus byl uzavřen jako neúplný po vypršení adresních zámků.'
    where cycle.id = active_cycle_id;
    active_cycle_id := null;
  end if;

  if active_cycle_id is null then
    active_cycle_id := public.request_power_outage_cez_market_v2_cycle('scheduled');
  end if;
  if active_cycle_id is null then
    return;
  end if;

  update public.power_outage_cez_market_cycles
  set status = 'running',
      started_at = coalesce(started_at, now()),
      finished_at = null,
      error_code = null,
      error_message = null
  where id = active_cycle_id
    and status = 'pending';

  return query
  with selected as (
    select target.id
    from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = active_cycle_id
      and target.status = 'pending'
    order by target.address_id
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.power_outage_cez_market_cycle_targets target
    set status = 'running',
        attempt_count = target.attempt_count + 1,
        started_at = now(),
        finished_at = null,
        lock_token = gen_random_uuid(),
        lock_expires_at = now() + interval '10 minutes',
        error_code = null,
        error_message = null
    from selected
    where target.id = selected.id
    returning target.*
  )
  select
    claimed.cycle_id,
    claimed.id,
    claimed.address_id,
    claimed.municipality,
    claimed.street,
    claimed.house_number,
    claimed.orientation_number,
    claimed.store_ids,
    claimed.lock_token
  from claimed;
end;
$$;

create or replace function public.record_power_outage_cez_market_observation(
  requested_collector_version text,
  requested_external_id text,
  requested_outage_id uuid,
  requested_cycle_id uuid,
  requested_exact boolean,
  requested_town boolean,
  requested_observed_at timestamptz,
  requested_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Pozorování ČEZ MARKETY může zapsat pouze service role.';
  end if;
  if requested_collector_version not in ('v1', 'v2') then
    raise exception 'Neplatná verze pozorování ČEZ MARKETY.';
  end if;
  if requested_metadata is null or jsonb_typeof(requested_metadata) <> 'object' then
    raise exception 'Metadata pozorování ČEZ MARKETY musí být JSON objekt.';
  end if;
  if not exists (
    select 1
    from public.power_outages outage
    where outage.id = requested_outage_id
      and outage.source = 'cez'
      and outage.external_id = requested_external_id
  ) then
    raise exception 'Pozorování neodpovídá uložené odstávce ČEZ.';
  end if;
  if requested_cycle_id is not null and not exists (
    select 1
    from public.power_outage_cez_market_cycles cycle
    where cycle.id = requested_cycle_id
      and cycle.collector_version = requested_collector_version
  ) then
    raise exception 'Pozorování neodpovídá cyklu sběrače ČEZ MARKETY.';
  end if;

  insert into public.power_outage_cez_market_observations (
    collector_version,
    external_id,
    outage_id,
    first_seen_at,
    last_seen_at,
    last_cycle_id,
    returned_for_exact_address,
    returned_for_town,
    seeded_baseline,
    missing_since,
    metadata
  ) values (
    requested_collector_version,
    requested_external_id,
    requested_outage_id,
    requested_observed_at,
    requested_observed_at,
    requested_cycle_id,
    coalesce(requested_exact, false),
    coalesce(requested_town, false),
    false,
    null,
    requested_metadata
  )
  on conflict (collector_version, external_id) do update
  set outage_id = excluded.outage_id,
      last_seen_at = greatest(
        public.power_outage_cez_market_observations.last_seen_at,
        excluded.last_seen_at
      ),
      last_cycle_id = coalesce(excluded.last_cycle_id,
        public.power_outage_cez_market_observations.last_cycle_id),
      returned_for_exact_address =
        public.power_outage_cez_market_observations.returned_for_exact_address
        or excluded.returned_for_exact_address,
      returned_for_town =
        public.power_outage_cez_market_observations.returned_for_town
        or excluded.returned_for_town,
      missing_since = null,
      metadata = public.power_outage_cez_market_observations.metadata || excluded.metadata;
end;
$$;

create or replace function public.finish_power_outage_cez_market_v2_target(
  requested_target_id uuid,
  requested_lock_token uuid,
  requested_succeeded boolean,
  requested_exact_outage_ids jsonb default '[]'::jsonb,
  requested_town_outage_ids jsonb default '[]'::jsonb,
  requested_error_code text default null,
  requested_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  active_cycle_id uuid;
  target_attempt_count integer;
  pending_count integer := 0;
  running_count integer := 0;
  succeeded_count integer := 0;
  failed_count integer := 0;
  discovered_count integer := 0;
  exact_count integer := 0;
  town_count integer := 0;
  current_revision bigint := 0;
  cycle_revision bigint := 0;
  final_status text := 'running';
  cycle_is_complete boolean := false;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Cíl ČEZ MARKETY v2 může dokončit pouze service role.';
  end if;
  if jsonb_typeof(coalesce(requested_exact_outage_ids, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(requested_town_outage_ids, '[]'::jsonb)) <> 'array'
  then
    raise exception 'Výsledky cíle ČEZ MARKETY v2 musí být JSON pole.';
  end if;

  select target.cycle_id, target.attempt_count
  into active_cycle_id, target_attempt_count
  from public.power_outage_cez_market_cycle_targets target
  where target.id = requested_target_id
    and target.collector_version = 'v2'
    and target.status = 'running'
    and target.lock_token = requested_lock_token
  for update;
  if active_cycle_id is null then
    raise exception 'Zámek cíle ČEZ MARKETY v2 již není platný.';
  end if;

  if requested_succeeded then
    update public.power_outage_cez_market_cycle_targets
    set status = 'succeeded',
        exact_outage_ids = coalesce(requested_exact_outage_ids, '[]'::jsonb),
        town_outage_ids = coalesce(requested_town_outage_ids, '[]'::jsonb),
        finished_at = now(),
        lock_token = null,
        lock_expires_at = null,
        error_code = null,
        error_message = null
    where id = requested_target_id;
  else
    update public.power_outage_cez_market_cycle_targets
    set status = case when target_attempt_count >= 3 then 'failed' else 'pending' end,
        started_at = case when target_attempt_count >= 3 then started_at else null end,
        finished_at = case when target_attempt_count >= 3 then now() else null end,
        lock_token = null,
        lock_expires_at = null,
        error_code = coalesce(nullif(btrim(requested_error_code), ''), 'CEZ_MARKET_V2_TARGET_FAILED'),
        error_message = left(coalesce(nullif(btrim(requested_error_message), ''),
          'Kontrola adresy ČEZ MARKETY v2 selhala.'), 2000)
    where id = requested_target_id;
  end if;

  select
    count(*) filter (where target.status = 'pending')::integer,
    count(*) filter (where target.status = 'running')::integer,
    count(*) filter (where target.status = 'succeeded')::integer,
    count(*) filter (where target.status = 'failed')::integer
  into pending_count, running_count, succeeded_count, failed_count
  from public.power_outage_cez_market_cycle_targets target
  where target.cycle_id = active_cycle_id;

  select
    count(distinct outage_id)::integer,
    count(distinct outage_id) filter (where evidence_kind = 'exact')::integer,
    count(distinct outage_id) filter (where evidence_kind = 'town')::integer
  into discovered_count, exact_count, town_count
  from (
    select jsonb_array_elements_text(target.exact_outage_ids) as outage_id, 'exact'::text as evidence_kind
    from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = active_cycle_id and target.status = 'succeeded'
    union all
    select jsonb_array_elements_text(target.town_outage_ids), 'town'::text
    from public.power_outage_cez_market_cycle_targets target
    where target.cycle_id = active_cycle_id and target.status = 'succeeded'
  ) evidence;

  select coalesce(revision, 0) into current_revision
  from public.power_outage_store_catalog_state where singleton;
  select catalog_revision into cycle_revision
  from public.power_outage_cez_market_cycles where id = active_cycle_id;

  if pending_count = 0 and running_count = 0 then
    cycle_is_complete := failed_count = 0 and current_revision = cycle_revision;
    final_status := case when cycle_is_complete then 'succeeded' else 'partial' end;
  end if;

  update public.power_outage_cez_market_cycles
  set status = final_status,
      processed_count = succeeded_count + failed_count,
      success_count = succeeded_count,
      error_count = failed_count,
      discovered_outage_count = discovered_count,
      exact_outage_count = exact_count,
      town_outage_count = town_count,
      is_complete_snapshot = cycle_is_complete,
      finished_at = case when final_status in ('succeeded', 'partial') then now() else null end,
      error_code = case
        when final_status = 'partial' and current_revision <> cycle_revision
          then 'CEZ_MARKET_V2_CATALOG_CHANGED'
        when final_status = 'partial' then 'CEZ_MARKET_V2_PARTIAL'
        else null
      end,
      error_message = case
        when final_status = 'partial' and current_revision <> cycle_revision
          then 'Katalog prodejen se během cyklu změnil; výsledek nelze použít jako úplný snapshot.'
        when final_status = 'partial'
          then format('%s adresních cílů skončilo po opakování chybou.', failed_count)
        else null
      end
  where id = active_cycle_id;

  if cycle_is_complete then
    update public.power_outage_cez_market_observations observation
    set last_complete_cycle_id = active_cycle_id,
        missing_since = null
    where observation.collector_version = 'v2'
      and observation.last_cycle_id = active_cycle_id;

    update public.power_outage_cez_market_observations observation
    set missing_since = coalesce(observation.missing_since, now())
    where observation.collector_version = 'v2'
      and observation.last_cycle_id is distinct from active_cycle_id
      and observation.missing_since is null;

    update public.power_outage_cez_market_address_observations observation
    set missing_since = null
    where observation.collector_version = 'v2'
      and observation.last_cycle_id = active_cycle_id;

    update public.power_outage_cez_market_address_observations observation
    set missing_since = coalesce(observation.missing_since, now())
    where observation.collector_version = 'v2'
      and observation.last_cycle_id is distinct from active_cycle_id
      and observation.missing_since is null;
  end if;

  return jsonb_build_object(
    'cycleId', active_cycle_id,
    'cycleStatus', final_status,
    'cycleComplete', cycle_is_complete,
    'pendingCount', pending_count,
    'runningCount', running_count,
    'successCount', succeeded_count,
    'errorCount', failed_count,
    'discoveredOutageCount', discovered_count
  );
end;
$$;

revoke all on function public.request_power_outage_cez_market_v2_cycle(text)
  from public, anon, authenticated;
revoke all on function public.claim_power_outage_cez_market_v2_batch(integer)
  from public, anon, authenticated;
revoke all on function public.record_power_outage_cez_market_observation(
  text, text, uuid, uuid, boolean, boolean, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.finish_power_outage_cez_market_v2_target(
  uuid, uuid, boolean, jsonb, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.request_power_outage_cez_market_v2_cycle(text)
  to service_role;
grant execute on function public.claim_power_outage_cez_market_v2_batch(integer)
  to service_role;
grant execute on function public.record_power_outage_cez_market_observation(
  text, text, uuid, uuid, boolean, boolean, timestamptz, jsonb
) to service_role;
grant execute on function public.finish_power_outage_cez_market_v2_target(
  uuid, uuid, boolean, jsonb, jsonb, text, text
) to service_role;

comment on function public.claim_power_outage_cez_market_v2_batch(integer) is
  'Bezpečně vrací malou dávku unikátních ověřených adres pouze při aktivním dual/v2 režimu.';
comment on function public.finish_power_outage_cez_market_v2_target(uuid, uuid, boolean, jsonb, jsonb, text, text) is
  'Dokončí cíl v2; neúplný cyklus nikdy neoznačí chybějící produkční data.';

commit;

select 'FUNCTION' as check_type,
  'claim CEZ MARKET v2 production batch' as object_name,
  to_regprocedure('public.claim_power_outage_cez_market_v2_batch(integer)') is not null as is_correct
union all
select 'FUNCTION', 'finish CEZ MARKET v2 production target',
  to_regprocedure('public.finish_power_outage_cez_market_v2_target(uuid,uuid,boolean,jsonb,jsonb,text,text)') is not null
union all
select 'FUNCTION', 'record versioned CEZ MARKET observation',
  to_regprocedure('public.record_power_outage_cez_market_observation(text,text,uuid,uuid,boolean,boolean,timestamptz,jsonb)') is not null
union all
select 'GRANT', 'authenticated cannot run CEZ MARKET v2 production',
  not has_function_privilege('authenticated',
    'public.request_power_outage_cez_market_v2_cycle(text)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.claim_power_outage_cez_market_v2_batch(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated',
    'public.finish_power_outage_cez_market_v2_target(uuid,uuid,boolean,jsonb,jsonb,text,text)', 'EXECUTE')
union all
select 'ISOLATION', 'CEZ MARKET v2 runtime does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(
    pg_get_functiondef('public.claim_power_outage_cez_market_v2_batch(integer)'::regprocedure)
    || pg_get_functiondef('public.finish_power_outage_cez_market_v2_target(uuid,uuid,boolean,jsonb,jsonb,text,text)'::regprocedure)
    || pg_get_functiondef('public.record_power_outage_cez_market_observation(text,text,uuid,uuid,boolean,boolean,timestamptz,jsonb)'::regprocedure)
  )) = 0
union all
select 'LOGIC', 'incomplete v2 cycle cannot become complete snapshot',
  position('failed_count = 0 and current_revision = cycle_revision' in lower(
    pg_get_functiondef('public.finish_power_outage_cez_market_v2_target(uuid,uuid,boolean,jsonb,jsonb,text,text)'::regprocedure)
  )) > 0
union all
select 'SAFETY', 'CEZ MARKET v2 runtime is inactive before activation',
  coalesce((
    select operating_mode = 'v1_only' and activation_ready is false
    from public.power_outage_cez_market_collector_state where singleton
  ), false)
union all
select 'SAFETY', 'runtime migration started no CEZ MARKET v2 cycle',
  not exists (
    select 1 from public.power_outage_cez_market_cycles
    where collector_version = 'v2'
  )
union all
select 'SAFETY', 'no CEZ MARKET v2 cron exists',
  not exists (
    select 1 from cron.job
    where active
      and (
        jobname = 'power_outage_cez_market_v2_every_three_minutes'
        or command ilike '%/api/power-outages/cez/v2?limit=%'
      )
  )
union all
select 'STATE', 'CEZ MARKET production remains v1 only',
  coalesce((
    select operating_mode = 'v1_only' and active_version = 'v1'
    from public.power_outage_cez_market_collector_state where singleton
  ), false)
order by check_type, object_name;
