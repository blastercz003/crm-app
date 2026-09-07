begin;

do $$
begin
  if to_regprocedure('public.build_complete_power_outage_cez_shadow_projection()') is null
    or to_regprocedure('public.request_power_outages_endpoint(text)') is null
    or to_regclass('public.complete_power_outage_cez_projection_state') is null
    or to_regclass('public.complete_power_outage_cez_scan_cycles') is null
    or to_regclass('public.complete_power_outage_cez_cycle_outages') is null
    or to_regclass('public.complete_power_outage_source_state') is null
  then
    raise exception 'Chybi zavislosti pro CEZ ALL v1 publisher.';
  end if;
end
$$;

-- Publisher nejprve zjistí, zda se od poslední úspěšné publikace změnil
-- použitelný cyklus nebo zda ještě dobíhá jeho projekce. Stabilní kompletní
-- cyklus znovu nepřepočítává a neposílá opakované HTTP synchronizace.
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

  select nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid
  into published_cycle_id
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

  -- Hotový a již promítnutý cyklus není nutné každých pět minut znovu
  -- upsertovat. U běžícího nebo částečně připraveného cyklu se projekce dále
  -- obnovuje, aby mohla průběžně převzít dokončenou normalizaci.
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

  if published_cycle_id = complete_cycle_id then
    return projection_result || jsonb_build_object(
      'publishStatus', 'current',
      'publishReason', 'complete_cycle_already_published',
      'publishedCycleId', published_cycle_id
    );
  end if;

  publish_request_id := public.request_power_outages_endpoint(
    '/api/power-outages/complete/sync?source=cez'
  );

  return projection_result || jsonb_build_object(
    'publishStatus', 'requested',
    'publishRequestId', publish_request_id,
    'completeCycleId', complete_cycle_id,
    'previouslyPublishedCycleId', published_cycle_id
  );
end;
$$;

revoke all on function public.advance_complete_power_outage_cez_projection()
  from public, anon, authenticated;
grant execute on function public.advance_complete_power_outage_cez_projection()
  to service_role;

-- Odstraní původní přímý 15minutový sync a všechny případné duplicity
-- publisheru. Aktivní zůstane právě jeden pětiminutový řídicí cron.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_complete_cez_projection_every_fifteen_minutes',
      'complete_cez_shadow_projection_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_cez_shadow_projection_every_five_minutes',
    '3-59/5 * * * *',
    $job$select public.advance_complete_power_outage_cez_projection();$job$
  );
end
$$;

commit;

select 'CRON' as check_type, 'single CEZ ALL v1 publisher' as object_name,
  (select count(*) = 1
    from cron.job
    where jobname = 'complete_cez_shadow_projection_every_five_minutes'
      and active) as is_correct
union all
select 'CRON', 'legacy direct CEZ complete sync removed',
  not exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes'
      and active
  )
union all
select 'CRON', 'only one active CEZ complete scheduler',
  (select count(*) = 1
    from cron.job
    where active
      and (
        command like '%advance_complete_power_outage_cez_projection()%'
        or command like '%/api/power-outages/complete/sync?source=cez%'
      ))
union all
select 'FUNCTION', 'publisher skips already published complete cycle',
  pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure
  ) like '%complete_cycle_already_published%'
union all
select 'FUNCTION', 'publisher retries until source confirms cycle',
  pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure
  ) like '%completeCezCycleId%'
union all
select 'GRANT', 'authenticated cannot run CEZ publisher',
  not has_function_privilege('authenticated',
    'public.advance_complete_power_outage_cez_projection()', 'EXECUTE')
union all
select 'ISOLATION', 'publisher stays in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef(
    'public.advance_complete_power_outage_cez_projection()'::regprocedure)) = 0
union all
select 'STATE', 'CEZ ALL v1 remains active',
  coalesce((select active_source = 'shadow'
    from public.complete_power_outage_cez_projection_state where singleton), false)
order by check_type, object_name;
