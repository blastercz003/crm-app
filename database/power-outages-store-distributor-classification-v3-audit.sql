with active as (
  select *
  from public.power_outage_store_registry
  where is_active
), current_egd_stores as (
  select distinct matches.store_id
  from public.power_outage_store_matches matches
  join public.power_outages outages on outages.id = matches.outage_id
  where outages.source = 'egd'
    and outages.missing_since is null
    and outages.source_status <> 'cancelled'
    and outages.archive_at > now()
    and matches.store_id is not null
), checks as (
  select 'DATA'::text as check_type,
    'all active stores have one supported distributor state'::text as object_name,
    count(*) = count(*) filter (where distributor in ('cez', 'egd', 'pre', 'unknown')) as is_correct
  from active

  union all

  select 'DATA',
    'verified resolved addresses are classified',
    not exists (
      select 1 from active
      where not needs_refresh
        and verification_status in ('verified', 'probable')
        and ruian_address_id is not null
        and distributor = 'unknown'
    )

  union all

  select 'DATA',
    'current EG.D matched stores are no longer unknown',
    not exists (
      select 1
      from current_egd_stores matched
      join active registry on registry.store_id = matched.store_id
      where registry.distributor = 'unknown'
    )

  union all

  select 'DATA',
    'PRE territory is represented',
    exists (select 1 from active where distributor = 'pre')

  union all

  select 'DATA',
    'EG.D territory is represented',
    exists (select 1 from active where distributor = 'egd')

  union all

  select 'DATA',
    'classification metadata is version 3',
    not exists (
      select 1 from active
      where coalesce((metadata ->> 'distributorClassificationVersion')::integer, 0) < 3
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  distributor,
  count(*) as store_count
from public.power_outage_store_registry
where is_active
group by distributor
order by distributor;

select
  verification_status,
  needs_refresh,
  count(*) as store_count
from public.power_outage_store_registry
where is_active
group by verification_status, needs_refresh
order by verification_status, needs_refresh;
