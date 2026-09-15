-- Ciste cteci audit budoucího toku EG.D v tabu KOMPLETNI.
-- Nic nespousti, nemeni ani nevola externi servery. Kazdy blok lze spustit samostatne.

-- 1. Integrita a provozni pripravenost celeho retezce EG.D -> KOMPLETNI -> provideri.
with upstream_state as (
  select state.*
  from public.power_outage_source_state state
  where state.source = 'egd'
), complete_state as (
  select state.*
  from public.complete_power_outage_source_state state
  where state.source = 'egd'
), upstream_current as (
  select outage.external_id
  from public.power_outages outage
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
), complete_current as (
  select outage.id, outage.external_id
  from public.complete_power_outages outage
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
), checks as (
  select 'COVERAGE'::text as check_type,
    'latest upstream EGD import used the whole distribution area'::text as object_name,
    coalesce((
      select state.metadata ->> 'queryScope' in (
        'whole-distribution-area', 'edge:whole-distribution-area'
      )
      from upstream_state state
    ), false) as is_correct

  union all
  select 'CRON', 'upstream EGD import is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_egd_every_six_hours')

  union all
  select 'CRON', 'COMPLETE EGD projection is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_egd_projection_every_six_hours')

  union all
  select 'CRON', 'COMPLETE address normalizer is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_address_normalization_every_minute')

  union all
  select 'CRON', 'COMPLETE ARES discovery is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_ares_every_minute')

  union all
  select 'CRON', 'COMPLETE Mapy discovery is active exactly once',
    (select count(*) = 1 from cron.job
      where active and jobname = 'power_outages_complete_mapy_every_minute')

  union all
  select 'FRESHNESS', 'upstream EGD import succeeded within eight hours',
    coalesce((select state.last_success_at >= now() - interval '8 hours'
      from upstream_state state), false)

  union all
  select 'FRESHNESS', 'COMPLETE EGD projection succeeded within eight hours',
    coalesce((select state.last_success_at >= now() - interval '8 hours'
      from complete_state state), false)

  union all
  select 'HEALTH', 'upstream EGD import has no current failure',
    coalesce((select state.consecutive_failure_count = 0
      and state.last_error_code is null
      and state.last_error_message is null
      from upstream_state state), false)

  union all
  select 'HEALTH', 'COMPLETE EGD projection has no current failure',
    coalesce((select state.coverage_status = 'complete'
      and state.consecutive_failure_count = 0
      and state.last_error_code is null
      and state.last_error_message is null
      from complete_state state), false)

  union all
  select 'PUBLICATION', 'COMPLETE EGD contains the latest upstream payload',
    coalesce((select complete.metadata ->> 'upstreamPayloadSha256'
        = upstream.latest_payload_sha256
      from complete_state complete cross join upstream_state upstream), false)

  union all
  select 'PUBLICATION', 'every current upstream EGD outage exists in COMPLETE',
    not exists (
      select 1 from upstream_current upstream
      left join complete_current complete using (external_id)
      where complete.id is null
    )

  union all
  select 'PUBLICATION', 'COMPLETE contains no current EGD outage outside upstream',
    not exists (
      select 1 from complete_current complete
      left join upstream_current upstream using (external_id)
      where upstream.external_id is null
    )

  union all
  select 'ADDRESS', 'every current COMPLETE EGD outage has an address',
    not exists (
      select 1 from complete_current outage
      where not exists (
        select 1 from public.complete_power_outage_addresses address
        where address.outage_id = outage.id
      )
    )

  union all
  select 'ADDRESS', 'every normalized actionable EGD address has a discovery target',
    not exists (
      select 1
      from complete_current outage
      join public.complete_power_outage_addresses address
        on address.outage_id = outage.id
      where address.normalization_version >= 2
        and address.address_scope in ('exact', 'street')
        and not exists (
          select 1 from public.complete_power_outage_address_targets target
          where target.outage_address_id = address.id
            and (
              address.address_scope = 'exact' and target.target_kind = 'exact_number'
              or address.address_scope = 'street' and target.target_kind = 'street'
            )
        )
    )

  union all
  select 'ADDRESS', 'EGD has no normalization backlog older than fifteen minutes',
    not exists (
      select 1
      from complete_current outage
      join public.complete_power_outage_addresses address
        on address.outage_id = outage.id
      where address.normalization_version < 2
        and address.updated_at < now() - interval '15 minutes'
    )

  union all
  select 'ISOLATION', 'audit scope contains only COMPLETE EGD data', true
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

-- 2. Posledni upstream import, projekce do KOMPLETNI a deklarovany horizont.
with latest_upstream_run as (
  select run.*
  from public.power_outage_sync_runs run
  where run.source = 'egd'
  order by run.started_at desc, run.id desc
  limit 1
), latest_complete_run as (
  select run.*
  from public.complete_power_outage_runs run
  where run.run_kind = 'source_sync' and run.source = 'egd'
  order by run.started_at desc, run.id desc
  limit 1
)
select
  upstream_run.id as upstream_run_id,
  upstream_run.status as upstream_run_status,
  upstream_run.started_at as upstream_started_at,
  upstream_run.finished_at as upstream_finished_at,
  upstream_run.source_record_count as upstream_source_record_count,
  upstream_run.outage_upsert_count as upstream_outage_upsert_count,
  upstream_run.address_upsert_count as upstream_address_upsert_count,
  upstream_run.metadata ->> 'queryScope' as upstream_run_query_scope,
  upstream_run.metadata ->> 'dateFrom' as upstream_run_date_from,
  upstream_run.metadata ->> 'dateTo' as upstream_run_date_to,
  upstream_run.metadata ->> 'normalizedTermCount' as upstream_normalized_term_count,
  upstream_run.metadata ->> 'coveredMunicipalityCount' as upstream_covered_municipality_count,
  upstream_run.error_code as upstream_run_error_code,
  upstream_run.error_message as upstream_run_error_message,
  upstream_state.last_attempt_at as upstream_last_attempt_at,
  upstream_state.last_success_at as upstream_last_success_at,
  upstream_state.active_outage_count as upstream_active_outage_count,
  upstream_state.future_outage_count as upstream_future_outage_count,
  upstream_state.consecutive_failure_count as upstream_failure_count,
  upstream_state.metadata ->> 'queryScope' as upstream_state_query_scope,
  upstream_state.metadata ->> 'dateFrom' as upstream_state_date_from,
  upstream_state.metadata ->> 'dateTo' as upstream_state_date_to,
  complete_run.id as complete_run_id,
  complete_run.status as complete_run_status,
  complete_run.started_at as complete_started_at,
  complete_run.finished_at as complete_finished_at,
  complete_run.source_record_count as complete_source_record_count,
  complete_run.outage_upsert_count as complete_outage_change_count,
  complete_run.address_upsert_count as complete_address_change_count,
  complete_run.error_code as complete_run_error_code,
  complete_run.error_message as complete_run_error_message,
  complete_state.coverage_status as complete_coverage_status,
  complete_state.last_success_at as complete_last_success_at,
  complete_state.published_outage_count,
  complete_state.published_address_count,
  complete_state.active_outage_count as complete_active_outage_count,
  complete_state.future_outage_count as complete_future_outage_count,
  complete_state.horizon_from,
  complete_state.horizon_to,
  complete_state.metadata ->> 'upstreamQueryScope' as complete_upstream_query_scope,
  complete_state.metadata ->> 'upstreamPayloadSha256' as projected_payload_sha256,
  upstream_state.latest_payload_sha256 as upstream_payload_sha256,
  complete_state.last_error_code as complete_error_code,
  complete_state.last_error_message as complete_error_message
from latest_upstream_run upstream_run
cross join latest_complete_run complete_run
cross join public.power_outage_source_state upstream_state
cross join public.complete_power_outage_source_state complete_state
where upstream_state.source = 'egd' and complete_state.source = 'egd';

-- 3. Budouci funnel po terminu: upstream -> KOMPLETNI -> adresy -> targety -> firmy.
with bands(sort_order, horizon_band) as (
  values
    (1, 'PROBIHA / DO 7 DNU'::text),
    (2, '8-14 DNU'),
    (3, '15-30 DNU'),
    (4, '31-60 DNU'),
    (5, '61-90 DNU')
), upstream_scope as (
  select outage.external_id, outage.starts_at,
    case
      when outage.starts_at < now() + interval '7 days' then 1
      when outage.starts_at < now() + interval '14 days' then 2
      when outage.starts_at <= now() + interval '30 days' then 3
      when outage.starts_at <= now() + interval '60 days' then 4
      else 5
    end as sort_order
  from public.power_outages outage
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '90 days'
), complete_scope as (
  select outage.id, outage.external_id, outage.starts_at,
    case
      when outage.starts_at < now() + interval '7 days' then 1
      when outage.starts_at < now() + interval '14 days' then 2
      when outage.starts_at <= now() + interval '30 days' then 3
      when outage.starts_at <= now() + interval '60 days' then 4
      else 5
    end as sort_order
  from public.complete_power_outages outage
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '90 days'
), upstream_counts as (
  select sort_order, count(*)::bigint as outage_count
  from upstream_scope group by sort_order
), complete_counts as (
  select sort_order, count(*)::bigint as outage_count,
    min(starts_at) as nearest_starts_at, max(starts_at) as furthest_starts_at
  from complete_scope group by sort_order
), address_counts as (
  select scope.sort_order,
    count(address.id)::bigint as address_count,
    count(address.id) filter (where address.normalization_version >= 2)::bigint
      as normalized_count,
    count(address.id) filter (where address.normalization_version < 2)::bigint
      as pending_count,
    count(address.id) filter (where address.lookup_status = 'error'
      or (address.lookup_status = 'processing'
        and address.processing_expires_at <= now()))::bigint as error_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope = 'exact')::bigint as exact_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope = 'street')::bigint as street_count,
    count(address.id) filter (where address.normalization_version >= 2
      and address.address_scope in ('municipality', 'unresolved'))::bigint as broad_count
  from complete_scope scope
  left join public.complete_power_outage_addresses address
    on address.outage_id = scope.id
  group by scope.sort_order
), target_counts as (
  select scope.sort_order,
    count(target.id)::bigint as target_count,
    count(target.id) filter (where target.target_kind = 'exact_number')::bigint
      as exact_target_count,
    count(target.id) filter (where target.target_kind = 'street')::bigint
      as street_target_count,
    count(target.id) filter (where target.target_kind = 'municipality')::bigint
      as municipality_target_count
  from complete_scope scope
  join public.complete_power_outage_addresses address on address.outage_id = scope.id
  left join public.complete_power_outage_address_targets target
    on target.outage_address_id = address.id
  group by scope.sort_order
), company_counts as (
  select scope.sort_order,
    count(company.id)::bigint as candidate_count,
    count(company.id) filter (where company.candidate_status = 'confirmed')::bigint
      as confirmed_count,
    count(company.id) filter (where company.candidate_status = 'needs_review')::bigint
      as review_count,
    count(company.id) filter (where company.candidate_status = 'new')::bigint
      as new_count,
    count(company.id) filter (where company.candidate_status = 'stale')::bigint
      as stale_count
  from complete_scope scope
  join public.complete_power_outage_addresses address on address.outage_id = scope.id
  left join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  group by scope.sort_order
)
select
  bands.horizon_band,
  coalesce(upstream.outage_count, 0) as upstream_outage_count,
  coalesce(complete.outage_count, 0) as complete_outage_count,
  coalesce(addresses.address_count, 0) as address_count,
  coalesce(addresses.normalized_count, 0) as normalized_address_count,
  coalesce(addresses.pending_count, 0) as pending_normalization_count,
  coalesce(addresses.error_count, 0) as address_error_count,
  coalesce(addresses.exact_count, 0) as exact_address_count,
  coalesce(addresses.street_count, 0) as street_address_count,
  coalesce(addresses.broad_count, 0) as broad_address_count,
  coalesce(targets.target_count, 0) as discovery_target_count,
  coalesce(targets.exact_target_count, 0) as exact_target_count,
  coalesce(targets.street_target_count, 0) as street_target_count,
  coalesce(targets.municipality_target_count, 0) as municipality_target_count,
  coalesce(companies.candidate_count, 0) as company_candidate_count,
  coalesce(companies.confirmed_count, 0) as confirmed_company_count,
  coalesce(companies.review_count, 0) as company_needs_review_count,
  coalesce(companies.new_count, 0) as new_company_count,
  coalesce(companies.stale_count, 0) as stale_company_count,
  complete.nearest_starts_at,
  complete.furthest_starts_at
from bands
left join upstream_counts upstream using (sort_order)
left join complete_counts complete using (sort_order)
left join address_counts addresses using (sort_order)
left join target_counts targets using (sort_order)
left join company_counts companies using (sort_order)
order by bands.sort_order;

-- 4. Skutecne predani aktualnich EG.D targetu do ARES a Mapy.com.
-- Firemni discovery je zamerne omezeno na odstávky nejvýše 30 dni dopredu.
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
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and (
      provider.provider = 'ares' and target.target_kind = 'exact_number'
      or provider.provider = 'mapy' and target.target_kind in ('exact_number', 'street')
    )
), lookup_stats as (
  select eligible.provider,
    count(*)::bigint as eligible_target_count,
    count(*) filter (where lookup.id is null)::bigint as not_handed_off_count,
    count(*) filter (where lookup.id is null
      and eligible.target_created_at >= now() - interval '15 minutes')::bigint
      as fresh_not_handed_off_count,
    count(*) filter (where lookup.id is null
      and eligible.target_created_at < now() - interval '15 minutes')::bigint
      as stale_not_handed_off_count,
    count(*) filter (where lookup.lookup_status = 'pending')::bigint as pending_count,
    count(*) filter (where lookup.lookup_status = 'ready')::bigint as ready_count,
    count(*) filter (where lookup.lookup_status = 'not_found')::bigint as not_found_count,
    count(*) filter (where lookup.lookup_status = 'skipped')::bigint as skipped_count,
    count(*) filter (where lookup.lookup_status = 'error')::bigint as error_count,
    count(*) filter (where lookup.lookup_status = 'needs_review')::bigint
      as lookup_needs_review_count,
    coalesce(sum(lookup.result_count), 0)::bigint as provider_result_count,
    min(eligible.target_created_at) filter (where lookup.id is null)
      as oldest_not_handed_off_target_at,
    min(lookup.created_at) filter (where lookup.lookup_status in ('pending', 'error'))
      as oldest_unfinished_lookup_at,
    max(coalesce(lookup.finished_at, lookup.last_attempt_at))
      as latest_provider_progress_at
  from eligible_targets eligible
  left join public.complete_power_outage_target_lookups lookup
    on lookup.target_id = eligible.target_id and lookup.provider = eligible.provider
  group by eligible.provider
), company_stats as (
  select eligible.provider,
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
  lookup.lookup_needs_review_count,
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
