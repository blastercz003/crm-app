-- Čistě čtecí audit budoucího datového toku ČEZ ALL v1 v tabu KOMPLETNÍ.
-- Nic nespouští, neopravuje ani nemění. Vrací čtyři samostatné tabulky.

-- 1. Základní integrita a provozní připravenost celého řetězce.
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
), current_projection as (
  select projection.external_id, projection.starts_at, projection.ends_at
  from public.complete_power_outage_cez_projection_outages projection
  where projection.source_status in ('scheduled', 'active')
    and projection.ends_at >= now()
), current_production as (
  select outage.id, outage.external_id, outage.starts_at, outage.ends_at
  from public.complete_power_outages outage
  where outage.source = 'cez'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
), checks as (
  select 'STATE'::text as check_type, 'CEZ ALL v1 projection is active'::text as object_name,
    coalesce((select state.active_source = 'shadow'
      from public.complete_power_outage_cez_projection_state state
      where state.singleton), false) as is_correct

  union all
  select 'FRESHNESS', 'a complete publishable CEZ cycle exists',
    exists (select 1 from latest_complete_cycle)

  union all
  select 'FRESHNESS', 'latest complete CEZ cycle finished within twenty four hours',
    coalesce((select cycle.finished_at >= now() - interval '24 hours'
      from latest_complete_cycle cycle), false)

  union all
  select 'CYCLE', 'latest complete CEZ cycle processed its full municipality scope',
    coalesce((select cycle.municipality_processed_count = cycle.municipality_total_count
        and cycle.municipality_error_count = 0
        and cycle.municipality_skipped_count = 0
      from latest_complete_cycle cycle), false)

  union all
  select 'PUBLICATION', 'projection state points to the latest complete CEZ cycle',
    coalesce((select state.latest_complete_cycle_id = cycle.id
      from public.complete_power_outage_cez_projection_state state
      cross join latest_complete_cycle cycle
      where state.singleton), false)

  union all
  select 'PUBLICATION', 'published COMPLETE state points to the projected CEZ cycle',
    coalesce((select nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid
        = projection_state.latest_complete_cycle_id
      from public.complete_power_outage_source_state source_state
      cross join public.complete_power_outage_cez_projection_state projection_state
      where source_state.source = 'cez' and projection_state.singleton), false)

  union all
  select 'PUBLICATION', 'every current projected CEZ outage exists in COMPLETE production',
    not exists (
      select 1
      from current_projection projection
      left join current_production production
        on production.external_id = projection.external_id
      where production.id is null
    )

  union all
  select 'PUBLICATION', 'COMPLETE contains no current CEZ outage outside projection',
    not exists (
      select 1
      from current_production production
      left join current_projection projection
        on projection.external_id = production.external_id
      where projection.external_id is null
    )

  union all
  select 'ADDRESS', 'every current CEZ outage has at least one production address',
    not exists (
      select 1
      from current_production production
      where not exists (
        select 1 from public.complete_power_outage_addresses address
        where address.outage_id = production.id
      )
    )

  union all
  select 'ADDRESS', 'every normalized current exact or street CEZ address has a discovery target',
    not exists (
      select 1
      from current_production production
      join public.complete_power_outage_addresses address
        on address.outage_id = production.id
      where address.normalization_version >= 2
        and address.address_scope in ('exact', 'street')
        and not exists (
          select 1
          from public.complete_power_outage_address_targets target
          where target.outage_address_id = address.id
            and target.target_kind in ('exact_number', 'street')
        )
    )

  union all
  select 'CRON', 'COMPLETE address normalizer is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_address_normalization_every_minute')

  union all
  select 'CRON', 'nationwide CEZ scanner is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_full_scan_every_five_minutes')

  union all
  select 'CRON', 'CEZ staging normalizer is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_staging_normalization_every_five_minutes')

  union all
  select 'CRON', 'CEZ ALL v1 publisher is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'complete_cez_shadow_projection_every_five_minutes')

  union all
  select 'CRON', 'COMPLETE provider pipeline is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_pipeline_every_five_minutes')

  union all
  select 'ISOLATION', 'audit scope contains only COMPLETE CEZ data', true
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

-- 2. Poslední cyklus, publikace a deklarovaný časový horizont.
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
  latest.municipality_processed_count as municipalities_done,
  latest.municipality_total_count as municipalities_total,
  latest.municipality_error_count as municipality_errors,
  latest.municipality_skipped_count as municipality_skipped,
  latest.outage_count as latest_cycle_outage_count,
  latest.address_count as latest_cycle_address_count,
  latest.started_at as latest_cycle_started_at,
  latest.finished_at as latest_cycle_finished_at,
  complete_cycle.id as latest_complete_cycle_id,
  projection_state.latest_complete_cycle_id as projected_cycle_id,
  nullif(source_state.metadata ->> 'completeCezCycleId', '')::uuid as published_cycle_id,
  source_state.published_outage_count,
  source_state.published_address_count,
  source_state.future_outage_count,
  source_state.active_outage_count,
  source_state.horizon_from,
  source_state.horizon_to,
  source_state.last_attempt_at as publication_last_attempt_at,
  source_state.last_success_at as publication_last_success_at,
  source_state.last_error_message as publication_last_error
from latest_cycle latest
cross join latest_complete_cycle complete_cycle
cross join public.complete_power_outage_cez_projection_state projection_state
join public.complete_power_outage_source_state source_state
  on source_state.source = 'cez'
where projection_state.singleton;

-- 3. Budoucí funnel po termínech. Ukáže, zda se záznamy ztrácejí už ve
-- zdroji, při publikaci, normalizaci adres, nebo až při hledání firem.
with bands(sort_order, horizon_band, from_offset, to_offset) as (
  values
    (1, 'PROBÍHÁ / DO 7 DNŮ'::text, interval '0 days', interval '7 days'),
    (2, '8–14 DNŮ', interval '7 days', interval '14 days'),
    (3, '15–30 DNŮ', interval '14 days', interval '30 days'),
    (4, 'NAD 30 DNŮ', interval '30 days', interval '365 days')
), outage_scope as (
  select outage.id, outage.external_id, outage.starts_at,
    case
      when outage.starts_at < now() + interval '7 days' then 1
      when outage.starts_at < now() + interval '14 days' then 2
      when outage.starts_at <= now() + interval '30 days' then 3
      else 4
    end as sort_order
  from public.complete_power_outages outage
  where outage.source = 'cez'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '365 days'
), projection_counts as (
  select case
      when projection.starts_at < now() + interval '7 days' then 1
      when projection.starts_at < now() + interval '14 days' then 2
      when projection.starts_at <= now() + interval '30 days' then 3
      else 4
    end as sort_order,
    count(*)::bigint as projection_outage_count
  from public.complete_power_outage_cez_projection_outages projection
  where projection.source_status in ('scheduled', 'active')
    and projection.ends_at >= now()
    and projection.starts_at <= now() + interval '365 days'
  group by 1
), production_counts as (
  select scope.sort_order,
    count(*)::bigint as production_outage_count,
    min(scope.starts_at) as nearest_starts_at,
    max(scope.starts_at) as furthest_starts_at
  from outage_scope scope
  group by scope.sort_order
), address_counts as (
  select scope.sort_order,
    count(address.id)::bigint as address_count,
    count(address.id) filter (where address.normalization_version >= 2)::bigint as normalized_count,
    count(address.id) filter (where address.normalization_version >= 2
      and (address.address_scope = 'unresolved'
        or address.lookup_status = 'needs_review'))::bigint as address_review_count,
    count(address.id) filter (where address.normalization_version < 2)::bigint as address_pending_count,
    count(address.id) filter (where address.lookup_status = 'error'
      or (address.lookup_status = 'processing'
        and address.processing_expires_at <= now()))::bigint as address_error_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope = 'exact')::bigint as exact_address_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope = 'street')::bigint as street_address_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope in ('municipality', 'unresolved'))::bigint as broad_address_count
  from outage_scope scope
  left join public.complete_power_outage_addresses address on address.outage_id = scope.id
  group by scope.sort_order
), target_counts as (
  select scope.sort_order,
    count(target.id)::bigint as discovery_target_count,
    count(target.id) filter (where target.target_kind = 'exact_number')::bigint as exact_target_count,
    count(target.id) filter (where target.target_kind = 'street')::bigint as street_target_count
  from outage_scope scope
  join public.complete_power_outage_addresses address on address.outage_id = scope.id
  left join public.complete_power_outage_address_targets target
    on target.outage_address_id = address.id
  group by scope.sort_order
), company_counts as (
  select scope.sort_order,
    count(company.id)::bigint as company_candidate_count,
    count(company.id) filter (where company.candidate_status = 'confirmed')::bigint as confirmed_company_count,
    count(company.id) filter (where company.candidate_status = 'needs_review')::bigint as review_company_count,
    count(company.id) filter (where company.candidate_status = 'new')::bigint as new_company_count
  from outage_scope scope
  join public.complete_power_outage_addresses address on address.outage_id = scope.id
  left join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  group by scope.sort_order
)
select
  bands.horizon_band,
  coalesce(projection.projection_outage_count, 0) as source_projection_outage_count,
  coalesce(production.production_outage_count, 0) as complete_outage_count,
  coalesce(addresses.address_count, 0) as complete_address_count,
  coalesce(addresses.normalized_count, 0) as normalized_address_count,
  coalesce(addresses.address_review_count, 0) as address_needs_review_count,
  coalesce(addresses.address_pending_count, 0) as address_pending_count,
  coalesce(addresses.address_error_count, 0) as address_error_count,
  coalesce(addresses.exact_address_count, 0) as exact_address_count,
  coalesce(addresses.street_address_count, 0) as street_address_count,
  coalesce(addresses.broad_address_count, 0) as broad_address_count,
  coalesce(targets.discovery_target_count, 0) as discovery_target_count,
  coalesce(targets.exact_target_count, 0) as exact_target_count,
  coalesce(targets.street_target_count, 0) as street_target_count,
  coalesce(companies.company_candidate_count, 0) as company_candidate_count,
  coalesce(companies.confirmed_company_count, 0) as confirmed_company_count,
  coalesce(companies.review_company_count, 0) as company_needs_review_count,
  coalesce(companies.new_company_count, 0) as new_company_count,
  production.nearest_starts_at,
  production.furthest_starts_at
from bands
left join projection_counts projection using (sort_order)
left join production_counts production using (sort_order)
left join address_counts addresses using (sort_order)
left join target_counts targets using (sort_order)
left join company_counts companies using (sort_order)
order by bands.sort_order;

-- 4. Skutečné předání aktuálních ČEZ cílů providerům ARES a Mapy.com.
-- Hledání firem je záměrně omezené na odstávky nejvýše 30 dní dopředu.
with providers(provider) as (
  values ('ares'::text), ('mapy'::text)
), eligible_targets as materialized (
  select outage.id as outage_id, address.id as address_id, target.id as target_id,
    target.target_kind, target.created_at as target_created_at, provider.provider
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address on address.outage_id = outage.id
  join public.complete_power_outage_address_targets target
    on target.outage_address_id = address.id
  cross join providers provider
  where outage.source = 'cez'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and (
      provider.provider = 'ares' and target.target_kind = 'exact_number'
      or provider.provider = 'mapy' and target.target_kind in ('exact_number', 'street')
    )
), lookup_stats as (
  select
    eligible.provider,
    count(*)::bigint as eligible_target_count,
    count(*) filter (where lookup.id is null)::bigint as not_handed_off_count,
    count(*) filter (
      where lookup.id is null
        and eligible.target_created_at >= now() - interval '15 minutes'
    )::bigint as fresh_not_handed_off_count,
    count(*) filter (
      where lookup.id is null
        and eligible.target_created_at < now() - interval '15 minutes'
    )::bigint as stale_not_handed_off_count,
    count(*) filter (where lookup.lookup_status = 'pending')::bigint as pending_count,
    count(*) filter (where lookup.lookup_status = 'ready')::bigint as ready_count,
    count(*) filter (where lookup.lookup_status = 'not_found')::bigint as not_found_count,
    count(*) filter (where lookup.lookup_status = 'skipped')::bigint as skipped_count,
    count(*) filter (where lookup.lookup_status = 'error')::bigint as error_count,
    coalesce(sum(lookup.result_count), 0)::bigint as provider_result_count,
    min(eligible.target_created_at) filter (
      where lookup.id is null
    ) as oldest_not_handed_off_target_at,
    min(lookup.created_at) filter (
      where lookup.id is not null and lookup.lookup_status in ('pending', 'error')
    ) as oldest_unfinished_lookup_at,
    max(coalesce(lookup.finished_at, lookup.last_attempt_at)) as latest_provider_progress_at
  from eligible_targets eligible
  left join public.complete_power_outage_target_lookups lookup
    on lookup.target_id = eligible.target_id and lookup.provider = eligible.provider
  group by eligible.provider
), company_stats as (
  select
    eligible.provider,
    count(distinct company.id)::bigint as resulting_company_count,
    count(distinct company.id) filter (where evidence.id is not null)::bigint
      as company_with_provider_evidence_count
  from eligible_targets eligible
  join public.complete_power_outage_companies company
    on company.outage_address_id = eligible.address_id
  left join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = company.id and evidence.provider = eligible.provider
  group by eligible.provider
)
select
  lookup.provider,
  lookup.eligible_target_count,
  lookup.not_handed_off_count,
  lookup.fresh_not_handed_off_count,
  lookup.stale_not_handed_off_count,
  lookup.pending_count,
  lookup.ready_count,
  lookup.not_found_count,
  lookup.skipped_count,
  lookup.error_count,
  lookup.provider_result_count,
  coalesce(companies.resulting_company_count, 0) as resulting_company_count,
  coalesce(companies.company_with_provider_evidence_count, 0)
    as company_with_provider_evidence_count,
  lookup.oldest_not_handed_off_target_at,
  lookup.oldest_unfinished_lookup_at,
  lookup.latest_provider_progress_at
from lookup_stats lookup
left join company_stats companies using (provider)
order by lookup.provider;
