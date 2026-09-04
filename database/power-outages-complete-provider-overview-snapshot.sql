begin;

-- Expensive aggregation is kept behind a service-only refresh function. The
-- authenticated UI reads three small snapshot rows and no longer scans the
-- entire provider queue while opening the page.
create or replace view public.complete_power_outage_provider_overview_live
with (security_invoker = true)
as
with counts as (
  select
    source_progress.provider,
    sum(source_progress.found_target_count) as ready_count,
    sum(source_progress.pending_target_count) as pending_count,
    sum(source_progress.not_found_target_count) as not_found_count
  from public.complete_power_outage_source_provider_overview source_progress
  group by source_progress.provider
), active_errors as (
  select
    provider_errors.provider,
    count(*) filter (where provider_errors.lookup_status = 'error') as retryable_error_count,
    count(*) filter (where provider_errors.lookup_status = 'needs_review') as review_error_count
  from public.complete_power_outage_active_provider_errors provider_errors
  group by provider_errors.provider
)
select
  quota.provider,
  coalesce(counts.ready_count, 0)::integer as ready_count,
  coalesce(counts.pending_count, 0)::integer as pending_count,
  coalesce(counts.not_found_count, 0)::integer as not_found_count,
  (coalesce(active_errors.retryable_error_count, 0) + coalesce(active_errors.review_error_count, 0))::integer as error_count,
  quota.minute_request_count,
  quota.day_request_count,
  quota.last_request_at,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.total_credit_count
    else 0
  end::integer as monthly_credit_count,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.complete_credit_count
    else 0
  end::integer as complete_credit_count,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.markets_credit_count
    else 0
  end::integer as markets_credit_count,
  coalesce(active_errors.retryable_error_count, 0)::integer as retryable_error_count,
  coalesce(active_errors.review_error_count, 0)::integer as review_error_count
from public.complete_power_outage_provider_quota quota
left join counts on counts.provider = quota.provider
left join active_errors on active_errors.provider = quota.provider
left join public.power_outage_mapy_credit_usage usage on usage.provider = quota.provider
where quota.provider in ('ares', 'mapy', 'google');

revoke all on table public.complete_power_outage_provider_overview_live
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview_live to service_role;

create table if not exists public.complete_power_outage_provider_overview_snapshot (
  provider text primary key,
  ready_count integer not null default 0,
  pending_count integer not null default 0,
  not_found_count integer not null default 0,
  error_count integer not null default 0,
  minute_request_count integer not null default 0,
  day_request_count integer not null default 0,
  last_request_at timestamptz,
  monthly_credit_count integer not null default 0,
  complete_credit_count integer not null default 0,
  markets_credit_count integer not null default 0,
  retryable_error_count integer not null default 0,
  review_error_count integer not null default 0,
  refreshed_at timestamptz not null default now(),
  constraint cpo_provider_overview_snapshot_provider_check
    check (provider in ('ares', 'mapy', 'google')),
  constraint cpo_provider_overview_snapshot_counts_check check (
    ready_count >= 0 and pending_count >= 0 and not_found_count >= 0
    and error_count >= 0 and minute_request_count >= 0 and day_request_count >= 0
    and monthly_credit_count >= 0 and complete_credit_count >= 0
    and markets_credit_count >= 0 and retryable_error_count >= 0
    and review_error_count >= 0
  )
);

alter table public.complete_power_outage_provider_overview_snapshot enable row level security;
drop policy if exists cpo_provider_overview_snapshot_authorized_read
  on public.complete_power_outage_provider_overview_snapshot;
create policy cpo_provider_overview_snapshot_authorized_read
  on public.complete_power_outage_provider_overview_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_provider_overview_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview_snapshot to authenticated;
grant all on table public.complete_power_outage_provider_overview_snapshot to service_role;

create or replace function public.refresh_complete_power_outage_provider_overview_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_provider_overview_snapshot')
  );

  insert into public.complete_power_outage_provider_overview_snapshot (
    provider, ready_count, pending_count, not_found_count, error_count,
    minute_request_count, day_request_count, last_request_at,
    monthly_credit_count, complete_credit_count, markets_credit_count,
    retryable_error_count, review_error_count, refreshed_at
  )
  select
    live.provider, live.ready_count, live.pending_count, live.not_found_count,
    live.error_count, live.minute_request_count, live.day_request_count,
    live.last_request_at, live.monthly_credit_count, live.complete_credit_count,
    live.markets_credit_count, live.retryable_error_count,
    live.review_error_count, now()
  from public.complete_power_outage_provider_overview_live live
  on conflict (provider) do update set
    ready_count = excluded.ready_count,
    pending_count = excluded.pending_count,
    not_found_count = excluded.not_found_count,
    error_count = excluded.error_count,
    minute_request_count = excluded.minute_request_count,
    day_request_count = excluded.day_request_count,
    last_request_at = excluded.last_request_at,
    monthly_credit_count = excluded.monthly_credit_count,
    complete_credit_count = excluded.complete_credit_count,
    markets_credit_count = excluded.markets_credit_count,
    retryable_error_count = excluded.retryable_error_count,
    review_error_count = excluded.review_error_count,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_provider_overview_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_provider_overview_snapshot()
  to service_role;

-- Seed before replacing the public overview with its constant-time projection.
select public.refresh_complete_power_outage_provider_overview_snapshot();

create or replace view public.complete_power_outage_provider_overview
with (security_invoker = true)
as
select
  snapshot.provider,
  snapshot.ready_count,
  snapshot.pending_count,
  snapshot.not_found_count,
  snapshot.error_count,
  snapshot.minute_request_count,
  snapshot.day_request_count,
  snapshot.last_request_at,
  snapshot.monthly_credit_count,
  snapshot.complete_credit_count,
  snapshot.markets_credit_count,
  snapshot.retryable_error_count,
  snapshot.review_error_count
from public.complete_power_outage_provider_overview_snapshot snapshot;

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview
  to authenticated, service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_provider_overview_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_provider_overview_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_provider_overview_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'TABLE' as check_type, 'complete provider overview snapshot' as object_name,
  to_regclass('public.complete_power_outage_provider_overview_snapshot') is not null as is_correct
union all
select 'FUNCTION', 'refresh complete provider overview snapshot',
  to_regprocedure('public.refresh_complete_power_outage_provider_overview_snapshot()') is not null
union all
select 'VIEW', 'public provider overview reads snapshot',
  pg_get_viewdef('public.complete_power_outage_provider_overview'::regclass, true)
    like '%complete_power_outage_provider_overview_snapshot%'
union all
select 'DATA', 'snapshot contains all providers',
  (select count(*) = 3 from public.complete_power_outage_provider_overview_snapshot)
union all
select 'CRON', 'provider snapshot refresh every minute',
  exists (
    select 1 from cron.job
    where jobname = 'complete_provider_overview_snapshot_every_minute'
      and active
  )
union all
select 'RLS', 'provider snapshot has RLS',
  coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_provider_overview_snapshot'::regclass
  ), false)
union all
select 'ISOLATION', 'snapshot does not reference MARKET registry',
  pg_get_functiondef(
    'public.refresh_complete_power_outage_provider_overview_snapshot()'::regprocedure
  ) not ilike '%power_outage_registry%';
