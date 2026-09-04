begin;

do $$
declare
  function_definition text;
  old_order text := 'order by municipality.scan_priority, municipality.scan_last_success_at nulls first,';
  new_order text := 'order by case when municipality.scan_status = ''error'' then 0 else 1 end, municipality.scan_priority, municipality.scan_last_success_at nulls first,';
begin
  if to_regclass('public.complete_power_outage_cez_municipalities') is null
    or to_regclass('public.complete_power_outage_cez_new_status_v2') is null
    or to_regprocedure('public.claim_complete_power_outage_cez_scan_batch(integer,boolean)') is null
  then
    raise exception 'Nejdříve spusťte migrace nového celoplošného ČEZ.';
  end if;

  function_definition := pg_get_functiondef(
    'public.claim_complete_power_outage_cez_scan_batch(integer,boolean)'::regprocedure
  );
  if position(new_order in function_definition) = 0 then
    if position(old_order in function_definition) = 0 then
      raise exception 'Pořadí skenovací fronty ČEZ má neočekávanou podobu.';
    end if;
    execute replace(function_definition, old_order, new_order);
  end if;
end
$$;

-- V3 nemění bezpečnostní podmínky aktivace. Pouze rozlišuje zdravý běh
-- s opakovatelnými chybami od skutečně zastavené nebo terminální chyby.
create or replace view public.complete_power_outage_cez_new_status_v3
with (security_invoker = true)
as
with scan_issues as (
  select
    count(*) filter (where municipality.is_active
      and municipality.scan_status = 'error')::bigint as retryable_error_count,
    count(*) filter (where municipality.is_active
      and municipality.scan_status = 'needs_review')::bigint as review_error_count,
    min(municipality.scan_next_attempt_at) filter (where municipality.is_active
      and municipality.scan_status = 'error') as next_retry_at,
    (array_agg(municipality.scan_error_message order by municipality.updated_at desc)
      filter (where municipality.is_active and municipality.scan_status = 'error'))[1]
      as latest_retryable_error
  from public.complete_power_outage_cez_municipalities municipality
), enhanced as (
  select status.*,
    issues.retryable_error_count as scan_retryable_error_count,
    issues.review_error_count as scan_review_error_count,
    issues.next_retry_at as scan_next_retry_at,
    status.cycle_status = 'running'
      and coalesce(status.scan_runner_status, '') <> 'error'
      and issues.retryable_error_count > 0
      and issues.review_error_count = 0
      and status.readiness_error_stage = 'scan' as healthy_scan_warning,
    issues.latest_retryable_error
  from public.complete_power_outage_cez_new_status_v2 status
  cross join scan_issues issues
)
select enhanced.*,
  case when enhanced.healthy_scan_warning then 'processing'
    else enhanced.readiness_status end as effective_readiness_status,
  case when enhanced.healthy_scan_warning then null
    else enhanced.readiness_error_stage end as effective_error_stage,
  case when enhanced.healthy_scan_warning then null
    else enhanced.readiness_error_code end as effective_error_code,
  case when enhanced.healthy_scan_warning then null
    else enhanced.readiness_error_message end as effective_error_message,
  case when enhanced.healthy_scan_warning then 'scan' else null end as warning_stage,
  case when enhanced.healthy_scan_warning then 'CEZ_SCAN_RETRY_QUEUED' else null end as warning_code,
  case when enhanced.healthy_scan_warning then
    enhanced.scan_retryable_error_count::text
      || ' obcí čeká na přednostní automatické opakování po dokončení aktuálního snapshotu.'
      || case when enhanced.latest_retryable_error is not null
        then ' Poslední příčina: ' || enhanced.latest_retryable_error else '' end
    else null end as warning_message
from enhanced;

revoke all on table public.complete_power_outage_cez_new_status_v3
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_new_status_v3
  to authenticated, service_role;

-- Ruční akce pouze označí chybné obce jako okamžitě splatné. Pokud právě běží
-- neměnný snapshot, zůstane nedotčen a oprava se vezme přednostně v dalším cyklu.
create or replace function public.recover_complete_power_outage_cez_scan_errors()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  request_id bigint;
  cycle_running boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_scan_error_recovery')
  );

  select exists (
    select 1 from public.complete_power_outage_cez_scan_cycles cycle
    where cycle.status = 'running' and not cycle.is_pilot
  ) into cycle_running;

  update public.complete_power_outage_cez_municipalities municipality
  set scan_status = 'error',
      scan_consecutive_error_count = case
        when municipality.scan_status = 'needs_review' then 0
        else municipality.scan_consecutive_error_count end,
      scan_next_attempt_at = now(),
      scan_lock_token = null,
      scan_lock_expires_at = null
  where municipality.is_active
    and municipality.scan_status in ('error', 'needs_review');
  get diagnostics affected_count = row_count;

  if affected_count = 0 then
    return jsonb_build_object(
      'status', 'not_needed', 'stage', 'scan', 'affectedCount', 0,
      'message', 'Žádná chybná obec nyní nečeká na opakování.'
    );
  end if;

  if cycle_running then
    return jsonb_build_object(
      'status', 'already_running', 'stage', 'scan',
      'affectedCount', affected_count,
      'message', affected_count::text
        || ' obcí bylo zařazeno k přednostnímu opakování po dokončení aktuálního snapshotu.'
    );
  end if;

  update public.complete_power_outage_cez_scan_runner_state
  set status = 'idle', consecutive_error_count = 0,
      next_attempt_at = null, last_error = null
  where singleton;
  request_id := public.advance_complete_power_outage_cez_scan_runner();

  return jsonb_build_object(
    'status', 'started', 'stage', 'scan',
    'affectedCount', affected_count, 'requestId', request_id,
    'message', 'Chybné obce byly přednostně zařazeny do nového opravného cyklu.'
  );
end;
$$;

revoke all on function public.recover_complete_power_outage_cez_scan_errors()
  from public, anon, authenticated;
grant execute on function public.recover_complete_power_outage_cez_scan_errors()
  to service_role;

commit;
