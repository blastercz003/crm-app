begin;

do $$
begin
  if to_regprocedure('public.run_power_outage_watchdog()') is null
    or to_regclass('public.power_outage_source_state') is null
    or to_regclass('public.power_outage_cez_market_collector_state') is null
    or to_regclass('public.power_outage_cez_market_version_overview') is null
  then
    raise exception 'Nejdříve nasaďte runtime a režim ČEZ MARKETY v1 + v2.';
  end if;
end
$$;

-- The generic watchdog predates the versioned CEZ collectors. EG.D and PRE
-- keep the original eight-hour guard. CEZ health is now derived independently
-- for every enabled collector from its own cadence (v1 24 h, v2 6 h).
create or replace function public.run_power_outage_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checked_at timestamptz := now();
  expired_task_locks integer := 0;
  stale_source_runs integer := 0;
  stale_match_runs integer := 0;
  stale_store_audits integer := 0;
  stale_sources integer := 0;
  stale_source record;
begin
  update public.power_outage_task_state
  set lock_token = null,
      lock_expires_at = null,
      last_finished_at = checked_at,
      last_status = 'failed',
      consecutive_failure_count = consecutive_failure_count + 1,
      last_error_code = 'TASK_LEASE_EXPIRED',
      last_error_message = 'Plánovaný úkol nedokončil běh před vypršením bezpečnostního zámku.'
  where lock_token is not null
    and lock_expires_at <= checked_at
    and task_key <> 'watchdog';
  get diagnostics expired_task_locks = row_count;

  for stale_source in
    select source, count(*)::integer as run_count
    from public.power_outage_sync_runs
    where status = 'running'
      and started_at < checked_at - interval '90 minutes'
    group by source
  loop
    update public.power_outage_source_state
    set last_error_at = checked_at,
        last_error_code = upper(stale_source.source) || '_SYNC_STALE',
        last_error_message = 'Synchronizace zdroje překročila bezpečnostní limit 90 minut.',
        consecutive_failure_count = consecutive_failure_count + 1
    where source = stale_source.source;
  end loop;

  update public.power_outage_sync_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = upper(source) || '_SYNC_STALE',
      error_message = 'Synchronizace zdroje překročila bezpečnostní limit 90 minut.'
  where status = 'running'
    and started_at < checked_at - interval '90 minutes';
  get diagnostics stale_source_runs = row_count;

  update public.power_outage_match_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = 'STORE_MATCH_STALE',
      error_message = 'Párování odstávek překročilo bezpečnostní limit 60 minut.'
  where status = 'running'
    and started_at < checked_at - interval '60 minutes';
  get diagnostics stale_match_runs = row_count;

  update public.power_outage_store_audit_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = 'STORE_AUDIT_STALE',
      error_message = 'Úplný audit Prodejen překročil bezpečnostní limit 60 minut.'
  where status = 'running'
    and started_at < checked_at - interval '60 minutes';
  get diagnostics stale_store_audits = row_count;

  update public.power_outage_source_state
  set last_error_at = checked_at,
      last_error_code = 'SOURCE_STALE',
      last_error_message = 'Zdroj nebyl úspěšně aktualizován déle než 8 hodin.',
      consecutive_failure_count = greatest(consecutive_failure_count, 1)
  where source <> 'cez'
    and (last_success_at is null or last_success_at < checked_at - interval '8 hours')
    and last_error_code is distinct from 'SOURCE_STALE';
  get diagnostics stale_sources = row_count;

  return jsonb_build_object(
    'expiredTaskLocks', expired_task_locks,
    'staleSourceRuns', stale_source_runs,
    'staleMatchRuns', stale_match_runs,
    'staleStoreAudits', stale_store_audits,
    'staleSources', stale_sources,
    'checkedAt', checked_at
  );
end;
$$;

revoke all on function public.run_power_outage_watchdog() from public, anon, authenticated;
grant execute on function public.run_power_outage_watchdog() to service_role;

-- Remove only the false legacy marker observed after dual-mode activation.
-- Real failures, stalled cycles and errors of either collector are untouched.
update public.power_outage_source_state source_state
set last_error_at = null,
    last_error_code = null,
    last_error_message = null,
    consecutive_failure_count = 0
where source_state.source = 'cez'
  and source_state.last_error_code = 'SOURCE_STALE'
  and source_state.consecutive_failure_count <= 1
  and exists (
    select 1
    from public.power_outage_cez_market_collector_state collector_state
    where collector_state.singleton
      and collector_state.operating_mode in ('dual', 'v2_only')
  )
  and not exists (
    select 1
    from public.power_outage_cez_market_version_overview version_state
    where version_state.is_enabled
      and version_state.health_status in ('delayed', 'error', 'waiting')
  );

commit;

select 'FUNCTION' as check_type, 'watchdog excludes CEZ from generic eight hour stale rule' as object_name,
  position('source <> ''cez''' in lower(pg_get_functiondef('public.run_power_outage_watchdog()'::regprocedure))) > 0 as is_correct
union all
select 'LOGIC', 'CEZ v1 and v2 keep independent cadence',
  coalesce((
    select bool_and(
      (collector_version = 'v1' and cadence_seconds = 86400)
      or (collector_version = 'v2' and cadence_seconds = 21600)
    ) and count(*) = 2
    from public.power_outage_cez_market_version_overview
    where is_enabled
  ), false)
union all
select 'STATE', 'false CEZ legacy stale marker is cleared',
  not exists (
    select 1 from public.power_outage_source_state
    where source = 'cez' and last_error_code = 'SOURCE_STALE'
  )
union all
select 'SAFETY', 'real CEZ collector errors remain visible',
  position('delayed' in lower(pg_get_viewdef('public.power_outage_cez_market_version_overview'::regclass, true))) > 0
    and position('error' in lower(pg_get_viewdef('public.power_outage_cez_market_version_overview'::regclass, true))) > 0
union all
select 'GRANT', 'authenticated cannot run watchdog',
  not has_function_privilege('authenticated', 'public.run_power_outage_watchdog()', 'EXECUTE')
union all
select 'ISOLATION', 'watchdog does not reference COMPLETE outage tables',
  position('complete_' in lower(pg_get_functiondef('public.run_power_outage_watchdog()'::regprocedure))) = 0
order by check_type, object_name;
