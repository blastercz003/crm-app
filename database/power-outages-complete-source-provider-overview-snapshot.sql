begin;

-- The distributor diagnostic needs only three rows, but the former public
-- view aggregated the complete active target queue on every modal open.
-- Keep that calculation service-only and publish a tiny, RLS-protected
-- snapshot keyed by distributor and provider.
create or replace view public.complete_power_outage_source_provider_overview_live
with (security_invoker = true)
as
with providers(provider) as (
  values ('ares'::text), ('mapy'::text), ('google'::text)
), eligible as (
  select
    outage.source,
    providers.provider,
    target.id as target_id
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  cross join providers
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and (
      (providers.provider = 'ares' and target.target_kind = 'exact_number')
      or (providers.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
    )
)
select
  eligible.source,
  eligible.provider,
  count(*)::bigint as total_target_count,
  count(*) filter (where lookup.lookup_status in ('ready', 'not_found', 'skipped'))::bigint as completed_target_count,
  count(*) filter (where lookup.id is null or lookup.lookup_status = 'pending')::bigint as pending_target_count,
  count(*) filter (where lookup.lookup_status = 'ready')::bigint as found_target_count,
  count(*) filter (where lookup.lookup_status = 'not_found')::bigint as not_found_target_count,
  count(*) filter (where lookup.lookup_status in ('error', 'needs_review'))::bigint as error_target_count,
  max(coalesce(lookup.finished_at, lookup.last_attempt_at)) as last_progress_at
from eligible
left join public.complete_power_outage_target_lookups lookup
  on lookup.target_id = eligible.target_id
 and lookup.provider = eligible.provider
group by eligible.source, eligible.provider;

revoke all on table public.complete_power_outage_source_provider_overview_live
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_provider_overview_live
  to service_role;

create table if not exists public.complete_power_outage_source_provider_overview_snapshot (
  source text not null,
  provider text not null,
  total_target_count bigint not null default 0,
  completed_target_count bigint not null default 0,
  pending_target_count bigint not null default 0,
  found_target_count bigint not null default 0,
  not_found_target_count bigint not null default 0,
  error_target_count bigint not null default 0,
  last_progress_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (source, provider),
  constraint cpo_source_provider_snapshot_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint cpo_source_provider_snapshot_provider_check
    check (provider in ('ares', 'mapy', 'google')),
  constraint cpo_source_provider_snapshot_counts_check check (
    total_target_count >= 0 and completed_target_count >= 0
    and pending_target_count >= 0 and found_target_count >= 0
    and not_found_target_count >= 0 and error_target_count >= 0
  )
);

alter table public.complete_power_outage_source_provider_overview_snapshot
  enable row level security;
drop policy if exists cpo_source_provider_snapshot_authorized_read
  on public.complete_power_outage_source_provider_overview_snapshot;
create policy cpo_source_provider_snapshot_authorized_read
  on public.complete_power_outage_source_provider_overview_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_source_provider_overview_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_provider_overview_snapshot
  to authenticated;
grant all on table public.complete_power_outage_source_provider_overview_snapshot
  to service_role;

create or replace function public.refresh_complete_power_outage_source_provider_overview_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_source_provider_overview_snapshot')
  );

  insert into public.complete_power_outage_source_provider_overview_snapshot (
    source, provider, total_target_count, completed_target_count,
    pending_target_count, found_target_count, not_found_target_count,
    error_target_count, last_progress_at, refreshed_at
  )
  with sources(source) as (
    values ('cez'::text), ('egd'::text), ('pre'::text)
  ), providers(provider) as (
    values ('ares'::text), ('mapy'::text), ('google'::text)
  )
  select
    sources.source,
    providers.provider,
    coalesce(live.total_target_count, 0),
    coalesce(live.completed_target_count, 0),
    coalesce(live.pending_target_count, 0),
    coalesce(live.found_target_count, 0),
    coalesce(live.not_found_target_count, 0),
    coalesce(live.error_target_count, 0),
    live.last_progress_at,
    now()
  from sources
  cross join providers
  left join public.complete_power_outage_source_provider_overview_live live
    on live.source = sources.source
   and live.provider = providers.provider
  on conflict (source, provider) do update set
    total_target_count = excluded.total_target_count,
    completed_target_count = excluded.completed_target_count,
    pending_target_count = excluded.pending_target_count,
    found_target_count = excluded.found_target_count,
    not_found_target_count = excluded.not_found_target_count,
    error_target_count = excluded.error_target_count,
    last_progress_at = excluded.last_progress_at,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_source_provider_overview_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_source_provider_overview_snapshot()
  to service_role;

-- Seed all nine rows before switching the authenticated view.
select public.refresh_complete_power_outage_source_provider_overview_snapshot();

create or replace view public.complete_power_outage_source_provider_overview
with (security_invoker = true)
as
select
  snapshot.source,
  snapshot.provider,
  snapshot.total_target_count,
  snapshot.completed_target_count,
  snapshot.pending_target_count,
  snapshot.found_target_count,
  snapshot.not_found_target_count,
  snapshot.error_target_count,
  snapshot.last_progress_at
from public.complete_power_outage_source_provider_overview_snapshot snapshot;

revoke all on table public.complete_power_outage_source_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_provider_overview
  to authenticated, service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_source_provider_overview_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_source_provider_overview_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_source_provider_overview_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'TABLE' as check_type, 'complete source provider overview snapshot' as object_name,
  to_regclass('public.complete_power_outage_source_provider_overview_snapshot') is not null as is_correct
union all
select 'FUNCTION', 'refresh complete source provider snapshot',
  to_regprocedure('public.refresh_complete_power_outage_source_provider_overview_snapshot()') is not null
union all
select 'VIEW', 'source provider overview reads snapshot',
  pg_get_viewdef('public.complete_power_outage_source_provider_overview'::regclass, true)
    like '%complete_power_outage_source_provider_overview_snapshot%'
union all
select 'DATA', 'snapshot contains all source provider pairs',
  (select count(*) = 9 from public.complete_power_outage_source_provider_overview_snapshot)
union all
select 'CRON', 'source provider snapshot refresh every minute',
  exists (
    select 1 from cron.job
    where jobname = 'complete_source_provider_overview_snapshot_every_minute'
      and active
  )
union all
select 'RLS', 'source provider snapshot has RLS',
  coalesce((
    select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_source_provider_overview_snapshot'::regclass
  ), false)
union all
select 'ISOLATION', 'source provider snapshot does not reference MARKET registry',
  pg_get_functiondef(
    'public.refresh_complete_power_outage_source_provider_overview_snapshot()'::regprocedure
  ) not ilike '%power_outage_registry%';
