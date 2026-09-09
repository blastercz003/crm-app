with address_integrity as (
  select
    (select count(*)::bigint
      from public.complete_power_outage_cez_projection_addresses) as projected_count,
    coalesce((select published_address_count::bigint
      from public.complete_power_outage_source_state
      where source = 'cez'), 0) as state_published_count,
    (select count(address.id)::bigint
      from public.complete_power_outage_cez_projection_outages projected_outage
      join public.complete_power_outages outage
        on outage.source = 'cez'
       and outage.external_id = projected_outage.external_id
      join public.complete_power_outage_addresses address
        on address.outage_id = outage.id) as production_count,
    (select count(*)::bigint
      from public.complete_power_outage_cez_projection_addresses projected_address
      left join public.complete_power_outages outage
        on outage.source = 'cez'
       and outage.external_id = projected_address.outage_external_id
      left join public.complete_power_outage_addresses address
        on address.outage_id = outage.id
       and address.address_key = projected_address.address_key
      where address.id is null) as missing_count,
    (select count(*)::bigint
      from public.complete_power_outage_cez_projection_outages projected_outage
      join public.complete_power_outages outage
        on outage.source = 'cez'
       and outage.external_id = projected_outage.external_id
      join public.complete_power_outage_addresses address
        on address.outage_id = outage.id
      left join public.complete_power_outage_cez_projection_addresses projected_address
        on projected_address.outage_external_id = outage.external_id
       and projected_address.address_key = address.address_key
      where projected_address.id is null) as extra_count
), latest_cez_run as (
  select run.*
  from public.complete_power_outage_runs run
  where run.run_kind = 'source_sync' and run.source = 'cez'
  order by run.started_at desc, run.id desc
  limit 1
), audit as (
  select 'DATA'::text as check_type, 'published CEZ address count matches projection'::text as object_name,
    projected_count = state_published_count as is_correct
  from address_integrity
  union all
  select 'DATA', 'production CEZ address count matches projection',
    projected_count = production_count
  from address_integrity
  union all
  select 'DATA', 'no projected CEZ address is missing in production', missing_count = 0
  from address_integrity
  union all
  select 'DATA', 'no extra CEZ address remains on projected outages', extra_count = 0
  from address_integrity
  union all
  select 'DATA', 'KOBIT Tovární 123 is published', exists (
    select 1
    from public.complete_power_outages outage
    join public.complete_power_outage_addresses address on address.outage_id = outage.id
    where outage.source = 'cez'
      and outage.external_id = '110061110458'
      and address.house_number = '123'
      and address.street ilike 'Tovární'
  )
  union all
  select 'FUNCTION', 'CEZ publisher verifies address integrity',
    position('address_integrity_mismatch' in pg_get_functiondef(
      'public.advance_complete_power_outage_cez_projection()'::regprocedure)) > 0
  union all
  select 'GRANT', 'authenticated cannot run CEZ integrity publisher',
    not has_function_privilege('authenticated',
      'public.advance_complete_power_outage_cez_projection()', 'EXECUTE')
  union all
  select 'SAFETY', 'latest CEZ sync used paginated address contract', coalesce(
    (select metadata ->> 'addressPaginationContract' = 'complete-cez-address-pagination-v2'
      from latest_cez_run), false
  )
  union all
  select 'STATE', 'CEZ ALL v1 remains active', coalesce((
    select active_source = 'shadow'
    from public.complete_power_outage_cez_projection_state
    where singleton
  ), false)
)
select *
from audit
order by check_type, object_name;
