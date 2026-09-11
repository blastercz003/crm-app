begin;

-- Krok 2: dynamicky, pouze pro cteni, prevede registrovane volby AI SELECT
-- na unikatni firmy podle ICO. Nevytvari frontu, worker, CRON ani HTTP pozadavek.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null
     or to_regclass('public.complete_power_outage_contact_discovery_state') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_addresses') is null
     or to_regclass('public.complete_power_outages') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_company_scores') is null
     or to_regclass('public.complete_power_outage_company_top_selections') is null
     or to_regclass('public.complete_power_outage_top_selection_versions') is null
  then
    raise exception 'Chybi zavislosti pro adapter selektoru dohledavani kontaktu.';
  end if;
end
$$;

-- Pomaha dynamickemu vyberu nad potvrzenymi firmami bez zmeny jejich dat.
create index if not exists cpo_companies_contact_discovery_selector_idx
  on public.complete_power_outage_companies (
    ico,
    outage_address_id,
    id
  )
  where candidate_status = 'confirmed'
    and business_relevance_status = 'eligible'
    and ico is not null;

-- Jeden radek = jeden aktivni selector + jedno ICO. Pokud se stejna firma
-- vyskytuje u vice adres nebo odstavek, adapter je slouci a zachova souhrn.
create or replace view public.complete_power_outage_contact_discovery_selector_targets
with (security_invoker = true)
as
with eligible_candidates as (
  select
    selector_row.selector_key,
    selector_row.display_name as selector_display_name,
    selector_row.commercial_filter,
    selector_row.selection_version_key,
    selector_row.selector_contract,
    company.id as candidate_id,
    company.ico,
    company.company_name,
    outage.id as outage_id,
    outage.source,
    outage.starts_at,
    outage.ends_at
  from public.complete_power_outage_contact_discovery_selectors selector_row
  join public.complete_power_outage_companies company
    on company.candidate_status = 'confirmed'
   and company.business_relevance_status = 'eligible'
   and company.ico is not null
   and company.ico ~ '^[0-9]{8}$'
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  left join public.complete_power_outage_top_selection_versions top_version
    on top_version.version_key = selector_row.selection_version_key
  where selector_row.lifecycle_status = 'active'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
    and (
      selector_row.commercial_filter = 'all'
      or selector_row.commercial_filter = 'grade_a'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
      or selector_row.commercial_filter = 'grade_b'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'B'
      or selector_row.commercial_filter = 'top'
        and top_version.lifecycle_status in ('active', 'archived')
        and top_row.rules_version = top_version.internal_rules_version
        and top_row.evaluation_status = 'eligible'
        and top_row.top_eligible
    )
), aggregated as (
  select
    candidate.selector_key,
    candidate.selector_display_name,
    candidate.commercial_filter,
    candidate.selection_version_key,
    candidate.selector_contract,
    candidate.ico,
    (array_agg(
      candidate.company_name
      order by candidate.starts_at, candidate.candidate_id
    ))[1] as representative_company_name,
    (array_agg(
      candidate.candidate_id
      order by candidate.starts_at, candidate.candidate_id
    ))[1] as representative_candidate_id,
    count(distinct candidate.candidate_id)::integer as candidate_count,
    count(distinct candidate.outage_id)::integer as outage_count,
    min(candidate.starts_at) as nearest_outage_starts_at,
    max(candidate.ends_at) as latest_outage_ends_at,
    array_agg(distinct candidate.source order by candidate.source) as outage_sources
  from eligible_candidates candidate
  group by
    candidate.selector_key,
    candidate.selector_display_name,
    candidate.commercial_filter,
    candidate.selection_version_key,
    candidate.selector_contract,
    candidate.ico
)
select
  aggregated.selector_key,
  aggregated.selector_display_name,
  aggregated.commercial_filter,
  aggregated.selection_version_key,
  aggregated.ico,
  profile.id as company_profile_id,
  coalesce(profile.official_name, aggregated.representative_company_name)
    as company_name,
  aggregated.representative_candidate_id,
  aggregated.candidate_count,
  aggregated.outage_count,
  aggregated.nearest_outage_starts_at,
  aggregated.latest_outage_ends_at,
  aggregated.outage_sources,
  (profile.id is not null) as has_company_profile,
  aggregated.selector_contract
from aggregated
left join public.complete_power_outage_company_profiles profile
  on profile.ico = aggregated.ico;

comment on view public.complete_power_outage_contact_discovery_selector_targets is
  'Dynamicky servisni adapter aktivnich kontaktovych selektoru na unikatni potvrzene firmy podle ICO; bez fronty a externich pozadavku.';

revoke all on table public.complete_power_outage_contact_discovery_selector_targets
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_discovery_selector_targets
  to service_role;

commit;
