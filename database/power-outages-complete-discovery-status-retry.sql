begin;

-- Dílčí chyby dostanou přednost před dosud nezpracovanými cíli daného
-- distributora. Střídání ČEZ, EG.D a PRE i obchodní priority zůstávají zachované.
create or replace function public.get_complete_power_outage_discovery_targets(
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
  longitude double precision
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
      ) as source_position
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
    ranked.longitude
  from ranked
  order by
    ranked.source_position,
    case ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
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

commit;

select 'FUNCTION' as check_type,
  'complete discovery prioritizes retries' as object_name,
  pg_get_functiondef(
    'public.get_complete_power_outage_discovery_targets(text,integer)'::regprocedure
  ) like '%eligible.retry_priority%' as is_correct
union all
select 'GRANT', 'complete discovery remains service-role only',
  has_function_privilege(
    'service_role',
    'public.get_complete_power_outage_discovery_targets(text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_complete_power_outage_discovery_targets(text,integer)',
    'EXECUTE'
  )
order by check_type, object_name;
