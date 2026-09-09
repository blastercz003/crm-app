-- Nasadit až po aplikační změně complete-catalog-sync.ts. První následující
-- běh publisheru pak bezpečně opraví historicky neúplný produkční katalog.
begin;

do $$
begin
  if to_regprocedure('public.build_complete_power_outage_cez_shadow_projection()') is null
    or to_regprocedure('public.request_power_outages_endpoint(text)') is null
    or to_regclass('public.complete_power_outage_cez_projection_state') is null
    or to_regclass('public.complete_power_outage_cez_scan_cycles') is null
    or to_regclass('public.complete_power_outage_cez_cycle_outages') is null
    or to_regclass('public.complete_power_outage_cez_projection_outages') is null
    or to_regclass('public.complete_power_outage_cez_projection_addresses') is null
    or to_regclass('public.complete_power_outage_source_state') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regclass('public.complete_power_outage_addresses') is null
  then
    raise exception 'Chybi zavislosti pro kontrolu uplnosti publikace CEZ ALL v1.';
  end if;
end
$$;

-- Stejný dokončený cyklus se považuje za publikovaný pouze tehdy, když se
-- jeho stínové adresy skutečně nacházejí v produkčním katalogu. Kontrola tak
-- opraví i historicky neúplnou publikaci způsobenou limitem jedné API stránky.
create or replace function public.advance_complete_power_outage_cez_projection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  projection_result jsonb := '{}'::jsonb;
  source_mode text;
  candidate_cycle_id uuid;
  candidate_cycle_status text;
  applied_cycle_id uuid;
  complete_cycle_id uuid;
  projection_status text;
  published_cycle_id uuid;
  state_published_address_count bigint := 0;
  projected_address_count bigint := 0;
  production_address_count bigint := 0;
  missing_address_count bigint := 0;
  extra_address_count bigint := 0;
  address_integrity_ok boolean := false;
  publish_request_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_publisher')
  );

  select cycle.id, cycle.status
  into candidate_cycle_id, candidate_cycle_status
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot
    and cycle.snapshot_contract_version = 2
    and cycle.status in ('running', 'succeeded', 'no_change')
    and exists (
      select 1
      from public.complete_power_outage_cez_cycle_outages member
      where member.cycle_id = cycle.id
    )
  order by cycle.started_at desc, cycle.id desc
  limit 1;

  select
    state.active_source,
    state.latest_applied_cycle_id,
    state.latest_complete_cycle_id,
    state.metadata ->> 'lastProjectionStatus'
  into source_mode, applied_cycle_id, complete_cycle_id, projection_status
  from public.complete_power_outage_cez_projection_state state
  where state.singleton;

  select
    nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid,
    source_state.published_address_count
  into published_cycle_id, state_published_address_count
  from public.complete_power_outage_source_state source_state
  where source_state.source = 'cez';

  if candidate_cycle_id is null then
    return jsonb_build_object(
      'ok', true,
      'status', 'blocked',
      'publishStatus', 'blocked',
      'publishReason', 'no_cycle_data'
    );
  end if;

  if not (
    candidate_cycle_id = applied_cycle_id
    and candidate_cycle_status in ('succeeded', 'no_change')
    and projection_status = 'ready'
  ) then
    projection_result := public.build_complete_power_outage_cez_shadow_projection();

    update public.complete_power_outage_cez_projection_outages
    set source_status = 'cancelled', updated_at = now()
    where missing_since is not null
      and source_status in ('scheduled', 'active');

    select
      state.active_source,
      state.latest_complete_cycle_id,
      state.metadata ->> 'lastProjectionStatus'
    into source_mode, complete_cycle_id, projection_status
    from public.complete_power_outage_cez_projection_state state
    where state.singleton;
  else
    projection_result := jsonb_build_object(
      'ok', true,
      'status', 'unchanged',
      'cycleId', candidate_cycle_id,
      'projectionStatus', projection_status
    );
  end if;

  if source_mode <> 'shadow' then
    return projection_result || jsonb_build_object(
      'publishStatus', 'disabled',
      'publishReason', 'legacy_source_active'
    );
  end if;

  if complete_cycle_id is null or projection_status <> 'ready' then
    return projection_result || jsonb_build_object(
      'publishStatus', 'blocked',
      'publishReason', case
        when complete_cycle_id is null then 'no_complete_cycle'
        else 'projection_not_ready'
      end
    );
  end if;

  select count(*)::bigint
  into projected_address_count
  from public.complete_power_outage_cez_projection_addresses;

  select count(address.id)::bigint
  into production_address_count
  from public.complete_power_outage_cez_projection_outages projected_outage
  join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_outage.external_id
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id;

  select count(*)::bigint
  into missing_address_count
  from public.complete_power_outage_cez_projection_addresses projected_address
  left join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_address.outage_external_id
  left join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
   and address.address_key = projected_address.address_key
  where address.id is null;

  select count(*)::bigint
  into extra_address_count
  from public.complete_power_outage_cez_projection_outages projected_outage
  join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_outage.external_id
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  left join public.complete_power_outage_cez_projection_addresses projected_address
    on projected_address.outage_external_id = outage.external_id
   and projected_address.address_key = address.address_key
  where projected_address.id is null;

  address_integrity_ok := state_published_address_count = projected_address_count
    and production_address_count = projected_address_count
    and missing_address_count = 0
    and extra_address_count = 0;

  if published_cycle_id = complete_cycle_id and address_integrity_ok then
    return projection_result || jsonb_build_object(
      'publishStatus', 'current',
      'publishReason', 'complete_cycle_already_published',
      'publishedCycleId', published_cycle_id,
      'projectedAddressCount', projected_address_count,
      'productionAddressCount', production_address_count,
      'missingAddressCount', missing_address_count,
      'extraAddressCount', extra_address_count
    );
  end if;

  publish_request_id := public.request_power_outages_endpoint(
    '/api/power-outages/complete/sync?source=cez'
  );

  return projection_result || jsonb_build_object(
    'publishStatus', 'requested',
    'publishReason', case
      when published_cycle_id = complete_cycle_id then 'address_integrity_mismatch'
      else 'new_complete_cycle'
    end,
    'publishRequestId', publish_request_id,
    'completeCycleId', complete_cycle_id,
    'previouslyPublishedCycleId', published_cycle_id,
    'statePublishedAddressCount', state_published_address_count,
    'projectedAddressCount', projected_address_count,
    'productionAddressCount', production_address_count,
    'missingAddressCount', missing_address_count,
    'extraAddressCount', extra_address_count
  );
end;
$$;

revoke all on function public.advance_complete_power_outage_cez_projection()
  from public, anon, authenticated;
grant execute on function public.advance_complete_power_outage_cez_projection()
  to service_role;

commit;

select 'FUNCTION' as check_type, 'CEZ publisher verifies address integrity' as object_name,
  position('address_integrity_mismatch' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0 as is_correct
union all
select 'FUNCTION', 'CEZ publisher checks missing projected addresses',
  position('missing_address_count' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
union all
select 'FUNCTION', 'CEZ publisher checks extra production addresses',
  position('extra_address_count' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
union all
select 'GRANT', 'authenticated cannot run CEZ integrity publisher',
  not has_function_privilege('authenticated',
    'public.advance_complete_power_outage_cez_projection()', 'EXECUTE')
union all
select 'ISOLATION', 'CEZ publication repair stays in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) = 0
union all
select 'SAFETY', 'incomplete CEZ publication cannot be reported current',
  position('and address_integrity_ok' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
union all
select 'STATE', 'CEZ ALL v1 remains active',
  coalesce((select active_source = 'shadow'
    from public.complete_power_outage_cez_projection_state where singleton), false)
order by check_type, object_name;
