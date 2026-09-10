with current_candidates as (
  select
    company.id,
    company.candidate_status,
    company.evaluation_version,
    company.resolved_by,
    score.score_status,
    score.scoring_version,
    score.score,
    score.grade
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score on score.candidate_id = company.id
  where company.candidate_status <> 'stale'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
), automatic_exact_mapy as (
  select distinct company.id
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  join public.complete_power_outage_company_evidence evidence on evidence.company_id = company.id
  where company.resolved_by is null
    and company.evaluation_version >= 3
    and address.address_scope = 'exact'
    and evidence.provider = 'mapy'
    and evidence.evidence_kind = 'establishment'
    and evidence.match_level in ('exact_address', 'same_building')
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
), lidl_ostrov as (
  select
    company.candidate_status,
    company.evaluation_version,
    score.score,
    score.grade,
    score.scoring_version,
    score.breakdown ->> 'contract' as score_contract
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score on score.candidate_id = company.id
  where outage.source = 'cez'
    and outage.starts_at = '2026-09-16 05:00:00+00'::timestamptz
    and outage.ends_at = '2026-09-16 16:00:00+00'::timestamptz
    and lower(company.company_name) like '%lidl%'
    and address.normalized_municipality = 'ostrov'
    and address.normalized_street = 'obchodni'
    and address.house_number = '1446'
)
select 'FUNCTION' as check_type, 'Mapy category supplies industry evidence' as object_name,
  to_regprocedure('public.complete_power_outage_mapy_industry_points(text[])') is not null as is_correct
union all
select 'FUNCTION', 'evaluation queue uses matching version three',
  position('company.evaluation_version < 3' in pg_get_functiondef(
    'public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure
  )) > 0
union all
select 'FUNCTION', 'evaluation progress uses matching version three',
  position('company.evaluation_version >= 3' in pg_get_functiondef(
    'public.refresh_complete_power_outage_evaluation_progress_snapshot()'::regprocedure
  )) > 0
union all
select 'GRANT', 'authenticated cannot calculate category points',
  not has_function_privilege(
    'authenticated',
    'public.complete_power_outage_mapy_industry_points(text[])',
    'EXECUTE'
  )
union all
select 'LOGIC', 'all automatic exact Mapy matches are confirmed',
  not exists (
    select 1
    from automatic_exact_mapy exact_match
    join public.complete_power_outage_companies company on company.id = exact_match.id
    where company.candidate_status <> 'confirmed'
  )
union all
select 'LOGIC', 'missing NACE uses Mapy category or neutral value',
  not exists (
    select 1
    from public.complete_power_outage_company_score_inputs input
    where cardinality(input.nace_codes) = 0
      and (
        input.industry_evidence_source not in ('mapy_category', 'neutral_unknown')
        or input.industry_evidence_source = 'neutral_unknown' and input.industry_points <> 35
      )
  )
union all
select 'DATA', 'all current candidates use evaluation version three',
  not exists (select 1 from current_candidates where evaluation_version < 3)
union all
select 'DATA', 'all current scores use scoring version two',
  not exists (
    select 1 from current_candidates
    where scoring_version is null
      or scoring_version < 2
      or score_status in ('pending', 'stale', 'error')
  )
union all
select 'DATA', 'Lidl Ostrov exact Mapy match is confirmed',
  exists (
    select 1 from lidl_ostrov
    where candidate_status = 'confirmed' and evaluation_version >= 3
  )
union all
select 'DATA', 'Lidl Ostrov score uses version two',
  exists (
    select 1 from lidl_ostrov
    where scoring_version >= 2
      and score_contract = 'complete-commercial-score-v2'
      and score is not null
      and grade is not null
  )
union all
select 'SAFETY', 'Google is absent from active scoring inputs',
  position('google' in lower(pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true))) = 0
union all
select 'ISOLATION', 'matching and scoring remain in COMPLETE scope',
  position('public.stores' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
  and position('power_outage_store_matches' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
order by check_type, object_name;
