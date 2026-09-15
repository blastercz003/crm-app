-- Opraveny read-only prepocet prechodove mezery EG.D matcheru v5.
-- Pouziva aktualni produkcni exact_number targety (jeden target = jeden
-- zachovany par cisla popisneho/orientacniho). Nic nezapisuje a nevola sit.

with scoped_candidates as (
  select
    outage.id as outage_id,
    address.id as outage_address_id,
    address.municipality,
    address.town_part,
    address.street,
    address.postal_code,
    address.ruian_address_id,
    address.latitude as address_latitude,
    address.longitude as address_longitude,
    company.id as company_id,
    company.company_name,
    company.ico,
    company.candidate_status as original_candidate_status,
    company.latitude as company_latitude,
    company.longitude as company_longitude,
    case
      when company.candidate_status = 'confirmed' then 'confirmed_without_v5'
      else 'needs_review_number_role_conflict'
    end as scope_reason
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and (
      (
        company.candidate_status = 'confirmed'
        and company.metadata #>> '{addressMatchV5,finalDisposition}' is null
        and not exists (
          select 1
          from public.complete_power_outage_company_evidence existing_evidence
          where existing_evidence.company_id = company.id
            and existing_evidence.metadata #>> '{addressMatch,contract}'
              = 'complete-address-match-v5'
        )
      )
      or (
        company.candidate_status = 'needs_review'
        and company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
      )
    )
), production_targets as (
  select
    scope.*,
    target.id as target_id,
    target.number_token,
    nullif(target.metadata ->> 'houseNumber', '') as target_house_number,
    nullif(target.metadata ->> 'orientationNumber', '') as target_orientation_number,
    coalesce(target.latitude, scope.address_latitude) as target_latitude,
    coalesce(target.longitude, scope.address_longitude) as target_longitude
  from scoped_candidates scope
  join public.complete_power_outage_address_targets target
    on target.outage_address_id = scope.outage_address_id
   and target.target_kind = 'exact_number'
), normalized_targets as (
  select
    target.*,
    coalesce(
      target.target_house_number,
      case
        when target.target_orientation_number is null then target.number_token
        else null
      end
    ) as effective_house_number,
    target.target_orientation_number as effective_orientation_number,
    jsonb_build_array(jsonb_build_object(
      'houseNumber', coalesce(
        target.target_house_number,
        case
          when target.target_orientation_number is null then target.number_token
          else null
        end
      ),
      'orientationNumber', target.target_orientation_number
    )) as target_number_pair
  from production_targets target
), evaluated as (
  select
    target.*,
    evidence.id as evidence_id,
    evidence.provider,
    evidence.display_address as evidence_display_address,
    base.classification as base_classification,
    base.automatic_confirmation_allowed as base_confirmation_allowed,
    base.reason_codes as base_reason_codes,
    base.distance_meters,
    public.complete_power_outage_number_role_result_v5(
      target.target_number_pair,
      evidence.display_address,
      evidence.metadata
    ) as number_role_result
  from normalized_targets target
  join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = target.company_id
   and evidence.provider <> 'google'
  left join lateral public.evaluate_complete_power_outage_address_match_v4(
    target.municipality,
    target.town_part,
    target.street,
    target.effective_house_number,
    target.effective_orientation_number,
    target.postal_code,
    target.ruian_address_id,
    target.target_latitude,
    target.target_longitude,
    evidence.display_address,
    case
      when coalesce(
        evidence.metadata ->> 'ruianAddressId',
        evidence.metadata #>> '{structuredAddress,ruianAddressId}'
      ) ~ '^[0-9]+$'
      then coalesce(
        evidence.metadata ->> 'ruianAddressId',
        evidence.metadata #>> '{structuredAddress,ruianAddressId}'
      )::bigint
      else null
    end,
    target.company_latitude,
    target.company_longitude,
    evidence.distance_meters
  ) base on true
), effective as (
  select
    evaluated.*,
    case
      when base_classification = 'address_conflict' then 'conflict'
      when not base_confirmation_allowed then 'needs_review'
      when number_role_result = 'exact' then 'verified'
      when number_role_result = 'unresolved' then 'needs_review'
      else 'conflict'
    end as evidence_target_disposition,
    case
      when base_classification = 'address_conflict' then base_reason_codes
      when not base_confirmation_allowed then base_reason_codes
      when number_role_result = 'exact'
        then array_append(base_reason_codes, 'building_number_roles_match')
      when number_role_result = 'unresolved'
        then array['building_number_roles_unresolved']::text[]
      else array['building_number_roles_mismatch']::text[]
    end as effective_reason_codes
  from evaluated
), decisions as (
  select
    scope.company_id,
    min(scope.company_name) as company_name,
    min(scope.ico) as ico,
    min(scope.scope_reason) as scope_reason,
    min(scope.original_candidate_status) as original_candidate_status,
    count(distinct target.target_id)::integer as evaluated_target_count,
    count(distinct effective.evidence_id)::integer as evidence_count,
    count(effective.evidence_id)::bigint as evaluated_combination_count,
    coalesce(bool_or(
      'postal_code_mismatch' = any(effective.effective_reason_codes)
    ), false) as has_postal_conflict,
    case
      when bool_or(effective.evidence_target_disposition = 'verified') then 'verified'
      when bool_or(effective.evidence_target_disposition = 'needs_review') then 'needs_review'
      else 'conflict'
    end as final_disposition
  from scoped_candidates scope
  left join normalized_targets target
    on target.company_id = scope.company_id
  left join effective
    on effective.company_id = scope.company_id
   and effective.target_id = target.target_id
  group by scope.company_id
), classified as (
  select
    decision.*,
    case final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end as proposed_candidate_status
  from decisions decision
)
select
  scope_reason,
  original_candidate_status,
  final_disposition,
  proposed_candidate_status,
  has_postal_conflict,
  count(*)::bigint as candidate_count,
  count(*) filter (
    where original_candidate_status <> proposed_candidate_status
  )::bigint as change_count,
  min(evaluated_target_count) as minimum_target_count,
  max(evaluated_target_count) as maximum_target_count,
  min(evidence_count) as minimum_evidence_count,
  max(evidence_count) as maximum_evidence_count,
  sum(evaluated_combination_count)::bigint as evaluated_combination_count
from classified
group by
  scope_reason,
  original_candidate_status,
  final_disposition,
  proposed_candidate_status,
  has_postal_conflict
order by scope_reason, final_disposition, has_postal_conflict desc;
