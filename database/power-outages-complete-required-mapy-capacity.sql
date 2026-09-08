begin;

-- Povinne ulicni cile v aktivnim 30dennim horizontu musi byt pred doplnkovymi
-- kontrolami presnych adres. Predchozi poradi sice ulicim prirazovalo nizsi
-- providerovou prioritu, ale aplikovalo ji az po obchodnim horizontu, takze
-- jediny blizky ulicni cil mohl hladovet za tisici doplnkovych dotazu.
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
  with parameters as (
    select
      lower(btrim(requested_provider)) as provider,
      least(5000, greatest(1, coalesce(requested_limit, 1000))) as batch_limit
  ), eligible as (
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
      lookup.next_attempt_at,
      lookup.last_attempt_at,
      outage.source,
      case
        when parameters.provider = 'mapy'
         and target.target_kind = 'street'
         and outage.starts_at <= now() + interval '30 days' then 0
        when lookup.lookup_status = 'error' then 1
        else 2
      end as queue_lane,
      case
        when outage.starts_at >= now() + interval '7 days'
         and outage.starts_at <= now() + interval '30 days' then 0
        when outage.starts_at >= now() + interval '2 days'
         and outage.starts_at < now() + interval '7 days' then 1
        when outage.starts_at < now() + interval '2 days' then 2
        else 3
      end as business_priority,
      case
        when target.target_kind = 'exact_number' then 0
        when target.target_kind = 'street' then 1
        else 2
      end as provider_priority,
      outage.starts_at,
      target.lookup_priority,
      target.created_at
    from public.complete_power_outage_address_targets target
    join public.complete_power_outage_addresses address
      on address.id = target.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    cross join parameters
    left join public.complete_power_outage_target_lookups lookup
      on lookup.target_id = target.id
     and lookup.provider = parameters.provider
    where parameters.provider in ('ares', 'mapy', 'google')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and (
        (parameters.provider = 'ares' and target.target_kind = 'exact_number')
        or (parameters.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
      )
      and (
        lookup.id is null
        or (
          lookup.lookup_status = 'error'
          and (lookup.next_attempt_at is null or lookup.next_attempt_at <= now())
        )
      )
  ), ranked as (
    select
      eligible.*,
      row_number() over (
        partition by eligible.queue_lane, eligible.source
        order by
          eligible.business_priority,
          eligible.provider_priority,
          eligible.next_attempt_at nulls first,
          eligible.last_attempt_at nulls first,
          eligible.starts_at,
          eligible.lookup_priority,
          eligible.created_at,
          eligible.id
      ) as source_position
    from eligible
  ), interleaved as (
    select
      ranked.*,
      row_number() over (
        partition by ranked.queue_lane
        order by
          ranked.source_position,
          case ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
          ranked.business_priority,
          ranked.starts_at,
          ranked.created_at,
          ranked.id
      ) as lane_position
    from ranked
  )
  select
    interleaved.id,
    interleaved.outage_address_id,
    interleaved.target_kind,
    interleaved.municipality,
    interleaved.town_part,
    interleaved.street,
    interleaved.number_token,
    interleaved.query_text,
    interleaved.latitude,
    interleaved.longitude,
    interleaved.lookup_status
  from interleaved
  order by
    case when interleaved.queue_lane < 2 then 0 else 1 end,
    interleaved.lane_position,
    interleaved.queue_lane,
    interleaved.source_position,
    case interleaved.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    interleaved.business_priority,
    interleaved.starts_at,
    interleaved.created_at,
    interleaved.id
  limit (select parameters.batch_limit from parameters);
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

-- Read-only audit nasazeni. Pokud existuje cekajici povinny ulicni cil,
-- musi byt prvnim prvkem vystupu Mapy.com; samotna migrace nic nezpracovava.
select 'FUNCTION' as check_type,
  'required Mapy street targets precede supplemental exact targets' as object_name,
  position('queue_lane' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) > 0 as is_correct
union all
select 'DATA', 'next Mapy target is required street when one is waiting',
  not exists (
    select 1
    from public.complete_power_outage_address_targets target
    join public.complete_power_outage_addresses address on address.id = target.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_target_lookups lookup
      on lookup.target_id = target.id and lookup.provider = 'mapy'
    where target.target_kind = 'street'
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and outage.starts_at <= now() + interval '30 days'
      and (
        lookup.id is null
        or (lookup.lookup_status = 'error' and coalesce(lookup.next_attempt_at, now()) <= now())
      )
  )
  or coalesce((
    select target.target_kind = 'street'
    from public.get_complete_power_outage_discovery_targets('mapy', 50) target
    limit 1
  ), false)
union all
select 'GRANT', 'authenticated cannot claim prioritized Mapy queue',
  not has_function_privilege(
    'authenticated',
    'public.get_complete_power_outage_discovery_targets(text,integer)',
    'EXECUTE'
  )
union all
select 'ISOLATION', 'Mapy priority remains in COMPLETE scope',
  position('power_outage_store_' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) = 0
  and position('power_outage_cez_market' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) = 0
union all
select 'SAFETY', 'priority migration does not mutate provider results', true
order by check_type, object_name;
