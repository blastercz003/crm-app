begin;

do $$
declare
  function_definition text;
begin
  if to_regclass('public.complete_power_outage_cez_new_status') is null
    or to_regprocedure('public.build_complete_power_outage_cez_shadow_projection()') is null
  then
    raise exception 'Nejdříve spusťte migraci aktivace a monitoringu nového ČEZ.';
  end if;

  -- Opraví již nasazenou funkci bez kopírování jejího dlouhého těla. Beze změny
  -- zůstane, pokud byla správná verze nasazena už z aktualizovaného základu.
  function_definition := pg_get_functiondef(
    'public.build_complete_power_outage_cez_shadow_projection()'::regprocedure
  );
  if position('cycle.status in (''running'', ''succeeded'')' in function_definition) > 0 then
    function_definition := replace(
      function_definition,
      'cycle.status in (''running'', ''succeeded'')',
      'cycle.status in (''running'', ''succeeded'', ''no_change'')'
    );
  end if;
  if position('selected_cycle.status = ''succeeded''' in function_definition) > 0 then
    function_definition := replace(
      function_definition,
      'selected_cycle.status = ''succeeded''',
      'selected_cycle.status in (''succeeded'', ''no_change'')'
    );
  end if;
  execute function_definition;
end
$$;

-- V2 ponechává původní diagnostická pole a přidává přísnou aktivační bránu,
-- konkrétní chybnou fázi a technický kód pro cílenou opravu.
create or replace view public.complete_power_outage_cez_new_status_v2
with (security_invoker = true)
as
with current_scope as (
  select
    count(*) filter (where municipality.is_active)::bigint as catalog_count,
    count(*) filter (where municipality.is_active and (
      municipality.representative_status = 'no_address'
      or (municipality.representative_status = 'resolved'
        and municipality.mapping_status in ('resolved', 'not_cez'))
    ))::bigint as classified_count,
    count(*) filter (where municipality.is_active
      and municipality.representative_status = 'resolved'
      and municipality.mapping_status = 'resolved'
      and municipality.distribution_status = 'cez'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null)::bigint as cez_count
  from public.complete_power_outage_cez_municipalities municipality
), recent_cycles as (
  select cycle.*
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot
    and cycle.snapshot_contract_version = 2
    and cycle.status <> 'running'
  order by cycle.finished_at desc nulls last, cycle.started_at desc, cycle.id desc
  limit 2
), safe_cycles as (
  select
    count(*)::bigint as recent_count,
    count(*) filter (where cycle.status in ('succeeded', 'no_change')
      and cycle.snapshot_status = 'complete'
      and cycle.snapshot_publishable
      and cycle.scope_catalog_count = scope.catalog_count
      and cycle.scope_classified_count = scope.classified_count
      and cycle.scope_cez_count = scope.cez_count
      and cycle.municipality_total_count = scope.cez_count)::bigint as safe_count,
    (array_agg(cycle.id order by cycle.finished_at desc nulls last,
      cycle.started_at desc, cycle.id desc))[1] as latest_cycle_id
  from recent_cycles cycle
  cross join current_scope scope
), municipality_error as (
  select
    case
      when municipality.representative_status in ('error', 'needs_review') then 'ruian'
      else 'mapping'
    end as error_stage,
    case when municipality.representative_status in ('error', 'needs_review')
      then 'CEZ_RUIAN_REPRESENTATIVE_ERROR'
      else municipality.mapping_error_code end as error_code,
    coalesce(municipality.representative_error_message, municipality.mapping_error_message) as error_message
  from public.complete_power_outage_cez_municipalities municipality
  where municipality.is_active and (
    municipality.representative_status in ('error', 'needs_review')
    or municipality.mapping_status in ('error', 'needs_review')
  )
  order by municipality.updated_at desc
  limit 1
), normalization_error as (
  select address.normalization_error_code as error_code,
    address.normalization_error_message as error_message
  from public.complete_power_outage_cez_staged_addresses address
  where address.normalization_status in ('error', 'needs_review')
  order by address.updated_at desc
  limit 1
), enhanced as (
  select status.*,
    scope.catalog_count as readiness_catalog_count,
    scope.classified_count as readiness_classified_count,
    scope.cez_count as readiness_cez_count,
    safe.recent_count as recent_cycle_count,
    safe.safe_count as safe_recent_cycle_count,
    safe.latest_cycle_id as latest_finalized_cycle_id,
    (safe.recent_count = 2 and safe.safe_count = 2) as latest_two_cycles_safe,
    (status.latest_applied_cycle_id = safe.latest_cycle_id) as latest_projection_matches,
    case
      when status.ruian_runner_status = 'failed' or status.representative_error > 0 then 'ruian'
      when status.mapping_runner_status = 'failed' or status.mapping_error > 0 then 'mapping'
      when status.scan_runner_status = 'error' or status.scan_error > 0 then 'scan'
      when status.normalization_error > 0 then 'normalization'
      when status.projection_status = 'failed' then 'projection'
      else null
    end as readiness_error_stage,
    case
      when status.ruian_runner_status = 'failed' then 'CEZ_RUIAN_RUNNER_FAILED'
      when status.mapping_runner_status = 'failed' then 'CEZ_MAPPING_RUNNER_FAILED'
      when status.scan_runner_status = 'error' then 'CEZ_SCAN_RUNNER_FAILED'
      when status.scan_error > 0 then coalesce(status.scan_error_code, 'CEZ_SCAN_MUNICIPALITY_ERRORS')
      when status.normalization_error > 0 then coalesce(normalizer.error_code, 'CEZ_NORMALIZATION_ERRORS')
      when status.projection_status = 'failed' then coalesce(status.projection_error_code, 'CEZ_PROJECTION_FAILED')
      else municipality_error.error_code
    end as readiness_error_code,
    coalesce(
      status.projection_error_message,
      status.scan_error_message,
      status.scan_runner_error,
      status.mapping_runner_error,
      status.ruian_runner_error,
      normalizer.error_message,
      municipality_error.error_message
    ) as readiness_error_message
  from public.complete_power_outage_cez_new_status status
  cross join current_scope scope
  cross join safe_cycles safe
  left join municipality_error on true
  left join normalization_error normalizer on true
)
select enhanced.*,
  case
    when enhanced.readiness_error_stage is not null then 'error'
    when enhanced.representative_remaining > 0 or enhanced.mapping_remaining > 0
      or enhanced.cycle_status = 'running' or enhanced.normalization_remaining > 0
      or enhanced.projection_status in ('building', 'partial_ready') then 'processing'
    when enhanced.representative_error > 0 or enhanced.mapping_error > 0 then 'partial'
    when enhanced.latest_two_cycles_safe
      and enhanced.projection_status = 'ready'
      and enhanced.latest_projection_matches
      and enhanced.normalization_remaining = 0
      and enhanced.normalization_error = 0 then 'ready'
    else 'waiting'
  end as readiness_status
from enhanced;

revoke all on table public.complete_power_outage_cez_new_status_v2
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_new_status_v2
  to authenticated, service_role;

-- Ruční oprava vždy obnoví pouze právě vybranou fázi. Aktivní zdravý běh
-- neduplikuje a nezasahuje do MARKETY, EG.D ani PRE.
create or replace function public.recover_complete_power_outage_cez_new_stage(
  requested_stage text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_stage text := lower(btrim(coalesce(requested_stage, '')));
  request_id bigint;
  projection_result jsonb;
  existing_job record;
  affected_count integer := 0;
begin
  if safe_stage not in ('ruian', 'mapping', 'scan', 'normalization', 'projection') then
    raise exception 'Neplatná fáze obnovy nového ČEZ.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_new_recovery_' || safe_stage)
  );

  if safe_stage = 'ruian' then
    if exists (select 1 from public.complete_power_outage_cez_ruian_bootstrap_state
      where singleton and status = 'running' and last_requested_at > now() - interval '8 minutes')
    then return jsonb_build_object('status', 'already_running', 'stage', safe_stage); end if;
    update public.complete_power_outage_cez_municipalities
    set representative_status = 'pending', representative_next_attempt_at = null,
      representative_error_message = null
    where is_active and representative_status = 'error';
    get diagnostics affected_count = row_count;
    update public.complete_power_outage_cez_ruian_bootstrap_state
    set status = 'idle', consecutive_error_count = 0, next_attempt_at = null, last_error = null
    where singleton;
    for existing_job in select jobid from cron.job
      where jobname = 'complete_cez_ruian_bootstrap_every_ten_minutes'
    loop perform cron.unschedule(existing_job.jobid); end loop;
    perform cron.schedule('complete_cez_ruian_bootstrap_every_ten_minutes', '*/10 * * * *',
      $job$select public.advance_complete_power_outage_cez_ruian_bootstrap();$job$);
    request_id := public.advance_complete_power_outage_cez_ruian_bootstrap();

  elsif safe_stage = 'mapping' then
    if exists (select 1 from public.complete_power_outage_cez_mapping_bootstrap_state
      where singleton and status = 'running' and last_requested_at > now() - interval '8 minutes')
    then return jsonb_build_object('status', 'already_running', 'stage', safe_stage); end if;
    update public.complete_power_outage_cez_municipalities
    set mapping_status = 'pending', mapping_next_attempt_at = null,
      mapping_error_code = null, mapping_error_message = null
    where is_active and mapping_status = 'error';
    get diagnostics affected_count = row_count;
    update public.complete_power_outage_cez_mapping_bootstrap_state
    set status = 'idle', consecutive_error_count = 0, next_attempt_at = null, last_error = null
    where singleton;
    for existing_job in select jobid from cron.job
      where jobname = 'complete_cez_mapping_bootstrap_every_fifteen_minutes'
    loop perform cron.unschedule(existing_job.jobid); end loop;
    perform cron.schedule('complete_cez_mapping_bootstrap_every_fifteen_minutes', '13-59/15 * * * *',
      $job$select public.advance_complete_power_outage_cez_mapping_bootstrap();$job$);
    request_id := public.advance_complete_power_outage_cez_mapping_bootstrap();

  elsif safe_stage = 'scan' then
    if exists (select 1 from public.complete_power_outage_cez_scan_runner_state
      where singleton and status = 'running' and last_requested_at > now() - interval '8 minutes')
    then return jsonb_build_object('status', 'already_running', 'stage', safe_stage); end if;
    update public.complete_power_outage_cez_municipalities
    set scan_status = 'error', scan_consecutive_error_count = 0,
      scan_next_attempt_at = now(), scan_error_code = null, scan_error_message = null,
      scan_lock_token = null, scan_lock_expires_at = null
    where is_active and scan_status in ('error', 'needs_review');
    get diagnostics affected_count = row_count;
    update public.complete_power_outage_cez_scan_runner_state
    set status = 'idle', consecutive_error_count = 0, next_attempt_at = null, last_error = null
    where singleton;
    request_id := public.advance_complete_power_outage_cez_scan_runner();

  elsif safe_stage = 'normalization' then
    update public.complete_power_outage_cez_staged_addresses
    set normalization_status = 'pending', normalization_attempt_count = 0,
      normalization_next_attempt_at = null, normalization_error_code = null,
      normalization_error_message = null, normalization_lock_token = null,
      normalization_lock_expires_at = null
    where normalization_status = 'error';
    get diagnostics affected_count = row_count;
    request_id := public.request_complete_power_outage_cez_staged_address_normalization(100);

  else
    projection_result := public.advance_complete_power_outage_cez_projection();
    if not coalesce((projection_result->>'ok')::boolean, true) then
      return jsonb_build_object('status', 'manual_required', 'stage', safe_stage,
        'affectedCount', 0,
        'message', coalesce(projection_result->>'error', 'Projekci se nepodařilo automaticky obnovit.'),
        'result', projection_result);
    end if;
    return jsonb_build_object('status', 'started', 'stage', safe_stage,
      'affectedCount', 0, 'result', projection_result);
  end if;

  if request_id is null and affected_count = 0 then
    return jsonb_build_object('status', 'manual_required', 'stage', safe_stage,
      'affectedCount', affected_count,
      'message', 'Nebyla nalezena automaticky opakovatelná chyba. Záznam vyžaduje ruční kontrolu.');
  end if;
  return jsonb_build_object('status', 'started', 'stage', safe_stage,
    'affectedCount', affected_count, 'requestId', request_id);
end;
$$;

revoke all on function public.recover_complete_power_outage_cez_new_stage(text)
  from public, anon, authenticated;
grant execute on function public.recover_complete_power_outage_cez_new_stage(text)
  to service_role;

create or replace function public.set_complete_power_outage_cez_source(requested_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_source text := lower(btrim(coalesce(requested_source, '')));
  status_row record;
  prior_source text;
begin
  if safe_source not in ('legacy', 'shadow') then
    raise exception 'Zdroj musí být legacy nebo shadow.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_activation')
  );
  select active_source into prior_source
  from public.complete_power_outage_cez_projection_state
  where singleton for update;

  if safe_source = 'shadow' then
    select * into status_row from public.complete_power_outage_cez_new_status_v2;
    if status_row.readiness_status <> 'ready'
      or not status_row.latest_two_cycles_safe
      or not status_row.latest_projection_matches
      or status_row.normalization_remaining > 0
      or status_row.normalization_error > 0
    then
      raise exception 'Nový ČEZ zdroj nesplňuje zpřísněné aktivační podmínky.';
    end if;
  end if;

  update public.complete_power_outage_cez_projection_state
  set previous_source = prior_source, active_source = safe_source,
    activated_at = now(), activated_by = auth.uid(), updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'lastSourceChangeAt', now(), 'lastSourceChangeFrom', prior_source,
      'lastSourceChangeTo', safe_source, 'readinessContractVersion', 2
    )
  where singleton;

  return jsonb_build_object('ok', true, 'previousSource', prior_source,
    'activeSource', safe_source, 'changed', prior_source is distinct from safe_source);
end;
$$;

revoke all on function public.set_complete_power_outage_cez_source(text)
  from public, anon, authenticated;
grant execute on function public.set_complete_power_outage_cez_source(text) to service_role;

commit;
