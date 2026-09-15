-- Read-only audit adresniho rozhodovani vyhradne pro EG.D v tabu KOMPLETNI.
-- Kazdy ze tri dotazu se spousti samostatne. Zadny dotaz nic nezapisuje,
-- nespousti workery a nevola EG.D, ARES ani Mapy.com.

-- 1. Rozhodovaci matice aktualnich a budoucich kandidatu.
with current_egd as (
  select
    outage.id as outage_id,
    address.id as address_id,
    address.address_scope,
    target.id as target_id,
    company.id as company_id,
    company.ico,
    company.candidate_status,
    company.metadata #>> '{addressMatchV5,finalDisposition}' as historical_v5_disposition,
    company.metadata #>> '{addressMatchV5,numberRoleResult}' as historical_number_role
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  left join public.complete_power_outage_address_match_v4_targets target
    on target.outage_address_id = address.id
   and target.source = 'egd'
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
), evidence as (
  select
    scope.company_id,
    string_agg(distinct evidence.provider, ' + ' order by evidence.provider)
      filter (where evidence.provider <> 'google') as providers,
    bool_or(
      evidence.provider <> 'google'
      and evidence.match_level in ('exact_address', 'same_building')
    ) as has_exact_evidence,
    bool_or(
      evidence.metadata #>> '{addressMatch,contract}' = 'complete-address-match-v5'
    ) as has_v5_evidence,
    bool_or(
      evidence.metadata #>> '{addressMatch,classification}' = 'needs_external_verification'
      or evidence.metadata #>> '{addressMatch,finalDisposition}' = 'needs_review'
    ) as has_v5_review_evidence,
    bool_or(
      evidence.metadata #>> '{addressMatch,classification}' = 'address_conflict'
      or evidence.metadata #>> '{addressMatch,finalDisposition}' = 'conflict'
    ) as has_v5_conflict_evidence,
    max(evidence.metadata #>> '{addressMatch,numberRoleResult}')
      filter (where evidence.metadata #>> '{addressMatch,numberRoleResult}' is not null)
      as evidence_number_role
  from current_egd scope
  left join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = scope.company_id
  group by scope.company_id
), classified as (
  select
    scope.*,
    coalesce(evidence.providers, 'BEZ DUKAZU') as providers,
    coalesce(evidence.has_exact_evidence, false) as has_exact_evidence,
    coalesce(evidence.has_v5_evidence, false) as has_v5_evidence,
    coalesce(evidence.has_v5_review_evidence, false) as has_v5_review_evidence,
    coalesce(evidence.has_v5_conflict_evidence, false) as has_v5_conflict_evidence,
    coalesce(scope.historical_number_role, evidence.evidence_number_role, 'nezaznamenano')
      as number_role_result,
    coalesce(
      scope.historical_v5_disposition,
      case
        when evidence.has_v5_conflict_evidence then 'conflict'
        when evidence.has_exact_evidence then 'verified'
        when evidence.has_v5_review_evidence then 'needs_review'
        else 'nezaznamenano'
      end
    ) as address_disposition
  from current_egd scope
  left join evidence using (company_id)
)
select
  candidate_status,
  address_scope,
  address_disposition,
  number_role_result,
  providers,
  has_exact_evidence,
  has_v5_evidence,
  count(*)::bigint as candidate_count,
  count(distinct outage_id)::bigint as outage_count,
  count(distinct address_id)::bigint as address_count,
  count(distinct ico) filter (where ico is not null)::bigint as unique_ico_count
from classified
group by
  candidate_status,
  address_scope,
  address_disposition,
  number_role_result,
  providers,
  has_exact_evidence,
  has_v5_evidence
order by
  case candidate_status
    when 'confirmed' then 1
    when 'needs_review' then 2
    when 'new' then 3
    when 'stale' then 4
    else 5
  end,
  candidate_count desc,
  address_scope,
  providers;

-- 2. Stratifikovany vzorek: maximalne 12 radku z kazde rozhodovaci skupiny.
with current_egd as (
  select
    outage.id as outage_id,
    outage.external_id,
    outage.starts_at,
    outage.ends_at,
    address.id as address_id,
    address.address_scope,
    address.raw_address as outage_raw_address,
    address.municipality as outage_municipality,
    address.town_part as outage_town_part,
    address.street as outage_street,
    address.house_number as outage_house_number,
    address.orientation_number as outage_orientation_number,
    address.postal_code as outage_postal_code,
    address.ruian_address_id as outage_ruian_address_id,
    address.latitude as outage_latitude,
    address.longitude as outage_longitude,
    target.id as target_id,
    target.building_number_pairs,
    company.id as company_id,
    company.company_name,
    company.ico,
    company.candidate_status,
    company.display_address as company_display_address,
    company.ruian_address_id as company_ruian_address_id,
    company.latitude as company_latitude,
    company.longitude as company_longitude,
    company.evaluation_version,
    company.evaluation_reasons,
    company.created_at as candidate_created_at,
    company.updated_at as candidate_updated_at,
    company.evaluated_at as candidate_evaluated_at,
    company.metadata #>> '{addressMatchV5,finalDisposition}' as historical_v5_disposition,
    company.metadata #>> '{addressMatchV5,numberRoleResult}' as historical_number_role
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  left join public.complete_power_outage_address_match_v4_targets target
    on target.outage_address_id = address.id
   and target.source = 'egd'
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and company.candidate_status in ('confirmed', 'needs_review', 'new')
), evidence_rollup as (
  select
    scope.company_id,
    string_agg(distinct evidence.provider, ' + ' order by evidence.provider)
      filter (where evidence.provider <> 'google') as providers,
    bool_or(
      evidence.provider <> 'google'
      and evidence.match_level in ('exact_address', 'same_building')
    ) as has_exact_evidence,
    bool_or(
      evidence.metadata #>> '{addressMatch,contract}' = 'complete-address-match-v5'
    ) as has_v5_evidence,
    max(evidence.metadata #>> '{addressMatch,numberRoleResult}')
      filter (where evidence.metadata #>> '{addressMatch,numberRoleResult}' is not null)
      as evidence_number_role
  from current_egd scope
  left join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = scope.company_id
  group by scope.company_id
), enriched as (
  select
    scope.*,
    coalesce(rollup.providers, 'BEZ DUKAZU') as providers,
    coalesce(rollup.has_exact_evidence, false) as has_exact_evidence,
    coalesce(rollup.has_v5_evidence, false) as has_v5_evidence,
    coalesce(scope.historical_number_role, rollup.evidence_number_role, 'nezaznamenano')
      as number_role_result,
    best.provider as selected_provider,
    best.evidence_kind,
    best.match_level,
    best.display_address as provider_display_address,
    best.distance_meters,
    best.metadata #>> '{structuredAddress,postalCode}' as provider_postal_code,
    best.metadata #>> '{structuredAddress,houseNumber}' as provider_house_number,
    best.metadata #>> '{structuredAddress,orientationNumber}' as provider_orientation_number,
    best.metadata #>> '{addressMatch,classification}' as stored_v5_classification,
    best.metadata #> '{addressMatch,reasonCodes}' as stored_v5_reason_codes,
    coalesce(v4.reason_codes, '{}'::text[]) as historical_v4_reason_codes,
    case
      when scope.candidate_status = 'new' and scope.address_scope = 'exact'
        then 'NOVY · CEKA NA VYHODNOCENI PRESNE ADRESY'
      when scope.candidate_status = 'new'
        then 'NOVY · CEKA NA VYHODNOCENI NEPRESNE ADRESY'
      when scope.candidate_status = 'confirmed'
        and not coalesce(rollup.has_v5_evidence, false)
        then 'POTVRZENO · BEZ V5 METADAT'
      when scope.candidate_status = 'confirmed'
        and scope.outage_ruian_address_id is not null
        and scope.company_ruian_address_id = scope.outage_ruian_address_id
        then 'POTVRZENO · SHODNE RUIAN ID'
      when scope.candidate_status = 'confirmed'
        and coalesce(scope.historical_number_role, rollup.evidence_number_role) = 'exact'
        then 'POTVRZENO · PRESNA ROLE CISEL'
      when scope.candidate_status = 'confirmed'
        then 'POTVRZENO · JINY PRESNY DUKAZ'
      when scope.address_scope = 'street'
        then 'K OVERENI · ULICE BEZ CISLA'
      when coalesce(scope.historical_number_role, rollup.evidence_number_role) = 'conflict'
        then 'K OVERENI · KONFLIKT ROLE CISLA'
      when coalesce(scope.historical_number_role, rollup.evidence_number_role) = 'unresolved'
        then 'K OVERENI · NEJEDNOZNACNA ROLE CISLA'
      when not coalesce(rollup.has_exact_evidence, false)
        then 'K OVERENI · BEZ PRESNEHO DUKAZU'
      else 'K OVERENI · JINY DUVOD'
    end as audit_bucket
  from current_egd scope
  left join evidence_rollup rollup using (company_id)
  left join lateral (
    select evidence.*
    from public.complete_power_outage_company_evidence evidence
    where evidence.company_id = scope.company_id
      and evidence.provider <> 'google'
    order by
      (evidence.match_level in ('exact_address', 'same_building')) desc,
      (evidence.metadata #>> '{addressMatch,contract}' = 'complete-address-match-v5') desc,
      evidence.confidence desc,
      evidence.observed_at desc,
      evidence.id
    limit 1
  ) best on true
  left join lateral (
    select array_agg(distinct reason order by reason) as reason_codes
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    cross join lateral unnest(evaluation.reason_codes) reason
    where evaluation.target_id = scope.target_id
      and evaluation.company_id = scope.company_id
  ) v4 on true
), ranked as (
  select
    enriched.*,
    row_number() over (
      partition by audit_bucket
      order by md5(company_id::text || outage_id::text)
    ) as sample_order
  from enriched
)
select
  audit_bucket,
  company_name,
  ico,
  candidate_status,
  starts_at,
  ends_at,
  outage_raw_address,
  outage_municipality,
  outage_town_part,
  outage_street,
  outage_house_number,
  outage_orientation_number,
  outage_postal_code,
  outage_ruian_address_id,
  company_display_address,
  company_ruian_address_id,
  providers,
  selected_provider,
  evidence_kind,
  match_level,
  has_exact_evidence,
  has_v5_evidence,
  number_role_result,
  provider_display_address,
  provider_postal_code,
  provider_house_number,
  provider_orientation_number,
  distance_meters,
  stored_v5_classification,
  stored_v5_reason_codes,
  historical_v5_disposition,
  evaluation_version,
  evaluation_reasons,
  candidate_created_at,
  candidate_updated_at,
  candidate_evaluated_at,
  historical_v4_reason_codes
from ranked
where sample_order <= 12
order by audit_bucket, sample_order;

-- 3. Automaticke invarianty a dve zname regrese.
with current_egd as (
  select
    outage.id as outage_id,
    address.id as address_id,
    address.address_scope,
    address.municipality as target_municipality,
    address.postal_code as target_postal_code,
    address.ruian_address_id as target_ruian_address_id,
    company.id as company_id,
    company.company_name,
    company.ico,
    company.candidate_status,
    company.display_address as company_display_address,
    company.ruian_address_id as company_ruian_address_id,
    company.evaluation_reasons,
    company.metadata #>> '{addressMatchV5,finalDisposition}' as v5_disposition,
    company.metadata #>> '{addressMatchV5,numberRoleResult}' as number_role_result
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
), evidence_flags as (
  select
    scope.company_id,
    bool_or(
      evidence.provider <> 'google'
      and evidence.match_level in ('exact_address', 'same_building')
    ) as has_exact_evidence,
    bool_or(
      evidence.metadata #>> '{addressMatch,classification}' = 'address_conflict'
      or evidence.metadata #>> '{addressMatch,finalDisposition}' = 'conflict'
      or evidence.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
    ) as has_v5_conflict,
    bool_or(
      evidence.match_level in ('exact_address', 'same_building')
      and evidence.distance_meters > 500
      and coalesce(evidence.metadata #>> '{addressMatch,classification}', '') <> 'exact_address'
    ) as suspicious_far_exact,
    bool_or(
      evidence.metadata #>> '{addressMatch,automaticConfirmationAllowed}' = 'true'
      and (
        evidence.metadata #>> '{addressMatch,classification}' = 'address_conflict'
        or evidence.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
      )
    ) as contradictory_v5_evidence
  from current_egd scope
  left join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = scope.company_id
  group by scope.company_id
), checks as (
  select
    'LOGIC'::text as check_type,
    'confirmed EGD candidates use exact outage addresses'::text as object_name,
    count(*) filter (
      where candidate_status = 'confirmed' and address_scope <> 'exact'
    )::bigint as finding_count
  from current_egd
  union all
  select 'LOGIC', 'confirmed EGD candidates have exact stored provider evidence',
    count(*) filter (
      where scope.candidate_status = 'confirmed'
        and not coalesce(flags.has_exact_evidence, false)
    )::bigint
  from current_egd scope
  left join evidence_flags flags using (company_id)
  union all
  select 'LOGIC', 'confirmed EGD candidates passed v5 address matching',
    count(*) filter (
      where scope.candidate_status = 'confirmed'
        and scope.v5_disposition is null
        and not exists (
          select 1
          from public.complete_power_outage_company_evidence evidence
          where evidence.company_id = scope.company_id
            and evidence.metadata #>> '{addressMatch,contract}'
              = 'complete-address-match-v5'
        )
    )::bigint
  from current_egd scope
  union all
  select 'LOGIC', 'confirmed EGD candidates have no stored postal conflict',
    count(*) filter (
      where candidate_status = 'confirmed'
        and target_postal_code is not null
        and public.complete_power_outage_postal_code_v4(company_display_address) is not null
        and public.complete_power_outage_postal_code_v4(company_display_address)
          <> public.complete_power_outage_postal_code_v4(target_postal_code)
    )::bigint
  from current_egd
  union all
  select 'LOGIC', 'confirmed EGD candidates are not marked as v5 conflicts',
    count(*) filter (
      where scope.candidate_status = 'confirmed'
        and (
          scope.v5_disposition = 'conflict'
          or scope.number_role_result = 'conflict'
          or coalesce(flags.has_v5_conflict, false)
        )
    )::bigint
  from current_egd scope
  left join evidence_flags flags using (company_id)
  union all
  select 'LOGIC', 'needs review EGD candidates retain a traceable reason',
    count(*) filter (
      where candidate_status = 'needs_review'
        and cardinality(evaluation_reasons) = 0
        and v5_disposition is null
        and number_role_result is null
    )::bigint
  from current_egd
  union all
  select 'LOGIC', 'stored v5 evidence never confirms its own conflict',
    count(*) filter (where coalesce(contradictory_v5_evidence, false))::bigint
  from evidence_flags
  union all
  select 'LOGIC', 'non RUIAN exact evidence is not accepted beyond five hundred metres',
    count(*) filter (where coalesce(suspicious_far_exact, false))::bigint
  from evidence_flags
  union all
  select 'REGRESSION', 'Nitto Denko EGD false match remains stale',
    count(*) filter (
      where lower(company.company_name) like 'nitto denko%'
        and company.candidate_status <> 'stale'
    )::bigint
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
   and outage.source = 'egd'
  union all
  select 'REGRESSION', 'OPEN GATE EGD false matches remain stale',
    count(*) filter (
      where lower(company.company_name) like '%open gate%'
        and company.candidate_status <> 'stale'
    )::bigint
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
   and outage.source = 'egd'
)
select
  check_type,
  object_name,
  finding_count,
  finding_count = 0 as is_correct
from checks
order by check_type, object_name;
