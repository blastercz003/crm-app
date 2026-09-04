begin;

-- KOMPLETNÍ only. Mapy.com dostane v každé sedmipoložkové dávce až tři
-- rezervovaná místa pro nový uliční cíl (nejvýše jeden za každého
-- distributora). Zbytek dávky zachová obchodní horizont, přesná čísla,
-- férové střídání distributorů a omezený počet retry pokusů.
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
  with settings as (
    select
      lower(btrim(coalesce(requested_provider, ''))) as provider,
      least(5000, greatest(1, coalesce(requested_limit, 1000)))::integer as batch_limit,
      least(50, greatest(3, coalesce(requested_limit, 1000) / 10))::integer as retry_limit
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
    cross join settings config
    left join public.complete_power_outage_target_lookups lookup
      on lookup.target_id = target.id
     and lookup.provider = config.provider
    where config.provider in ('ares', 'mapy', 'google')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and outage.starts_at <= now() + interval '30 days'
      and (
        (config.provider = 'ares' and target.target_kind = 'exact_number')
        or (config.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
      )
      and (
        lookup.id is null
        or (
          lookup.lookup_status = 'error'
          and (lookup.next_attempt_at is null or lookup.next_attempt_at <= now())
        )
      )
  ), street_ranked as (
    select
      eligible.*,
      row_number() over (
        partition by eligible.source
        order by
          eligible.business_priority,
          eligible.lookup_priority,
          eligible.starts_at,
          eligible.created_at,
          eligible.id
      ) as source_street_position
    from eligible
    cross join settings config
    where config.provider = 'mapy'
      and eligible.target_kind = 'street'
      and eligible.lookup_status is null
  ), reserved_streets as (
    select street_ranked.*
    from street_ranked
    cross join settings config
    where street_ranked.source_street_position = 1
    order by
      street_ranked.business_priority,
      case street_ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
      street_ranked.starts_at,
      street_ranked.created_at,
      street_ranked.id
    limit (select least(3, settings.batch_limit) from settings)
  ), general_ranked as (
    select
      eligible.*,
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
    where not exists (
      select 1 from reserved_streets reserved where reserved.id = eligible.id
    )
  ), general_allowed as (
    select general_ranked.*
    from general_ranked
    cross join settings config
    where general_ranked.lookup_status is null
       or general_ranked.queue_kind_position <= config.retry_limit
  ), general_numbered as (
    select
      general_allowed.*,
      row_number() over (
        order by
          general_allowed.source_position,
          case general_allowed.source when 'cez' then 0 when 'egd' then 1 else 2 end,
          general_allowed.retry_priority,
          general_allowed.business_priority,
          general_allowed.precision_priority,
          general_allowed.starts_at,
          general_allowed.created_at,
          general_allowed.id
      ) as selection_position
    from general_allowed
  ), selected as (
    select
      reserved.id,
      reserved.outage_address_id,
      reserved.target_kind,
      reserved.municipality,
      reserved.town_part,
      reserved.street,
      reserved.number_token,
      reserved.query_text,
      reserved.latitude,
      reserved.longitude,
      reserved.lookup_status,
      0 as selection_group,
      reserved.business_priority,
      reserved.starts_at,
      reserved.created_at
    from reserved_streets reserved
    union all
    select
      general_numbered.id,
      general_numbered.outage_address_id,
      general_numbered.target_kind,
      general_numbered.municipality,
      general_numbered.town_part,
      general_numbered.street,
      general_numbered.number_token,
      general_numbered.query_text,
      general_numbered.latitude,
      general_numbered.longitude,
      general_numbered.lookup_status,
      1 as selection_group,
      general_numbered.business_priority,
      general_numbered.starts_at,
      general_numbered.created_at
    from general_numbered
    cross join settings config
    where general_numbered.selection_position <= greatest(
      0,
      config.batch_limit - (select count(*)::integer from reserved_streets)
    )
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
    selected.selection_group,
    selected.business_priority,
    selected.starts_at,
    selected.created_at,
    selected.id;
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

-- Čekající počet nově zahrnuje i cíle, pro které lookup řádek ještě nevznikl.
-- Aktivní chyby jsou rozdělené na automaticky opakovatelné a ruční kontrolu.
create or replace view public.complete_power_outage_provider_overview
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
  -- Nové sloupce musí být při CREATE OR REPLACE VIEW přidané až za původní
  -- kontrakt pohledu, aby nasazení nemuselo pohled destruktivně zahazovat.
  coalesce(active_errors.retryable_error_count, 0)::integer as retryable_error_count,
  coalesce(active_errors.review_error_count, 0)::integer as review_error_count
from public.complete_power_outage_provider_quota quota
left join counts on counts.provider = quota.provider
left join active_errors on active_errors.provider = quota.provider
left join public.power_outage_mapy_credit_usage usage
  on usage.provider = quota.provider
where quota.provider in ('ares', 'mapy', 'google');

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
