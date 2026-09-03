begin;

alter table public.complete_power_outage_target_lookups
  drop constraint if exists cpo_target_lookups_status_check;
alter table public.complete_power_outage_target_lookups
  add constraint cpo_target_lookups_status_check check (
    lookup_status in ('pending', 'ready', 'not_found', 'error', 'needs_review', 'skipped')
  );

-- Aktivní chyby jsou oddělené od historického auditu. Zdrojová tabulka se
-- nemaže; pohled pouze omezuje provozní UI na prioritní aktuální odstávky.
create or replace view public.complete_power_outage_active_provider_errors
with (security_invoker = true)
as
select
  lookup.id,
  lookup.target_id,
  lookup.provider,
  lookup.lookup_status,
  lookup.attempt_count,
  lookup.last_attempt_at,
  lookup.next_attempt_at,
  lookup.last_error_code,
  lookup.last_error_message,
  target.target_kind,
  target.query_text,
  outage.source,
  outage.starts_at,
  outage.ends_at
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
  and outage.starts_at <= now() + interval '30 days'
  and (
    (lookup.provider = 'ares' and target.target_kind = 'exact_number')
    or (lookup.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
  );

revoke all on table public.complete_power_outage_active_provider_errors
  from public, anon, authenticated;
grant select on table public.complete_power_outage_active_provider_errors
  to authenticated, service_role;

-- Opravný zásah resetuje pouze chyby aktuálních odstávek daného providera.
-- Historické chyby zůstávají beze změny pro audit.
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
  set lookup_status = 'error',
      attempt_count = 0,
      next_attempt_at = now(),
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
    and outage.starts_at <= now() + interval '30 days'
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

-- Fronta vrací i informaci, zda jde o retry. Aplikace díky tomu pustí do
-- sedmipoložkové dávky nejvýše dva opakované cíle a většinu ponechá novým.
drop function if exists public.get_complete_power_outage_discovery_targets(text, integer);
create function public.get_complete_power_outage_discovery_targets(
  requested_provider text,
  requested_limit integer default 1000
)
returns table (
  id uuid,
  outage_address_id uuid,
  target_kind text,
  municipality text,
  town_part text,
  street text,
  number_token text,
  query_text text,
  latitude double precision,
  longitude double precision,
  lookup_status text
)
language sql
security definer
set search_path = ''
stable
as $$
  with eligible as (
    select
      target.id,
      target.outage_address_id,
      target.target_kind,
      target.municipality,
      target.town_part,
      target.street,
      target.number_token,
      target.query_text,
      target.latitude,
      target.longitude,
      lookup.lookup_status,
      outage.source,
      case when lookup.lookup_status = 'error' then 0 else 1 end as retry_priority,
      case
        when outage.starts_at >= now() + interval '7 days'
         and outage.starts_at <= now() + interval '30 days' then 0
        when outage.starts_at >= now() + interval '2 days'
         and outage.starts_at < now() + interval '7 days' then 1
        when outage.starts_at < now() + interval '2 days' then 2
        else 3
      end as business_priority,
      case target.target_kind
        when 'exact_number' then 0
        when 'street' then 1
        else 2
      end as precision_priority,
      outage.starts_at,
      target.lookup_priority,
      target.created_at
    from public.complete_power_outage_address_targets target
    join public.complete_power_outage_addresses address
      on address.id = target.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    left join public.complete_power_outage_target_lookups lookup
      on lookup.target_id = target.id
     and lookup.provider = lower(btrim(requested_provider))
    where lower(btrim(requested_provider)) in ('ares', 'mapy', 'google')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and (
        (lower(btrim(requested_provider)) = 'ares' and target.target_kind = 'exact_number')
        or (lower(btrim(requested_provider)) in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
      )
      and (
        lookup.id is null
        or (
          lookup.lookup_status = 'error'
          and (lookup.next_attempt_at is null or lookup.next_attempt_at <= now())
        )
      )
  ), ranked as (
    select eligible.*,
      row_number() over (
        partition by eligible.source
        order by
          eligible.retry_priority,
          eligible.business_priority,
          eligible.precision_priority,
          eligible.lookup_priority,
          eligible.starts_at,
          eligible.created_at,
          eligible.id
      ) as source_position,
      row_number() over (
        partition by (eligible.lookup_status = 'error')
        order by
          eligible.business_priority,
          eligible.precision_priority,
          eligible.starts_at,
          eligible.created_at,
          eligible.id
      ) as queue_kind_position
    from eligible
  )
  select
    ranked.id,
    ranked.outage_address_id,
    ranked.target_kind,
    ranked.municipality,
    ranked.town_part,
    ranked.street,
    ranked.number_token,
    ranked.query_text,
    ranked.latitude,
    ranked.longitude,
    ranked.lookup_status
  from ranked
  where ranked.lookup_status is null
     or ranked.queue_kind_position <= least(50, greatest(3, coalesce(requested_limit, 1000) / 10))
  order by
    ranked.source_position,
    case ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    ranked.retry_priority,
    ranked.business_priority,
    ranked.precision_priority,
    ranked.starts_at,
    ranked.created_at,
    ranked.id
  limit least(5000, greatest(1, coalesce(requested_limit, 1000)));
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

-- Souhrnný badge používá jen aktivní chyby; ostatní statistiky zůstávají
-- kumulativní. Měsíční kreditní údaje pocházejí ze společného čítače.
create or replace view public.complete_power_outage_provider_overview
with (security_invoker = true)
as
select
  quota.provider,
  coalesce(counts.ready_count, 0)::integer as ready_count,
  coalesce(counts.pending_count, 0)::integer as pending_count,
  coalesce(counts.not_found_count, 0)::integer as not_found_count,
  coalesce(active_errors.error_count, 0)::integer as error_count,
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
  end::integer as markets_credit_count
from public.complete_power_outage_provider_quota quota
left join lateral (
  select
    count(*) filter (where lookup.lookup_status = 'ready') as ready_count,
    count(*) filter (where lookup.lookup_status = 'pending') as pending_count,
    count(*) filter (where lookup.lookup_status = 'not_found') as not_found_count
  from public.complete_power_outage_target_lookups lookup
  where lookup.provider = quota.provider
) counts on true
left join lateral (
  select count(*) as error_count
  from public.complete_power_outage_active_provider_errors error_lookup
  where error_lookup.provider = quota.provider
) active_errors on true
left join public.power_outage_mapy_credit_usage usage
  on usage.provider = quota.provider
where quota.provider in ('ares', 'mapy', 'google');

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview
  to authenticated;

commit;

select 'CONSTRAINT' as check_type, 'provider lookup supports needs review' as object_name,
  pg_get_constraintdef(oid) like '%needs_review%' as is_correct
from pg_constraint
where conrelid = 'public.complete_power_outage_target_lookups'::regclass
  and conname = 'cpo_target_lookups_status_check'
union all select 'FUNCTION', 'provider error recovery targets active outages only',
  pg_get_functiondef('public.reset_complete_power_outage_provider_errors(text)'::regprocedure)
    like '%outage.ends_at >= now()%'
union all select 'FUNCTION', 'provider queue exposes retry status',
  pg_get_function_result('public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure)
    like '%lookup_status text%'
union all select 'VIEW', 'active provider errors',
  to_regclass('public.complete_power_outage_active_provider_errors') is not null
union all select 'VIEW', 'provider badge uses active errors',
  pg_get_viewdef('public.complete_power_outage_provider_overview'::regclass, true)
    like '%complete_power_outage_active_provider_errors%'
order by check_type, object_name;
