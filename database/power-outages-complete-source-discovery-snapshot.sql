begin;

do $$
begin
  if to_regclass('public.complete_power_outage_source_discovery_overview') is null
    or to_regclass('public.complete_power_outage_address_targets') is null
    or to_regclass('public.complete_power_outage_target_lookups') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regprocedure('public.current_user_can_view_power_outages()') is null
  then
    raise exception 'Chybi zavislosti pro snapshot prubehu distributoru.';
  end if;
end
$$;

-- Nákladný živý výpočet zůstává dostupný pouze internímu obnovovacímu workeru.
create or replace view public.complete_power_outage_source_discovery_overview_live
with (security_invoker = true)
as
with eligible as (
  select
    outage.source,
    target.id as target_id,
    target.target_kind,
    target.created_at as target_created_at,
    case when target.target_kind = 'exact_number' then 'ares' else 'mapy' end as required_provider
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and target.target_kind in ('exact_number', 'street')
), progress as (
  select
    eligible.source,
    eligible.target_id,
    eligible.target_kind,
    eligible.target_created_at,
    lookup.lookup_status,
    lookup.finished_at,
    lookup.last_attempt_at
  from eligible
  left join public.complete_power_outage_target_lookups lookup
    on lookup.target_id = eligible.target_id
   and lookup.provider = eligible.required_provider
)
select
  source,
  count(*)::bigint as total_target_count,
  count(*) filter (where lookup_status in ('ready', 'not_found', 'skipped'))::bigint as completed_target_count,
  count(*) filter (where lookup_status is null or lookup_status = 'pending')::bigint as pending_target_count,
  count(*) filter (where lookup_status in ('error', 'needs_review'))::bigint as error_target_count,
  count(*) filter (where target_kind = 'exact_number')::bigint as exact_target_count,
  count(*) filter (where target_kind = 'street')::bigint as street_target_count,
  max(coalesce(finished_at, last_attempt_at)) as last_progress_at,
  count(*) filter (where target_kind = 'exact_number'
    and (lookup_status is null or lookup_status = 'pending'))::bigint as exact_pending_target_count,
  count(*) filter (where target_kind = 'street'
    and (lookup_status is null or lookup_status = 'pending'))::bigint as street_pending_target_count,
  max(coalesce(finished_at, last_attempt_at)) filter
    (where target_kind = 'exact_number') as exact_last_progress_at,
  max(coalesce(finished_at, last_attempt_at)) filter
    (where target_kind = 'street') as street_last_progress_at,
  min(target_created_at) filter (where target_kind = 'exact_number'
    and (lookup_status is null or lookup_status = 'pending')) as exact_oldest_pending_at,
  min(target_created_at) filter (where target_kind = 'street'
    and (lookup_status is null or lookup_status = 'pending')) as street_oldest_pending_at,
  count(*) filter (where target_kind = 'exact_number'
    and lookup_status in ('error', 'needs_review'))::bigint as exact_error_target_count,
  count(*) filter (where target_kind = 'street'
    and lookup_status in ('error', 'needs_review'))::bigint as street_error_target_count
from progress
group by source;

revoke all on table public.complete_power_outage_source_discovery_overview_live
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_overview_live
  to service_role;

create table if not exists public.complete_power_outage_source_discovery_snapshot (
  source text primary key,
  total_target_count bigint not null default 0,
  completed_target_count bigint not null default 0,
  pending_target_count bigint not null default 0,
  error_target_count bigint not null default 0,
  exact_target_count bigint not null default 0,
  street_target_count bigint not null default 0,
  last_progress_at timestamptz,
  exact_pending_target_count bigint not null default 0,
  street_pending_target_count bigint not null default 0,
  exact_last_progress_at timestamptz,
  street_last_progress_at timestamptz,
  exact_oldest_pending_at timestamptz,
  street_oldest_pending_at timestamptz,
  exact_error_target_count bigint not null default 0,
  street_error_target_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  constraint cpo_source_discovery_snapshot_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint cpo_source_discovery_snapshot_counts_check check (
    total_target_count >= 0
    and completed_target_count >= 0
    and pending_target_count >= 0
    and error_target_count >= 0
    and exact_target_count >= 0
    and street_target_count >= 0
    and exact_pending_target_count >= 0
    and street_pending_target_count >= 0
    and exact_error_target_count >= 0
    and street_error_target_count >= 0
    and completed_target_count + pending_target_count + error_target_count = total_target_count
    and exact_target_count + street_target_count = total_target_count
  )
);

alter table public.complete_power_outage_source_discovery_snapshot enable row level security;
drop policy if exists cpo_source_discovery_snapshot_authorized_read
  on public.complete_power_outage_source_discovery_snapshot;
create policy cpo_source_discovery_snapshot_authorized_read
  on public.complete_power_outage_source_discovery_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_source_discovery_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_snapshot
  to authenticated;
grant all on table public.complete_power_outage_source_discovery_snapshot
  to service_role;

create or replace function public.refresh_complete_power_outage_source_discovery_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  refreshed_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_source_discovery_snapshot')
  ) then
    return 0;
  end if;

  with sources(source) as (
    values ('cez'::text), ('egd'::text), ('pre'::text)
  )
  insert into public.complete_power_outage_source_discovery_snapshot (
    source, total_target_count, completed_target_count, pending_target_count,
    error_target_count, exact_target_count, street_target_count, last_progress_at,
    exact_pending_target_count, street_pending_target_count,
    exact_last_progress_at, street_last_progress_at,
    exact_oldest_pending_at, street_oldest_pending_at,
    exact_error_target_count, street_error_target_count, refreshed_at
  )
  select
    sources.source,
    coalesce(live.total_target_count, 0),
    coalesce(live.completed_target_count, 0),
    coalesce(live.pending_target_count, 0),
    coalesce(live.error_target_count, 0),
    coalesce(live.exact_target_count, 0),
    coalesce(live.street_target_count, 0),
    live.last_progress_at,
    coalesce(live.exact_pending_target_count, 0),
    coalesce(live.street_pending_target_count, 0),
    live.exact_last_progress_at,
    live.street_last_progress_at,
    live.exact_oldest_pending_at,
    live.street_oldest_pending_at,
    coalesce(live.exact_error_target_count, 0),
    coalesce(live.street_error_target_count, 0),
    now()
  from sources
  left join public.complete_power_outage_source_discovery_overview_live live
    on live.source = sources.source
  on conflict (source) do update set
    total_target_count = excluded.total_target_count,
    completed_target_count = excluded.completed_target_count,
    pending_target_count = excluded.pending_target_count,
    error_target_count = excluded.error_target_count,
    exact_target_count = excluded.exact_target_count,
    street_target_count = excluded.street_target_count,
    last_progress_at = excluded.last_progress_at,
    exact_pending_target_count = excluded.exact_pending_target_count,
    street_pending_target_count = excluded.street_pending_target_count,
    exact_last_progress_at = excluded.exact_last_progress_at,
    street_last_progress_at = excluded.street_last_progress_at,
    exact_oldest_pending_at = excluded.exact_oldest_pending_at,
    street_oldest_pending_at = excluded.street_oldest_pending_at,
    exact_error_target_count = excluded.exact_error_target_count,
    street_error_target_count = excluded.street_error_target_count,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_source_discovery_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_source_discovery_snapshot()
  to service_role;

-- První naplnění proběhne ještě nad živým pohledem. Veřejný pohled se přepne
-- až poté, takže migrace nemůže zpřístupnit prázdný panel.
select public.refresh_complete_power_outage_source_discovery_snapshot();

create or replace view public.complete_power_outage_source_discovery_overview
with (security_invoker = true)
as
select
  source,
  total_target_count,
  completed_target_count,
  pending_target_count,
  error_target_count,
  exact_target_count,
  street_target_count,
  last_progress_at,
  exact_pending_target_count,
  street_pending_target_count,
  exact_last_progress_at,
  street_last_progress_at,
  exact_oldest_pending_at,
  street_oldest_pending_at,
  exact_error_target_count,
  street_error_target_count
from public.complete_power_outage_source_discovery_snapshot;

revoke all on table public.complete_power_outage_source_discovery_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_overview
  to authenticated, service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_source_discovery_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_source_discovery_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_source_discovery_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'TABLE' as check_type, 'complete source discovery snapshot' as object_name,
  to_regclass('public.complete_power_outage_source_discovery_snapshot') is not null as is_correct
union all
select 'FUNCTION', 'refresh complete source discovery snapshot',
  to_regprocedure('public.refresh_complete_power_outage_source_discovery_snapshot()') is not null
union all
select 'VIEW', 'public source discovery overview reads snapshot',
  pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
    like '%complete_power_outage_source_discovery_snapshot%'
union all
select 'DATA', 'source discovery snapshot contains all distributors',
  (select count(*) = 3 from public.complete_power_outage_source_discovery_snapshot)
union all
select 'CRON', 'source discovery snapshot refresh every minute',
  exists (
    select 1 from cron.job
    where jobname = 'complete_source_discovery_snapshot_every_minute' and active
  )
union all
select 'GRANT', 'authenticated cannot refresh source discovery snapshot',
  not has_function_privilege('authenticated',
    'public.refresh_complete_power_outage_source_discovery_snapshot()', 'EXECUTE')
union all
select 'RLS', 'source discovery snapshot has RLS', coalesce((
  select relrowsecurity from pg_class
  where oid = 'public.complete_power_outage_source_discovery_snapshot'::regclass
), false)
union all
select 'ISOLATION', 'source discovery snapshot stays in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef(
    'public.refresh_complete_power_outage_source_discovery_snapshot()'::regprocedure)) = 0
order by check_type, object_name;
