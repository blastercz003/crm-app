-- KROK 1 / PROVOZNE CITLIVE: read-only audit dostupnosti dat.
--
-- Skript:
--   * nic nevytvari ani nemeni,
--   * nevola ARES, Mapy.com ani jiny externi server,
--   * pracuje pouze s aktualnimi/budoucimi POTVRZENYMI zaznamy v tabu KOMPLETNI,
--   * povazuje chybejici Mapy.com data za neutralni stav.
--
-- Kazdy ze tri SELECTu lze v Supabase SQL editoru spustit samostatne.

-- 1/3 Souhrn pokryti podle distributora a za cely tab KOMPLETNI.
with evidence_by_company as (
  select
    evidence.company_id,
    bool_or(
      evidence.provider = 'mapy'
      and evidence.evidence_kind = 'establishment'
    ) as mapy_establishment_available,
    bool_or(
      evidence.provider = 'mapy'
      and evidence.evidence_kind = 'establishment'
      and evidence.match_level in ('exact_address', 'same_building')
    ) as exact_mapy_establishment_available,
    bool_or(
      evidence.provider = 'mapy'
      and nullif(btrim(evidence.metadata ->> 'label'), '') is not null
    ) as mapy_label_available
  from public.complete_power_outage_company_evidence evidence
  group by evidence.company_id
), mapy_lookup_by_address as (
  select
    target.outage_address_id,
    bool_or(lookup.lookup_status in ('ready', 'not_found', 'error')) as mapy_lookup_attempted,
    bool_or(lookup.lookup_status = 'ready') as mapy_lookup_ready,
    bool_or(lookup.lookup_status = 'not_found') as mapy_lookup_not_found,
    bool_or(lookup.lookup_status = 'error') as mapy_lookup_error
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_target_lookups lookup
    on lookup.target_id = target.id
   and lookup.provider = 'mapy'
  group by target.outage_address_id
), audit_scope as (
  select
    company.id as company_record_id,
    company.ico,
    company.company_name,
    outage.source,
    profile.id is not null as ares_profile_available,
    profile.id is not null
      and (profile.expires_at is null or profile.expires_at > now()) as fresh_ares_profile_available,
    profile.employee_category_code is not null
      and profile.employee_category_code <> '000' as employee_category_available,
    exists (
      select 1
      from unnest(
        coalesce(profile.nace_2025_codes, '{}'::text[])
        || coalesce(profile.nace_2008_codes, '{}'::text[])
        || coalesce(profile.nace_codes, '{}'::text[])
        || coalesce(company.nace_codes, '{}'::text[])
      ) nace(code)
      where nace.code ~ '^[0-9]{2,6}$'
    ) as any_nace_available,
    exists (
      select 1
      from unnest(
        coalesce(profile.nace_2025_codes, '{}'::text[])
        || coalesce(profile.nace_2008_codes, '{}'::text[])
        || coalesce(profile.nace_codes, '{}'::text[])
        || coalesce(company.nace_codes, '{}'::text[])
      ) nace(code)
      where nace.code ~ '^[0-9]{4,6}$'
    ) as detailed_nace_available,
    coalesce(evidence.mapy_establishment_available, false) as mapy_establishment_available,
    coalesce(evidence.exact_mapy_establishment_available, false)
      as exact_mapy_establishment_available,
    coalesce(evidence.mapy_label_available, false) as mapy_label_available,
    coalesce(mapy_lookup.mapy_lookup_attempted, false) as mapy_lookup_attempted,
    coalesce(mapy_lookup.mapy_lookup_ready, false) as mapy_lookup_ready,
    coalesce(mapy_lookup.mapy_lookup_not_found, false) as mapy_lookup_not_found,
    coalesce(mapy_lookup.mapy_lookup_error, false) as mapy_lookup_error
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_profiles profile
    on profile.ico = company.ico
  left join evidence_by_company evidence
    on evidence.company_id = company.id
  left join mapy_lookup_by_address mapy_lookup
    on mapy_lookup.outage_address_id = company.outage_address_id
  where company.candidate_status = 'confirmed'
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
), scopes as (
  select 'ALL'::text as source
  union all select 'cez'
  union all select 'egd'
  union all select 'pre'
)
select
  scopes.source,
  count(audit.company_record_id)::bigint as confirmed_record_count,
  count(distinct audit.ico) filter (where audit.ico is not null)::bigint as unique_ico_count,
  count(audit.company_record_id) filter (where audit.ares_profile_available)::bigint as ares_profile_count,
  count(audit.company_record_id) filter (where audit.fresh_ares_profile_available)::bigint as fresh_ares_profile_count,
  count(audit.company_record_id) filter (where audit.any_nace_available)::bigint as any_nace_count,
  count(audit.company_record_id) filter (where audit.detailed_nace_available)::bigint as detailed_nace_count,
  count(audit.company_record_id) filter (where audit.employee_category_available)::bigint
    as employee_category_count,
  count(audit.company_record_id) filter (where audit.mapy_lookup_attempted)::bigint as mapy_lookup_attempted_count,
  count(audit.company_record_id) filter (where audit.mapy_lookup_ready)::bigint as mapy_lookup_ready_count,
  count(audit.company_record_id) filter (where audit.mapy_lookup_not_found)::bigint as mapy_lookup_not_found_count,
  count(audit.company_record_id) filter (where audit.mapy_lookup_error)::bigint as mapy_lookup_error_count,
  count(audit.company_record_id) filter (where audit.mapy_establishment_available)::bigint
    as mapy_establishment_count,
  count(audit.company_record_id) filter (where audit.exact_mapy_establishment_available)::bigint
    as exact_mapy_establishment_count,
  count(audit.company_record_id) filter (where audit.mapy_label_available)::bigint as mapy_label_count,
  count(audit.company_record_id) filter (
    where audit.detailed_nace_available
      and not audit.exact_mapy_establishment_available
  )::bigint as classifiable_from_ares_without_mapy_count,
  count(audit.company_record_id) filter (
    where audit.detailed_nace_available
      and audit.exact_mapy_establishment_available
  )::bigint as ares_with_mapy_support_count,
  count(audit.company_record_id) filter (
    where not audit.detailed_nace_available
      and audit.exact_mapy_establishment_available
      and audit.mapy_label_available
  )::bigint as mapy_may_add_evidence_count,
  count(audit.company_record_id) filter (
    where not audit.detailed_nace_available
      and not audit.mapy_label_available
  )::bigint as insufficient_structured_classification_count,
  round(
    100.0 * count(audit.company_record_id) filter (where audit.detailed_nace_available)
    / nullif(count(audit.company_record_id), 0),
    2
  ) as detailed_nace_coverage_percent,
  round(
    100.0 * count(audit.company_record_id) filter (where audit.exact_mapy_establishment_available)
    / nullif(count(audit.company_record_id), 0),
    2
  ) as exact_mapy_coverage_percent
from scopes
left join audit_scope audit
  on scopes.source = 'ALL' or audit.source = scopes.source
group by scopes.source
order by case scopes.source when 'ALL' then 0 when 'cez' then 1 when 'egd' then 2 else 3 end;

-- 2/3 Rozlozeni podrobnych NACE. Jde o podklad pro allow/deny matici v kroku 2,
-- nikoliv o hotove rozhodnuti, zda firma do filtru patri.
with evidence_by_company as (
  select
    evidence.company_id,
    bool_or(
      evidence.provider = 'mapy'
      and evidence.evidence_kind = 'establishment'
      and evidence.match_level in ('exact_address', 'same_building')
    ) as exact_mapy_establishment_available
  from public.complete_power_outage_company_evidence evidence
  group by evidence.company_id
), audit_scope as (
  select
    company.id as company_record_id,
    company.ico,
    outage.source,
    coalesce(evidence.exact_mapy_establishment_available, false)
      as exact_mapy_establishment_available,
    array(
      select distinct nace.code
      from unnest(
        coalesce(profile.nace_2025_codes, '{}'::text[])
        || coalesce(profile.nace_2008_codes, '{}'::text[])
        || coalesce(profile.nace_codes, '{}'::text[])
        || coalesce(company.nace_codes, '{}'::text[])
      ) nace(code)
      where nace.code ~ '^[0-9]{4,6}$'
      order by nace.code
    ) as detailed_nace_codes
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_profiles profile
    on profile.ico = company.ico
  left join evidence_by_company evidence
    on evidence.company_id = company.id
  where company.candidate_status = 'confirmed'
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
)
select
  left(nace.code, 2) as nace_division,
  nace.code as detailed_nace_code,
  count(distinct audit.company_record_id)::bigint as record_count,
  count(distinct audit.ico) filter (where audit.ico is not null)::bigint as unique_ico_count,
  count(distinct audit.company_record_id) filter (
    where audit.exact_mapy_establishment_available
  )::bigint as exact_mapy_supported_record_count,
  count(distinct audit.company_record_id) filter (
    where not audit.exact_mapy_establishment_available
  )::bigint as ares_without_mapy_record_count
from audit_scope audit
cross join lateral unnest(audit.detailed_nace_codes) nace(code)
group by left(nace.code, 2), nace.code
order by record_count desc, nace.code;

-- 3/3 Skutecne ulozene Mapy.com stitky. Chybejici stitek zde zamerne neni
-- interpretovan jako negativni informace.
with audit_scope as (
  select company.id as company_record_id
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where company.candidate_status = 'confirmed'
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
)
select
  evidence.metadata ->> 'label' as mapy_label,
  count(distinct evidence.company_id)::bigint as record_count,
  count(*) filter (
    where evidence.match_level in ('exact_address', 'same_building')
  )::bigint as exact_or_same_building_evidence_count
from audit_scope audit
join public.complete_power_outage_company_evidence evidence
  on evidence.company_id = audit.company_record_id
 and evidence.provider = 'mapy'
where nullif(btrim(evidence.metadata ->> 'label'), '') is not null
group by evidence.metadata ->> 'label'
order by record_count desc, mapy_label;
