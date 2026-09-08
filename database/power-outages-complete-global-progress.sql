begin;

-- Jediný lehký snapshot pro souhrnný panel KOMPLETNÍ. Nevolá žádného
-- externího poskytovatele a nezasahuje do jednotlivých pracovních front.
create table if not exists public.complete_power_outage_global_progress_snapshot (
  singleton boolean primary key default true check (singleton),
  status text not null default 'waiting'
    check (status in ('waiting', 'processing', 'current', 'delayed', 'error')),
  progress_percent numeric(5, 1) not null default 0
    check (progress_percent between 0 and 100),
  remaining_seconds bigint,
  estimated_finish_at timestamptz,
  active_queue_count integer not null default 0 check (active_queue_count >= 0),
  status_message text not null default 'Souhrnný stav zatím není dostupný.',
  last_progress_at timestamptz,
  refreshed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

alter table public.complete_power_outage_global_progress_snapshot enable row level security;
drop policy if exists cpo_global_progress_authorized_read
  on public.complete_power_outage_global_progress_snapshot;
create policy cpo_global_progress_authorized_read
  on public.complete_power_outage_global_progress_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_global_progress_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_global_progress_snapshot to authenticated;
grant all on table public.complete_power_outage_global_progress_snapshot to service_role;

create or replace function public.refresh_complete_power_outage_global_progress_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_global_progress_snapshot')
  );

  with recent_runs as (
    select
      case
        when run_kind = 'address_normalization' then 'normalization'
        when run_kind = 'company_reconciliation' then 'evaluation'
        when run_kind = 'company_discovery' and provider = 'ares' then 'ares'
        when run_kind = 'company_discovery' and provider = 'mapy' then 'mapy'
        when run_kind = 'source_sync' then 'source_' || source
      end as lane,
      source_record_count::numeric
        / greatest(1, extract(epoch from finished_at - started_at)) as items_per_second,
      row_number() over (
        partition by run_kind, coalesce(provider, ''), coalesce(source, '')
        order by finished_at desc
      ) as recent_rank
    from public.complete_power_outage_runs
    where status in ('succeeded', 'no_change')
      and finished_at is not null
      and source_record_count > 0
      and finished_at > started_at
      and run_kind in ('source_sync', 'address_normalization', 'company_discovery', 'company_reconciliation')
  ), run_rates as (
    select lane,
      percentile_cont(0.5) within group (order by items_per_second)::numeric as items_per_second
    from recent_runs
    where recent_rank <= 20 and lane is not null
    group by lane
  ), latest_cez_cycles as (
    select municipality_processed_count::numeric
        / greatest(1, extract(epoch from finished_at - started_at)) as items_per_second,
      row_number() over (order by finished_at desc) as recent_rank
    from public.complete_power_outage_cez_scan_cycles
    where not is_pilot
      and status in ('succeeded', 'no_change')
      and finished_at is not null
      and municipality_processed_count > 0
      and finished_at > started_at
  ), cez_rate as (
    select percentile_cont(0.5) within group (order by items_per_second)::numeric as items_per_second
    from latest_cez_cycles where recent_rank <= 10
  ), rates as (
    select
      coalesce((select items_per_second from run_rates where lane = 'normalization'), 1000.0 / 60.0) as normalization,
      coalesce((select items_per_second from run_rates where lane = 'ares'), 50.0 / 60.0) as ares,
      coalesce((select items_per_second from run_rates where lane = 'mapy'), 25.0 / 60.0) as mapy,
      coalesce((select items_per_second from run_rates where lane = 'evaluation'), 250.0 / 60.0) as evaluation,
      coalesce((select items_per_second from run_rates where lane = 'source_egd'), 1000.0 / 60.0) as source_egd,
      coalesce((select items_per_second from run_rates where lane = 'source_pre'), 1000.0 / 60.0) as source_pre,
      coalesce((select items_per_second from cez_rate), 20.0 / 60.0) as source_cez
  ), source_counts as (
    select
      coalesce(sum(coverage_processed_count) filter (
        where source in ('egd', 'pre') and coverage_status = 'processing'
      ), 0)::numeric as processed,
      coalesce(sum(coverage_total_count) filter (
        where source in ('egd', 'pre') and coverage_status = 'processing'
      ), 0)::numeric as total,
      coalesce(sum(greatest(0, coverage_total_count - coverage_processed_count)) filter (
        where source in ('egd', 'pre') and coverage_status = 'processing'
      ), 0)::numeric as remaining,
      count(*) filter (
        where source in ('egd', 'pre') and coverage_status = 'processing'
          and coverage_total_count > coverage_processed_count
      )::integer as active_count,
      count(*) filter (
        where source in ('egd', 'pre') and coverage_status = 'processing'
          and coverage_total_count > coverage_processed_count
          and coalesce(last_change_at, last_success_at, last_attempt_at)
            < now() - interval '45 minutes'
      )::integer as delayed_count,
      max(coalesce(last_change_at, last_success_at, last_attempt_at)) as last_progress_at
    from public.complete_power_outage_source_state
  ), cez_counts as (
    select
      case when cycle_status = 'running' then scan_processed else 0 end::numeric as processed,
      case when cycle_status = 'running' then scan_total else 0 end::numeric as total,
      case when cycle_status = 'running' then greatest(0, scan_total - scan_processed) else 0 end::numeric as remaining,
      case when cycle_status = 'running' and scan_total > scan_processed then 1 else 0 end::integer as active_count,
      case when cycle_status = 'running' then scan_started_at else last_projection_at end as last_progress_at,
      coalesce(scan_error, 0)::bigint as error_count
    from public.complete_power_outage_cez_new_status_v3
  ), normalization_counts as (
    select coalesce(sum(normalized_count), 0)::numeric as processed,
      coalesce(sum(total_count), 0)::numeric as total,
      coalesce(sum(pending_count), 0)::numeric as remaining,
      coalesce(sum(error_count + review_count), 0)::bigint as error_count,
      max(refreshed_at) as last_progress_at
    from public.complete_power_outage_address_coverage_snapshot
  ), discovery_counts as (
    select
      coalesce(sum(exact_target_count - exact_pending_target_count - exact_error_target_count), 0)::numeric as ares_processed,
      coalesce(sum(exact_target_count), 0)::numeric as ares_total,
      coalesce(sum(exact_pending_target_count + exact_error_target_count), 0)::numeric as ares_remaining,
      coalesce(sum(exact_error_target_count), 0)::bigint as error_count,
      count(*) filter (
        where exact_pending_target_count > 0
          and coalesce(exact_last_progress_at, exact_oldest_pending_at)
            < now() - interval '45 minutes'
      )::integer as delayed_count,
      max(exact_last_progress_at) as ares_last_progress_at
    from public.complete_power_outage_source_discovery_overview
  ), mapy_counts as (
    select
      coalesce(max(processed_target_count) filter (where provider = 'mapy'), 0)::numeric as processed,
      coalesce(max(total_target_count) filter (where provider = 'mapy'), 0)::numeric as total,
      coalesce(max(remaining_target_count) filter (where provider = 'mapy'), 0)::numeric as remaining,
      coalesce(max(error_count) filter (where provider = 'mapy'), 0)::bigint as error_count,
      max(last_request_at) filter (where provider = 'mapy') as last_progress_at
    from public.complete_power_outage_provider_overview_snapshot
  ), evaluation_counts as (
    select coalesce(sum(evaluated_candidate_count), 0)::numeric as processed,
      coalesce(sum(candidate_count), 0)::numeric as total,
      coalesce(sum(pending_candidate_count), 0)::numeric as remaining,
      count(*) filter (
        where pending_candidate_count > 0
          and last_evaluated_at < now() - interval '45 minutes'
      )::integer as delayed_count,
      max(last_evaluated_at) as last_progress_at
    from public.complete_power_outage_evaluation_progress_snapshot
    where provider = 'all'
  ), task_health as (
    select
      count(*) filter (where last_status in ('failed', 'partial') or consecutive_failure_count > 0)::integer as failed_count,
      count(*) filter (
        where task_key = 'normalize_addresses'
          and last_status <> 'running'
          and coalesce(last_finished_at, last_success_at, last_started_at)
            < now() - interval '15 minutes'
      )::integer as normalization_delayed_count,
      max(coalesce(last_finished_at, last_started_at, last_success_at)) as last_activity_at
    from public.complete_power_outage_task_state
    where task_key in ('sync_cez', 'sync_egd', 'sync_pre', 'normalize_addresses',
      'discover_ares', 'discover_mapy', 'reconcile_companies')
  ), calculation as (
    select
      src.total + cez.total + norm.total + disc.ares_total
        + mapy.total + eval.total as total_units,
      src.processed / greatest(r.source_egd, r.source_pre, 0.001)
        + cez.processed / greatest(r.source_cez, 0.001)
        + norm.processed / greatest(r.normalization, 0.001)
        + disc.ares_processed / greatest(r.ares, 0.001)
        + mapy.processed / greatest(r.mapy, 0.001)
        + eval.processed / greatest(r.evaluation, 0.001) as processed_effort_seconds,
      src.total / greatest(r.source_egd, r.source_pre, 0.001)
        + cez.total / greatest(r.source_cez, 0.001)
        + norm.total / greatest(r.normalization, 0.001)
        + disc.ares_total / greatest(r.ares, 0.001)
        + mapy.total / greatest(r.mapy, 0.001)
        + eval.total / greatest(r.evaluation, 0.001) as total_effort_seconds,
      src.remaining + cez.remaining + norm.remaining + disc.ares_remaining
        + mapy.remaining + eval.remaining as remaining_units,
      src.active_count + cez.active_count
        + case when norm.remaining > 0 then 1 else 0 end
        + case when disc.ares_remaining > 0 then 1 else 0 end
        + case when mapy.remaining > 0 then 1 else 0 end
        + case when eval.remaining > 0 then 1 else 0 end as active_queue_count,
      greatest(
        ceil(src.remaining / greatest(r.source_egd, r.source_pre, 0.001)),
        ceil(cez.remaining / greatest(r.source_cez, 0.001)),
        ceil(norm.remaining / greatest(r.normalization, 0.001))
          + greatest(
              ceil(disc.ares_remaining / greatest(r.ares, 0.001)),
              ceil(mapy.remaining / greatest(r.mapy, 0.001))
            )
          + ceil(eval.remaining / greatest(r.evaluation, 0.001))
      )::bigint as remaining_seconds,
      greatest(src.last_progress_at, cez.last_progress_at, norm.last_progress_at,
        disc.ares_last_progress_at, mapy.last_progress_at,
        eval.last_progress_at, health.last_activity_at) as last_progress_at,
      health.failed_count,
      cez.error_count + norm.error_count as queue_error_count,
      disc.error_count + mapy.error_count as provider_attention_count,
      src.delayed_count + disc.delayed_count + eval.delayed_count
        + case when mapy.remaining > 0
            and mapy.last_progress_at < now() - interval '45 minutes' then 1 else 0 end
        + case when norm.remaining > 0 then health.normalization_delayed_count else 0 end
        as delayed_count,
      r.normalization as normalization_rate,
      r.ares as ares_rate,
      r.mapy as mapy_rate,
      r.evaluation as evaluation_rate,
      src.remaining as source_remaining,
      cez.remaining as cez_remaining,
      norm.remaining as normalization_remaining,
      disc.ares_remaining,
      mapy.remaining as mapy_remaining,
      eval.remaining as evaluation_remaining
    from source_counts src cross join cez_counts cez cross join normalization_counts norm
    cross join discovery_counts disc cross join mapy_counts mapy cross join evaluation_counts eval
    cross join task_health health cross join rates r
  ), final as (
    select *,
      case
        when failed_count > 0 or queue_error_count > 0 then 'error'
        when remaining_units > 0 and delayed_count > 0 then 'delayed'
        when remaining_units > 0 then 'processing'
        when total_units > 0 then 'current'
        else 'waiting'
      end as final_status,
      case
        when remaining_units <= 0 and total_units > 0 then 100.0
        when total_units <= 0 then 0.0
        else least(99.9, round((processed_effort_seconds / greatest(total_effort_seconds, 0.001)) * 100.0, 1))
      end as final_percent
    from calculation
  )
  insert into public.complete_power_outage_global_progress_snapshot (
    singleton, status, progress_percent, remaining_seconds, estimated_finish_at,
    active_queue_count, status_message, last_progress_at, refreshed_at, metadata
  )
  select true, final_status, final_percent,
    case when remaining_units > 0 then remaining_seconds else 0 end,
    case when remaining_units > 0 then now() + make_interval(secs => remaining_seconds::double precision) else null end,
    active_queue_count,
    case final_status
      when 'error' then 'Jedna z aktivních front hlásí skutečnou provozní chybu.'
      when 'delayed' then 'Aktivní fronta má práci, ale neposouvá se v očekávaném intervalu.'
      when 'processing' then 'Probíhá zpracování všech aktuálních front.'
      when 'current' then 'Všechny aktuální fronty jsou dokončené.'
      else 'Čeká se na první aktuální data.'
    end,
    last_progress_at, now(),
    jsonb_build_object(
      'remaining', jsonb_build_object(
        'sources', source_remaining, 'cezScan', cez_remaining,
        'normalization', normalization_remaining, 'ares', ares_remaining,
        'mapy', mapy_remaining, 'evaluation', evaluation_remaining
      ),
      'ratesPerMinute', jsonb_build_object(
        'normalization', normalization_rate * 60, 'ares', ares_rate * 60,
        'mapy', mapy_rate * 60, 'evaluation', evaluation_rate * 60
      ),
      'failedTaskCount', failed_count, 'queueErrorCount', queue_error_count,
      'providerAttentionCount', provider_attention_count,
      'calculation', 'critical-path-v1'
    )
  from final
  on conflict (singleton) do update set
    status = excluded.status,
    progress_percent = excluded.progress_percent,
    remaining_seconds = excluded.remaining_seconds,
    estimated_finish_at = excluded.estimated_finish_at,
    active_queue_count = excluded.active_queue_count,
    status_message = excluded.status_message,
    last_progress_at = excluded.last_progress_at,
    refreshed_at = excluded.refreshed_at,
    metadata = excluded.metadata
  returning jsonb_build_object(
    'status', status,
    'progressPercent', progress_percent,
    'remainingSeconds', remaining_seconds,
    'activeQueueCount', active_queue_count,
    'refreshedAt', refreshed_at
  ) into result;

  return result;
end;
$$;

revoke all on function public.refresh_complete_power_outage_global_progress_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_global_progress_snapshot()
  to service_role;

select public.refresh_complete_power_outage_global_progress_snapshot();

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_global_progress_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_global_progress_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_global_progress_snapshot();$job$
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
