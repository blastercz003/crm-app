begin;

-- Provozní pokrytí adres počítáme pouze pro aktuální odstávky v režimu
-- KOMPLETNÍ. Archivní a zrušené záznamy zůstávají auditně uložené, ale
-- neovlivňují průběh aktivní pracovní fronty.
create or replace view public.complete_power_outage_address_coverage_live
with (security_invoker = true)
as
with sources(source) as (
  values ('cez'::text), ('egd'::text), ('pre'::text)
), eligible_addresses as (
  select address.*, outage.source
  from public.complete_power_outage_addresses address
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
), address_counts as (
  select
    address.source,
    count(*)::bigint as total_count,
    count(*) filter (where address.normalization_version >= 2)::bigint as normalized_count,
    count(*) filter (where address.normalization_version >= 2 and address.address_scope = 'exact')::bigint as exact_count,
    count(*) filter (where address.normalization_version >= 2 and address.address_scope in ('street', 'municipality'))::bigint as broad_count,
    count(*) filter (where address.normalization_version >= 2 and address.address_scope = 'unresolved')::bigint as unresolved_count,
    count(*) filter (where address.normalization_version < 2)::bigint as pending_count,
    count(*) filter (where address.lookup_status = 'error'
      or (address.lookup_status = 'processing' and address.processing_expires_at <= now()))::bigint as error_count,
    count(*) filter (where address.lookup_status = 'needs_review')::bigint as review_count,
    count(*) filter (where (address.normalization_version >= 2 and address.address_scope = 'unresolved')
      or address.lookup_status in ('error', 'needs_review')
      or (address.lookup_status = 'processing' and address.processing_expires_at <= now()))::bigint as attention_count
  from eligible_addresses address
  group by address.source
), target_counts as (
  select
    address.source,
    count(target.id)::bigint as target_count,
    count(target.id) filter (where target.target_kind = 'exact_number')::bigint as exact_target_count,
    count(target.id) filter (where target.target_kind = 'street')::bigint as street_target_count,
    count(target.id) filter (where target.target_kind = 'municipality')::bigint as municipality_target_count
  from eligible_addresses address
  left join public.complete_power_outage_address_targets target
    on target.outage_address_id = address.id
  group by address.source
)
select
  sources.source,
  coalesce(address_counts.total_count, 0)::bigint as total_count,
  coalesce(address_counts.normalized_count, 0)::bigint as normalized_count,
  coalesce(address_counts.exact_count, 0)::bigint as exact_count,
  coalesce(address_counts.broad_count, 0)::bigint as broad_count,
  coalesce(address_counts.unresolved_count, 0)::bigint as unresolved_count,
  coalesce(address_counts.pending_count, 0)::bigint as pending_count,
  coalesce(address_counts.error_count, 0)::bigint as error_count,
  coalesce(address_counts.review_count, 0)::bigint as review_count,
  coalesce(address_counts.attention_count, 0)::bigint as attention_count,
  coalesce(target_counts.target_count, 0)::bigint as target_count,
  coalesce(target_counts.exact_target_count, 0)::bigint as exact_target_count,
  coalesce(target_counts.street_target_count, 0)::bigint as street_target_count,
  coalesce(target_counts.municipality_target_count, 0)::bigint as municipality_target_count
from sources
left join address_counts on address_counts.source = sources.source
left join target_counts on target_counts.source = sources.source;

revoke all on table public.complete_power_outage_address_coverage_live
  from public, anon, authenticated;
grant select on table public.complete_power_outage_address_coverage_live
  to service_role;

create table if not exists public.complete_power_outage_address_coverage_snapshot (
  source text primary key,
  total_count bigint not null default 0,
  normalized_count bigint not null default 0,
  exact_count bigint not null default 0,
  broad_count bigint not null default 0,
  unresolved_count bigint not null default 0,
  pending_count bigint not null default 0,
  error_count bigint not null default 0,
  review_count bigint not null default 0,
  attention_count bigint not null default 0,
  target_count bigint not null default 0,
  exact_target_count bigint not null default 0,
  street_target_count bigint not null default 0,
  municipality_target_count bigint not null default 0,
  refreshed_at timestamptz not null default now(),
  constraint cpo_address_coverage_snapshot_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint cpo_address_coverage_snapshot_counts_check check (
    total_count >= 0 and normalized_count >= 0 and exact_count >= 0
    and broad_count >= 0 and unresolved_count >= 0 and pending_count >= 0
    and error_count >= 0 and review_count >= 0 and attention_count >= 0
    and attention_count <= total_count and target_count >= 0
    and exact_target_count >= 0 and street_target_count >= 0
    and municipality_target_count >= 0
    and normalized_count + pending_count = total_count
    and exact_count + broad_count + unresolved_count = normalized_count
    and exact_target_count + street_target_count + municipality_target_count = target_count
  )
);

alter table public.complete_power_outage_address_coverage_snapshot
  add column if not exists attention_count bigint not null default 0;
alter table public.complete_power_outage_address_coverage_snapshot
  drop constraint if exists cpo_address_coverage_snapshot_counts_check;
alter table public.complete_power_outage_address_coverage_snapshot
  add constraint cpo_address_coverage_snapshot_counts_check check (
    total_count >= 0 and normalized_count >= 0 and exact_count >= 0
    and broad_count >= 0 and unresolved_count >= 0 and pending_count >= 0
    and error_count >= 0 and review_count >= 0 and attention_count >= 0
    and attention_count <= total_count and target_count >= 0
    and exact_target_count >= 0 and street_target_count >= 0
    and municipality_target_count >= 0
    and normalized_count + pending_count = total_count
    and exact_count + broad_count + unresolved_count = normalized_count
    and exact_target_count + street_target_count + municipality_target_count = target_count
  );

alter table public.complete_power_outage_address_coverage_snapshot enable row level security;
drop policy if exists cpo_address_coverage_snapshot_authorized_read
  on public.complete_power_outage_address_coverage_snapshot;
create policy cpo_address_coverage_snapshot_authorized_read
  on public.complete_power_outage_address_coverage_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_address_coverage_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_address_coverage_snapshot
  to authenticated;
grant all on table public.complete_power_outage_address_coverage_snapshot
  to service_role;

create or replace function public.refresh_complete_power_outage_address_coverage_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_coverage_snapshot')
  );

  insert into public.complete_power_outage_address_coverage_snapshot (
    source, total_count, normalized_count, exact_count, broad_count,
    unresolved_count, pending_count, error_count, review_count, attention_count,
    target_count, exact_target_count, street_target_count,
    municipality_target_count, refreshed_at
  )
  select
    live.source, live.total_count, live.normalized_count, live.exact_count,
    live.broad_count, live.unresolved_count, live.pending_count,
    live.error_count, live.review_count, live.attention_count, live.target_count,
    live.exact_target_count, live.street_target_count,
    live.municipality_target_count, now()
  from public.complete_power_outage_address_coverage_live live
  on conflict (source) do update set
    total_count = excluded.total_count,
    normalized_count = excluded.normalized_count,
    exact_count = excluded.exact_count,
    broad_count = excluded.broad_count,
    unresolved_count = excluded.unresolved_count,
    pending_count = excluded.pending_count,
    error_count = excluded.error_count,
    review_count = excluded.review_count,
    attention_count = excluded.attention_count,
    target_count = excluded.target_count,
    exact_target_count = excluded.exact_target_count,
    street_target_count = excluded.street_target_count,
    municipality_target_count = excluded.municipality_target_count,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_address_coverage_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_address_coverage_snapshot()
  to service_role;

select public.refresh_complete_power_outage_address_coverage_snapshot();

create or replace view public.complete_power_outage_address_coverage
with (security_invoker = true)
as
select
  source, total_count, normalized_count, exact_count, broad_count,
  unresolved_count, pending_count, error_count, review_count, attention_count,
  target_count, exact_target_count, street_target_count,
  municipality_target_count, refreshed_at
from public.complete_power_outage_address_coverage_snapshot;

revoke all on table public.complete_power_outage_address_coverage
  from public, anon, authenticated;
grant select on table public.complete_power_outage_address_coverage
  to authenticated, service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_address_coverage_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_address_coverage_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_address_coverage_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;
