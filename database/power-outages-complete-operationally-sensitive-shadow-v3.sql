begin;

-- PROVOZNE CITLIVE / SHADOW v3
-- Uzka finalni korekce nad v2: bezne ambulance a ordinace podle nazvu.
-- V2 historie zustava zachovana; produkcni selector, UI a e-maily zustavaji vypnute.
do $$
begin
  if to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v2(uuid)') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_rules') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_runs') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_results') is null
  then
    raise exception 'Chybi zavislosti pro SHADOW klasifikaci PROVOZNE CITLIVE v3.';
  end if;
end
$$;

insert into public.complete_power_outage_operational_sensitivity_rules (
  rule_key,
  rules_version,
  category,
  evidence_source,
  match_operator,
  match_value,
  effect,
  priority,
  minimum_employee_count,
  requires_exact_site_evidence,
  requires_mapy_evidence,
  active,
  rationale,
  metadata
)
values (
  'v3:name-small-outpatient-practice',
  3,
  'excluded_small_healthcare',
  'company_name',
  'regex',
  '(^|[^[:alpha:]])(ambulance|ordinace)($|[^[:alpha:]])',
  'exclude',
  950,
  null,
  false,
  false,
  true,
  'Jednoznacny nazev bezne ambulance nebo ordinace; potvrzeny kriticky zdravotni ci pobytovy provoz ma vyjimku.',
  jsonb_build_object(
    'revision', 'operational-sensitivity-v3',
    'overlayOnClassifier', 'v2',
    'criticalHealthcareOverride', true,
    'residentialCareOverride', true
  )
)
on conflict (rule_key) do update
set
  rules_version = excluded.rules_version,
  category = excluded.category,
  evidence_source = excluded.evidence_source,
  match_operator = excluded.match_operator,
  match_value = excluded.match_value,
  effect = excluded.effect,
  priority = excluded.priority,
  minimum_employee_count = excluded.minimum_employee_count,
  requires_exact_site_evidence = excluded.requires_exact_site_evidence,
  requires_mapy_evidence = excluded.requires_mapy_evidence,
  active = excluded.active,
  rationale = excluded.rationale,
  metadata = excluded.metadata,
  updated_at = now();

create or replace function public.classify_complete_power_outage_operational_sensitivity_v3(
  requested_candidate_id uuid
)
returns table (
  is_eligible boolean,
  category text,
  decision_kind text,
  decision_source text,
  winning_rule_key text,
  matched_rule_keys text[],
  primary_nace_codes text[],
  employee_count_min integer,
  exact_mapy_labels text[],
  mapy_evidence_available boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select *
    from public.classify_complete_power_outage_operational_sensitivity_v2(
      requested_candidate_id
    )
  ), candidate as (
    select company.company_name
    from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ), decision as (
    select
      base.*,
      candidate.company_name ~*
        '(^|[^[:alpha:]])(ambulance|ordinace)($|[^[:alpha:]])'
        and not (
          base.is_eligible
          and base.category in ('critical_healthcare', 'residential_care')
        ) as outpatient_name_excluded
    from base
    cross join candidate
  )
  select
    decision.is_eligible and not decision.outpatient_name_excluded,
    case when decision.outpatient_name_excluded then null else decision.category end,
    case when decision.outpatient_name_excluded then 'exclude' else decision.decision_kind end,
    case when decision.outpatient_name_excluded then 'company_name' else decision.decision_source end,
    case
      when decision.outpatient_name_excluded
        then 'v3:name-small-outpatient-practice'
      else decision.winning_rule_key
    end,
    case
      when decision.outpatient_name_excluded
        then decision.matched_rule_keys || array['v3:name-small-outpatient-practice']::text[]
      else decision.matched_rule_keys
    end,
    decision.primary_nace_codes,
    decision.employee_count_min,
    decision.exact_mapy_labels,
    decision.mapy_evidence_available
  from decision;
$$;

revoke all on function public.classify_complete_power_outage_operational_sensitivity_v3(uuid)
  from public, anon, authenticated;
grant execute on function public.classify_complete_power_outage_operational_sensitivity_v3(uuid)
  to service_role;

create or replace view public.complete_power_outage_operational_sensitivity_shadow_current
with (security_invoker = true)
as
select
  company.id as candidate_id,
  outage.id as outage_id,
  outage.source as outage_source,
  company.company_name,
  company.ico,
  company.candidate_status,
  company.business_relevance_status,
  outage.starts_at,
  outage.ends_at,
  decision.is_eligible,
  decision.category,
  decision.decision_kind,
  decision.decision_source,
  decision.winning_rule_key,
  decision.matched_rule_keys,
  decision.primary_nace_codes,
  decision.employee_count_min,
  decision.exact_mapy_labels,
  decision.mapy_evidence_available
from public.complete_power_outage_companies company
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id
cross join lateral public.classify_complete_power_outage_operational_sensitivity_v3(
  company.id
) decision
where company.candidate_status = 'confirmed'
  and company.business_relevance_status = 'eligible'
  and outage.ends_at >= now()
  and outage.source_status in ('scheduled', 'active');

revoke all on table public.complete_power_outage_operational_sensitivity_shadow_current
  from public, anon, authenticated;
grant select on table public.complete_power_outage_operational_sensitivity_shadow_current
  to service_role;

create or replace function public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_run_id uuid;
  scoped_count integer;
  included_count integer;
  explicitly_excluded_count integer;
  unmatched_count integer;
  included_without_mapy_count integer;
begin
  if not exists (
    select 1
    from public.complete_power_outage_operational_sensitivity_state state
    where state.singleton
      and state.rules_version = 3
      and state.rules_prepared
      and state.shadow_enabled
      and not state.selector_enabled
      and not state.ui_enabled
      and not state.contact_selector_enabled
      and not state.notification_selector_enabled
  ) then
    raise exception 'SHADOW rezim PROVOZNE CITLIVE v3 neni bezpecne pripraven.';
  end if;

  insert into public.complete_power_outage_operational_sensitivity_shadow_runs (
    rules_version, status
  ) values (3, 'running')
  returning id into created_run_id;

  insert into public.complete_power_outage_operational_sensitivity_shadow_results (
    run_id,
    candidate_id,
    outage_id,
    outage_source,
    company_name,
    ico,
    candidate_status,
    business_relevance_status,
    starts_at,
    ends_at,
    is_eligible,
    category,
    decision_kind,
    decision_source,
    winning_rule_key,
    matched_rule_keys,
    primary_nace_codes,
    employee_count_min,
    exact_mapy_labels,
    mapy_evidence_available
  )
  select
    created_run_id,
    shadow.candidate_id,
    shadow.outage_id,
    shadow.outage_source,
    shadow.company_name,
    shadow.ico,
    shadow.candidate_status,
    shadow.business_relevance_status,
    shadow.starts_at,
    shadow.ends_at,
    shadow.is_eligible,
    shadow.category,
    shadow.decision_kind,
    shadow.decision_source,
    shadow.winning_rule_key,
    shadow.matched_rule_keys,
    shadow.primary_nace_codes,
    shadow.employee_count_min,
    shadow.exact_mapy_labels,
    shadow.mapy_evidence_available
  from public.complete_power_outage_operational_sensitivity_shadow_current shadow;

  select
    count(*)::integer,
    count(*) filter (where result.is_eligible)::integer,
    count(*) filter (where result.decision_kind = 'exclude')::integer,
    count(*) filter (where result.decision_kind = 'no_match')::integer,
    count(*) filter (
      where result.is_eligible and not result.mapy_evidence_available
    )::integer
  into
    scoped_count,
    included_count,
    explicitly_excluded_count,
    unmatched_count,
    included_without_mapy_count
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  where result.run_id = created_run_id;

  update public.complete_power_outage_operational_sensitivity_shadow_runs
  set
    status = 'complete',
    target_count = scoped_count,
    eligible_count = included_count,
    excluded_count = explicitly_excluded_count,
    no_match_count = unmatched_count,
    eligible_without_mapy_count = included_without_mapy_count,
    metrics = jsonb_build_object(
      'confirmedOnly', true,
      'currentOutagesOnly', true,
      'eligibleBusinessOnly', true,
      'baseClassifier', 'v2',
      'smallOutpatientNameExclusion', true,
      'criticalHealthcareOverride', true,
      'residentialCareOverride', true,
      'mapyAbsenceDisposition', 'neutral',
      'externalRequestMade', false,
      'selectorChanged', false,
      'emailRuntimeChanged', false
    ),
    finished_at = now()
  where id = created_run_id;

  update public.complete_power_outage_operational_sensitivity_state
  set latest_shadow_run_id = created_run_id,
      updated_at = now()
  where singleton;

  return created_run_id;
end;
$$;

revoke all on function public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()
  to service_role;

update public.complete_power_outage_operational_sensitivity_state
set
  rules_version = 3,
  rules_prepared = true,
  shadow_enabled = true,
  selector_enabled = false,
  ui_enabled = false,
  contact_selector_enabled = false,
  notification_selector_enabled = false,
  metadata = metadata || jsonb_build_object(
    'contract', 'complete-operational-sensitivity-rules-v3',
    'baseClassifier', 'v2',
    'smallOutpatientNameExclusion', true,
    'criticalHealthcareOverride', true,
    'residentialCareOverride', true,
    'missingMapyDisposition', 'neutral',
    'missingEmployeeCategoryDisposition', 'neutral',
    'googleUsed', false,
    'visibleScoreUsed', false
  ),
  updated_at = now()
where singleton;

commit;
