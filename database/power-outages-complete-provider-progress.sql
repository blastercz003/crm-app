begin;

-- Jediná definice aktuální providerové fronty pro všechny zdroje KOMPLETNÍ.
-- ČEZ (legacy nebo NEW po přepnutí), EG.D i PRE vstupují přes stejné tabulky.
create or replace view public.complete_power_outage_source_provider_overview_live
with (security_invoker = true)
as
with providers(provider) as (
  values ('ares'::text), ('mapy'::text), ('google'::text)
), eligible as (
  select outage.source, providers.provider, target.id as target_id
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  cross join providers
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
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

-- Aktivní chyby používají stejný časový rozsah jako skutečná fronta.
create or replace view public.complete_power_outage_active_provider_errors
with (security_invoker = true)
as
select
  lookup.id, lookup.target_id, lookup.provider, lookup.lookup_status,
  lookup.attempt_count, lookup.last_attempt_at, lookup.next_attempt_at,
  lookup.last_error_code, lookup.last_error_message,
  target.target_kind, target.query_text,
  outage.source, outage.starts_at, outage.ends_at
from public.complete_power_outage_target_lookups lookup
join public.complete_power_outage_address_targets target
  on target.id = lookup.target_id
join public.complete_power_outage_addresses address
  on address.id = target.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id
where lookup.lookup_status in ('error', 'needs_review')
  and outage.source_status in ('scheduled', 'active')
  and outage.ends_at >= now()
  and (
    (lookup.provider = 'ares' and target.target_kind = 'exact_number')
    or (lookup.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
  );

revoke all on table public.complete_power_outage_active_provider_errors
  from public, anon, authenticated;
grant select on table public.complete_power_outage_active_provider_errors
  to authenticated, service_role;

-- Opravné akce musí mít totožný rozsah jako fronta a stavový přehled.
create or replace function public.reset_complete_power_outage_provider_errors(
  requested_provider text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  safe_provider text := lower(btrim(coalesce(requested_provider, '')));
begin
  if safe_provider not in ('ares', 'mapy', 'google') then
    raise exception 'Neznámý poskytovatel: %', requested_provider;
  end if;

  update public.complete_power_outage_target_lookups lookup
  set lookup_status = 'error', attempt_count = 0, next_attempt_at = now(),
      finished_at = null,
      last_error_code = 'COMPLETE_PROVIDER_MANUAL_RETRY',
      metadata = coalesce(lookup.metadata, '{}'::jsonb)
        || jsonb_build_object('manualRetryRequestedAt', now())
  from public.complete_power_outage_address_targets target,
       public.complete_power_outage_addresses address,
       public.complete_power_outages outage
  where lookup.target_id = target.id
    and target.outage_address_id = address.id
    and address.outage_id = outage.id
    and lookup.provider = safe_provider
    and lookup.lookup_status in ('error', 'needs_review')
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and (
      (safe_provider = 'ares' and target.target_kind = 'exact_number')
      or (safe_provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.reset_complete_power_outage_provider_errors(text)
  from public, anon, authenticated;
grant execute on function public.reset_complete_power_outage_provider_errors(text)
  to service_role;

create or replace function public.skip_complete_power_outage_provider_review_errors(
  requested_provider text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  safe_provider text := lower(btrim(coalesce(requested_provider, '')));
begin
  if safe_provider not in ('ares', 'mapy') then
    raise exception 'Přeskočení není pro poskytovatele % povoleno.', requested_provider;
  end if;

  update public.complete_power_outage_target_lookups lookup
  set lookup_status = 'skipped', next_attempt_at = null, finished_at = now(),
      metadata = coalesce(lookup.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'manualSkipRequestedAt', now(),
          'manualSkipPreviousErrorCode', lookup.last_error_code,
          'manualSkipPreviousErrorMessage', lookup.last_error_message,
          'manualSkipAttemptCount', lookup.attempt_count
        )
  from public.complete_power_outage_address_targets target,
       public.complete_power_outage_addresses address,
       public.complete_power_outages outage
  where lookup.target_id = target.id
    and target.outage_address_id = address.id
    and address.outage_id = outage.id
    and lookup.provider = safe_provider
    and lookup.lookup_status = 'needs_review'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and (
      (safe_provider = 'ares' and target.target_kind = 'exact_number')
      or (safe_provider = 'mapy' and target.target_kind in ('exact_number', 'street'))
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.skip_complete_power_outage_provider_review_errors(text)
  from public, anon, authenticated;
grant execute on function public.skip_complete_power_outage_provider_review_errors(text)
  to service_role;

-- Nejdříve aktualizujeme devět zdrojových snapshotů, ze kterých se skládá
-- souhrnný průběh jednotlivých providerů.
select public.refresh_complete_power_outage_source_provider_overview_snapshot();

create or replace view public.complete_power_outage_provider_overview_live
with (security_invoker = true)
as
with counts as (
  select
    source_progress.provider,
    sum(source_progress.found_target_count) as ready_count,
    sum(source_progress.pending_target_count) as pending_count,
    sum(source_progress.not_found_target_count) as not_found_count,
    sum(source_progress.total_target_count) as total_target_count
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
  case when quota.provider = 'mapy'
    and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
    then usage.total_credit_count else 0 end::integer as monthly_credit_count,
  case when quota.provider = 'mapy'
    and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
    then usage.complete_credit_count else 0 end::integer as complete_credit_count,
  case when quota.provider = 'mapy'
    and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
    then usage.markets_credit_count else 0 end::integer as markets_credit_count,
  coalesce(active_errors.retryable_error_count, 0)::integer as retryable_error_count,
  coalesce(active_errors.review_error_count, 0)::integer as review_error_count,
  coalesce(counts.total_target_count, 0)::integer as total_target_count,
  greatest(0, coalesce(counts.total_target_count, 0) - coalesce(counts.pending_count, 0))::integer as processed_target_count,
  coalesce(counts.pending_count, 0)::integer as remaining_target_count
from public.complete_power_outage_provider_quota quota
left join counts on counts.provider = quota.provider
left join active_errors on active_errors.provider = quota.provider
left join public.power_outage_mapy_credit_usage usage on usage.provider = quota.provider
where quota.provider in ('ares', 'mapy', 'google');

revoke all on table public.complete_power_outage_provider_overview_live
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview_live
  to service_role;

alter table public.complete_power_outage_provider_overview_snapshot
  add column if not exists total_target_count integer not null default 0,
  add column if not exists processed_target_count integer not null default 0,
  add column if not exists remaining_target_count integer not null default 0;

alter table public.complete_power_outage_provider_overview_snapshot
  drop constraint if exists cpo_provider_overview_snapshot_counts_check;
alter table public.complete_power_outage_provider_overview_snapshot
  add constraint cpo_provider_overview_snapshot_counts_check check (
    ready_count >= 0 and pending_count >= 0 and not_found_count >= 0
    and error_count >= 0 and minute_request_count >= 0 and day_request_count >= 0
    and monthly_credit_count >= 0 and complete_credit_count >= 0
    and markets_credit_count >= 0 and retryable_error_count >= 0
    and review_error_count >= 0 and total_target_count >= 0
    and processed_target_count >= 0 and remaining_target_count >= 0
    and processed_target_count <= total_target_count
    and remaining_target_count <= total_target_count
    and processed_target_count + remaining_target_count = total_target_count
  );

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
    retryable_error_count, review_error_count,
    total_target_count, processed_target_count, remaining_target_count,
    refreshed_at
  )
  select
    live.provider, live.ready_count, live.pending_count, live.not_found_count,
    live.error_count, live.minute_request_count, live.day_request_count,
    live.last_request_at, live.monthly_credit_count, live.complete_credit_count,
    live.markets_credit_count, live.retryable_error_count,
    live.review_error_count, live.total_target_count,
    live.processed_target_count, live.remaining_target_count, now()
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
    total_target_count = excluded.total_target_count,
    processed_target_count = excluded.processed_target_count,
    remaining_target_count = excluded.remaining_target_count,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_provider_overview_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_provider_overview_snapshot()
  to service_role;

select public.refresh_complete_power_outage_provider_overview_snapshot();

create or replace view public.complete_power_outage_provider_overview
with (security_invoker = true)
as
select
  snapshot.provider, snapshot.ready_count, snapshot.pending_count,
  snapshot.not_found_count, snapshot.error_count,
  snapshot.minute_request_count, snapshot.day_request_count,
  snapshot.last_request_at, snapshot.monthly_credit_count,
  snapshot.complete_credit_count, snapshot.markets_credit_count,
  snapshot.retryable_error_count, snapshot.review_error_count,
  snapshot.total_target_count, snapshot.processed_target_count,
  snapshot.remaining_target_count
from public.complete_power_outage_provider_overview_snapshot snapshot;

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

select 'COLUMN' as check_type, 'provider progress snapshot fields' as object_name,
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public'
     and table_name = 'complete_power_outage_provider_overview_snapshot'
     and column_name in ('total_target_count', 'processed_target_count', 'remaining_target_count')) as is_correct
union all
select 'DATA', 'provider progress is internally consistent',
  not exists (
    select 1 from public.complete_power_outage_provider_overview_snapshot
    where processed_target_count + remaining_target_count <> total_target_count
  )
union all
select 'SCOPE', 'provider progress includes CEZ EGD and PRE',
  (select count(distinct source) = 3
   from public.complete_power_outage_source_provider_overview_snapshot
   where source in ('cez', 'egd', 'pre'))
union all
select 'SAFETY', 'provider errors do not reduce processed progress',
  not exists (
    select 1 from public.complete_power_outage_provider_overview_snapshot
    where processed_target_count
      <> greatest(0, total_target_count - pending_count)
  )
union all
select 'ISOLATION', 'provider progress does not reference MARKET outage tables',
  pg_get_viewdef('public.complete_power_outage_provider_overview_live'::regclass, true)
    not ilike '%market_power_outage%'
union all
select 'GRANT', 'authenticated reads snapshot only',
  has_table_privilege('authenticated', 'public.complete_power_outage_provider_overview', 'SELECT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_provider_overview_live', 'SELECT')
order by check_type, object_name;
