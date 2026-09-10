-- Čistě čtecí end-to-end audit ČEZ ALL v1.
-- Nic neopravuje ani nemění; lze jej bezpečně spustit v Supabase SQL editoru.

with latest_complete_cycle as (
  select cycle.*
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot
    and cycle.snapshot_contract_version = 2
    and cycle.status in ('succeeded', 'no_change')
    and cycle.snapshot_status = 'complete'
    and cycle.snapshot_publishable
  order by cycle.finished_at desc nulls last, cycle.started_at desc, cycle.id desc
  limit 1
), latest_sync as (
  select run.*
  from public.complete_power_outage_runs run
  where run.run_kind = 'source_sync'
    and run.source = 'cez'
  order by run.started_at desc, run.id desc
  limit 1
), cycle_scope as (
  select
    cycle.id as cycle_id,
    count(scope.municipality_code)::bigint as scope_count
  from latest_complete_cycle cycle
  left join public.complete_power_outage_cez_cycle_municipalities scope
    on scope.cycle_id = cycle.id
  group by cycle.id
), cycle_attempts as (
  select
    cycle.id as cycle_id,
    count(attempt.municipality_code)::bigint as attempt_count,
    count(attempt.municipality_code) filter (
      where attempt.status in ('succeeded', 'no_change')
    )::bigint as successful_attempt_count,
    count(attempt.municipality_code) filter (
      where attempt.status in ('succeeded', 'no_change')
        and coalesce(attempt.metadata ->> 'snapshotRecorded', 'false') = 'true'
    )::bigint as recorded_attempt_count,
    count(attempt.municipality_code) filter (
      where attempt.status in ('failed', 'skipped', 'running')
    )::bigint as unsafe_attempt_count
  from latest_complete_cycle cycle
  left join public.complete_power_outage_cez_scan_attempts attempt
    on attempt.cycle_id = cycle.id
  group by cycle.id
), cycle_members as (
  select
    cycle.id as cycle_id,
    count(member.outage_external_id)::bigint as outage_count,
    coalesce(sum(member.address_count), 0)::bigint as address_count
  from latest_complete_cycle cycle
  left join public.complete_power_outage_cez_cycle_outages member
    on member.cycle_id = cycle.id
  group by cycle.id
), projection_counts as (
  select
    (select count(*)::bigint
      from public.complete_power_outage_cez_projection_outages) as outage_count,
    (select count(*)::bigint
      from public.complete_power_outage_cez_projection_addresses) as address_count
), production_counts as (
  select
    count(distinct outage.id)::bigint as projected_outage_count,
    count(address.id)::bigint as projected_address_count
  from public.complete_power_outage_cez_projection_outages projected_outage
  join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_outage.external_id
  left join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
), address_integrity as (
  select
    count(*) filter (where production_address.id is null)::bigint as missing_count
  from public.complete_power_outage_cez_projection_addresses projected_address
  left join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_address.outage_external_id
  left join public.complete_power_outage_addresses production_address
    on production_address.outage_id = outage.id
   and production_address.address_key = projected_address.address_key
), extra_projected_outage_addresses as (
  select count(*)::bigint as extra_count
  from public.complete_power_outage_cez_projection_outages projected_outage
  join public.complete_power_outages outage
    on outage.source = 'cez'
   and outage.external_id = projected_outage.external_id
  join public.complete_power_outage_addresses production_address
    on production_address.outage_id = outage.id
  left join public.complete_power_outage_cez_projection_addresses projected_address
    on projected_address.outage_external_id = outage.external_id
   and projected_address.address_key = production_address.address_key
  where projected_address.id is null
), audit as (
  select 'STATE'::text as check_type, 'CEZ ALL v1 is active'::text as object_name,
    coalesce((select state.active_source = 'shadow'
      from public.complete_power_outage_cez_projection_state state
      where state.singleton), false) as is_correct
  union all
  select 'CYCLE', 'a publishable complete cycle exists',
    exists (select 1 from latest_complete_cycle)
  union all
  select 'CYCLE', 'latest complete cycle contains its full frozen municipality scope',
    coalesce((select scope.scope_count = cycle.municipality_total_count
      from latest_complete_cycle cycle
      join cycle_scope scope on scope.cycle_id = cycle.id), false)
  union all
  select 'CYCLE', 'every municipality completed successfully and recorded its snapshot',
    coalesce((select attempts.attempt_count = cycle.municipality_total_count
        and attempts.successful_attempt_count = cycle.municipality_total_count
        and attempts.recorded_attempt_count = cycle.municipality_total_count
        and attempts.unsafe_attempt_count = 0
      from latest_complete_cycle cycle
      join cycle_attempts attempts on attempts.cycle_id = cycle.id), false)
  union all
  select 'CYCLE', 'immutable snapshot outage and address totals match stored members',
    coalesce((select cycle.snapshot_outage_count = members.outage_count
        and cycle.snapshot_address_count = members.address_count
      from latest_complete_cycle cycle
      join cycle_members members on members.cycle_id = cycle.id), false)
  union all
  select 'PROJECTION', 'every latest-cycle outage is present in projection',
    not exists (
      select 1
      from latest_complete_cycle cycle
      join public.complete_power_outage_cez_cycle_outages member
        on member.cycle_id = cycle.id
      left join public.complete_power_outage_cez_projection_outages projected
        on projected.external_id = member.outage_external_id
      where projected.external_id is null
    )
  union all
  select 'PROJECTION', 'every latest-cycle outage has its complete projected address set',
    not exists (
      select 1
      from latest_complete_cycle cycle
      join public.complete_power_outage_cez_cycle_outages member
        on member.cycle_id = cycle.id
      left join public.complete_power_outage_cez_projection_outages projected_outage
        on projected_outage.external_id = member.outage_external_id
      left join lateral (
        select count(*)::bigint as address_count
        from public.complete_power_outage_cez_projection_addresses projected_address
        where projected_address.outage_external_id = member.outage_external_id
      ) projected_addresses on true
      where projected_outage.addresses_projected_cycle_id is distinct from cycle.id
        or projected_addresses.address_count <> member.address_count
    )
  union all
  select 'PROJECTION', 'projection state points to latest complete cycle',
    coalesce((select state.latest_complete_cycle_id = cycle.id
      from public.complete_power_outage_cez_projection_state state
      cross join latest_complete_cycle cycle
      where state.singleton), false)
  union all
  select 'PUBLICATION', 'published source confirms projected complete cycle',
    coalesce((select nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid
        = projection_state.latest_complete_cycle_id
      from public.complete_power_outage_source_state source_state
      cross join public.complete_power_outage_cez_projection_state projection_state
      where source_state.source = 'cez' and projection_state.singleton), false)
  union all
  select 'PUBLICATION', 'published outage count matches projection',
    coalesce((select source_state.published_outage_count = counts.outage_count
      from public.complete_power_outage_source_state source_state
      cross join projection_counts counts
      where source_state.source = 'cez'), false)
  union all
  select 'PUBLICATION', 'published address count matches projection',
    coalesce((select source_state.published_address_count = counts.address_count
      from public.complete_power_outage_source_state source_state
      cross join projection_counts counts
      where source_state.source = 'cez'), false)
  union all
  select 'PUBLICATION', 'every projected outage exists in production',
    (select counts.projected_outage_count = projection.outage_count
      from production_counts counts cross join projection_counts projection)
  union all
  select 'PUBLICATION', 'production address count on projected outages matches projection',
    (select counts.projected_address_count = projection.address_count
      from production_counts counts cross join projection_counts projection)
  union all
  select 'PUBLICATION', 'no projected address is missing in production',
    (select missing_count = 0 from address_integrity)
  union all
  select 'PUBLICATION', 'no extra production address remains on projected outages',
    (select extra_count = 0 from extra_projected_outage_addresses)
  union all
  select 'PUBLICATION', 'no active production CEZ outage exists outside projection',
    not exists (
      select 1
      from public.complete_power_outages outage
      left join public.complete_power_outage_cez_projection_outages projected
        on projected.external_id = outage.external_id
      where outage.source = 'cez'
        and outage.source_status in ('scheduled', 'active')
        and projected.external_id is null
    )
  union all
  select 'PUBLICATION', 'latest CEZ sync succeeded or reported no change',
    coalesce((select run.status in ('succeeded', 'no_change') from latest_sync run), false)
  union all
  select 'PUBLICATION', 'latest CEZ sync used complete paginated address contract',
    coalesce((select run.metadata ->> 'addressPaginationContract'
      = 'complete-cez-address-pagination-v2' from latest_sync run), false)
  union all
  select 'PUBLICATION', 'latest CEZ sync verified its production address total',
    coalesce((select (run.metadata ->> 'verifiedProductionAddressCount') ~ '^[0-9]+$'
        and (run.metadata ->> 'verifiedProductionAddressCount')::bigint = counts.address_count
      from latest_sync run cross join projection_counts counts), false)
  union all
  select 'CRON', 'exactly one nationwide CEZ scan scheduler is active',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_full_scan_every_five_minutes')
  union all
  select 'CRON', 'exactly one CEZ staging normalizer is active',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_staging_normalization_every_five_minutes')
  union all
  select 'CRON', 'exactly one CEZ ALL v1 publisher is active',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_shadow_projection_every_five_minutes')
  union all
  select 'SAFETY', 'authenticated users cannot run the CEZ publisher',
    not has_function_privilege(
      'authenticated',
      'public.advance_complete_power_outage_cez_projection()',
      'EXECUTE'
    )
)
select *
from audit
order by check_type, object_name;

-- Provozní čísla pro interpretaci případného rozpracovaného nového cyklu.
with latest_cycle as (
  select cycle.*
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot and cycle.snapshot_contract_version = 2
  order by cycle.started_at desc, cycle.id desc
  limit 1
), latest_complete_cycle as (
  select cycle.*
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot
    and cycle.snapshot_contract_version = 2
    and cycle.status in ('succeeded', 'no_change')
    and cycle.snapshot_status = 'complete'
    and cycle.snapshot_publishable
  order by cycle.finished_at desc nulls last, cycle.started_at desc, cycle.id desc
  limit 1
)
select
  latest.id as latest_cycle_id,
  latest.status as latest_cycle_status,
  latest.snapshot_status as latest_snapshot_status,
  latest.snapshot_publishable as latest_snapshot_publishable,
  latest.municipality_processed_count as latest_municipalities_done,
  latest.municipality_total_count as latest_municipalities_total,
  latest.municipality_error_count as latest_municipality_errors,
  latest.outage_count as latest_cycle_outages,
  latest.address_count as latest_cycle_source_addresses,
  latest.started_at as latest_cycle_started_at,
  latest.finished_at as latest_cycle_finished_at,
  complete_cycle.id as published_candidate_cycle_id,
  projection_state.latest_complete_cycle_id as projected_complete_cycle_id,
  nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid as published_cycle_id,
  source_state.published_outage_count,
  source_state.published_address_count,
  source_state.last_success_at as last_publication_at,
  coverage.normalized_count as production_addresses_normalized,
  coverage.pending_count as production_addresses_pending,
  coverage.error_count as production_address_errors,
  coverage.review_count as production_addresses_for_review
from latest_cycle latest
cross join latest_complete_cycle complete_cycle
cross join public.complete_power_outage_cez_projection_state projection_state
join public.complete_power_outage_source_state source_state
  on source_state.source = 'cez'
left join public.complete_power_outage_address_coverage coverage
  on coverage.source = 'cez'
where projection_state.singleton;
