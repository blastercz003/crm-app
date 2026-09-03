begin;

-- Mapy.com je pro široké uliční cíle povinný provider, zatímco kontrola
-- přesných čísel přes Mapy.com je pouze doplňková k ARES. Povinné ulice proto
-- nesmějí čekat za tisíci doplňkových přesných kontrol. Střídání distributorů,
-- obchodní horizont a omezení retry cílů zůstávají zachované.
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
      case
        when lower(btrim(requested_provider)) = 'mapy' and target.target_kind = 'street' then 0
        when target.target_kind = 'exact_number' then 1
        when target.target_kind = 'street' then 2
        else 3
      end as provider_priority,
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
          eligible.provider_priority,
          eligible.lookup_priority,
          eligible.starts_at,
          eligible.created_at,
          eligible.id
      ) as source_position,
      row_number() over (
        partition by (eligible.lookup_status = 'error')
        order by
          eligible.business_priority,
          eligible.provider_priority,
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
    ranked.provider_priority,
    ranked.starts_at,
    ranked.created_at,
    ranked.id
  limit least(5000, greatest(1, coalesce(requested_limit, 1000)));
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

-- Prodleva se měří samostatně pro povinný ARES průchod přesných čísel a pro
-- povinný Mapy.com průchod uličních cílů. Doplňkové Mapy/Google dotazy tak už
-- nemohou maskovat skutečně stojící povinný krok ani falešně vyvolat prodlevu.
create or replace view public.complete_power_outage_source_discovery_overview
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
  count(*) filter (
    where target_kind = 'exact_number'
      and (lookup_status is null or lookup_status = 'pending')
  )::bigint as exact_pending_target_count,
  count(*) filter (
    where target_kind = 'street'
      and (lookup_status is null or lookup_status = 'pending')
  )::bigint as street_pending_target_count,
  max(coalesce(finished_at, last_attempt_at)) filter (
    where target_kind = 'exact_number'
  ) as exact_last_progress_at,
  max(coalesce(finished_at, last_attempt_at)) filter (
    where target_kind = 'street'
  ) as street_last_progress_at,
  min(target_created_at) filter (
    where target_kind = 'exact_number'
      and (lookup_status is null or lookup_status = 'pending')
  ) as exact_oldest_pending_at,
  min(target_created_at) filter (
    where target_kind = 'street'
      and (lookup_status is null or lookup_status = 'pending')
  ) as street_oldest_pending_at
from progress
group by source;

revoke all on table public.complete_power_outage_source_discovery_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_overview
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'Mapy prioritizes required street targets' as object_name,
  pg_get_functiondef('public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure)
    like '%requested_provider)) = ''mapy'' and target.target_kind = ''street'' then 0%' as is_correct
union all
select 'VIEW', 'source discovery tracks required provider progress separately',
  pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
    like '%street_pending_target_count%';
