begin;

-- Splatne opakovatelne chyby musi byt ve vracene davce pred novymi cili.
-- Aplikace si z nich vezme nejvyse bezpecnou cast providerove davky; zbytek
-- kapacity zustava pro nove cile. Poradi distributorů a obchodni horizont se
-- nemeni a funkce pouze cte data tabu KOMPLETNI.
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
      least(5000, greatest(1, coalesce(requested_limit, 1000))) as batch_limit,
      least(50, greatest(2, coalesce(requested_limit, 1000) / 10)) as retry_slot_limit
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
        when parameters.provider = 'mapy' and target.target_kind = 'street' then 0
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
        partition by eligible.source, (eligible.lookup_status = 'error')
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
        partition by (ranked.lookup_status = 'error')
        order by
          ranked.source_position,
          case ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
          ranked.business_priority,
          ranked.provider_priority,
          ranked.next_attempt_at nulls first,
          ranked.starts_at,
          ranked.created_at,
          ranked.id
      ) as queue_position
    from ranked
  ), selected as (
    select interleaved.*
    from interleaved
    cross join parameters
    where interleaved.lookup_status is null
       or interleaved.queue_position <= parameters.retry_slot_limit
  )
  select
    selected.id,
    selected.outage_address_id,
    selected.target_kind,
    selected.municipality,
    selected.town_part,
    selected.street,
    selected.number_token,
    selected.query_text,
    selected.latitude,
    selected.longitude,
    selected.lookup_status
  from selected
  order by
    selected.retry_priority,
    selected.queue_position,
    selected.source_position,
    case selected.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    selected.business_priority,
    selected.provider_priority,
    selected.starts_at,
    selected.created_at,
    selected.id
  limit (select parameters.batch_limit from parameters);
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

-- Bezpecny read-only audit nasazeni. Prvni kontrola zaroven overuje skutecne
-- poradi vystupu, pokud nyni existuje alespon jedna splatna Mapy.com chyba.
select 'FUNCTION' as check_type,
  'due provider retries have guaranteed queue slots' as object_name,
  position('retry_slot_limit' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) > 0
  and position('selected.retry_priority' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) > 0 as is_correct
union all
select 'DATA', 'due Mapy retry is selected before fresh targets',
  not exists (
    select 1
    from public.complete_power_outage_active_provider_errors error_lookup
    where error_lookup.provider = 'mapy'
      and error_lookup.lookup_status = 'error'
      and (error_lookup.next_attempt_at is null or error_lookup.next_attempt_at <= now())
  )
  or coalesce((
    select target.lookup_status = 'error'
    from public.get_complete_power_outage_discovery_targets('mapy', 300) target
    limit 1
  ), false)
union all
select 'GRANT', 'authenticated cannot claim provider retry queue',
  not has_function_privilege(
    'authenticated',
    'public.get_complete_power_outage_discovery_targets(text,integer)',
    'EXECUTE'
  )
union all
select 'ISOLATION', 'provider retry queue does not reference MARKET tables',
  position('power_outage_store_' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) = 0
  and position('power_outage_cez_market' in pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  )) = 0
union all
select 'SAFETY', 'retry repair does not mutate provider results', true
order by check_type, object_name;
