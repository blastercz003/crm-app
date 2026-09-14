begin;

-- PROVOZNE CITLIVE / SHADOW v2
-- Zprisneni po obsahovem auditu v1. Historie v1 zustava zachovana.
-- Tento skript nevytvari produkcni selector a neaktivuje UI, kontakty ani e-maily.
do $$
begin
  if to_regclass('public.complete_power_outage_operational_sensitivity_state') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_rules') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_runs') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_results') is null
     or to_regprocedure('public.complete_power_outage_employee_category_min(text)') is null
  then
    raise exception 'Chybi zavislosti pro SHADOW klasifikaci PROVOZNE CITLIVE v2.';
  end if;
end
$$;

-- Pravidla v1 se kopiruji pod novymi klici. Stare auditni vysledky tak nadale
-- odkazuji na puvodni nemenny slovnik v1.
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
select
  'v2:' || rule.rule_key,
  2,
  rule.category,
  rule.evidence_source,
  rule.match_operator,
  case
    when rule.rule_key = 'name-brewery'
      then '(^|[^[:alpha:]])pivovar($|[^[:alpha:]])'
    else rule.match_value
  end,
  case
    when rule.evidence_source = 'company_name' and rule.effect = 'include'
      then 'support'
    else rule.effect
  end,
  rule.priority,
  rule.minimum_employee_count,
  rule.requires_exact_site_evidence,
  rule.requires_mapy_evidence,
  rule.active,
  case
    when rule.rule_key = 'name-brewery'
      then 'Samostatne slovo pivovar; pouze podpurny signal, ktery neodpovida slovum Pivovarska ani pivovaru.'
    when rule.evidence_source = 'company_name' and rule.effect = 'include'
      then rule.rationale || ' Ve v2 je nazev pouze podpurny signal.'
    else rule.rationale
  end,
  rule.metadata || jsonb_build_object(
    'sourceRuleKey', rule.rule_key,
    'revision', 'operational-sensitivity-v2'
  )
from public.complete_power_outage_operational_sensitivity_rules rule
where rule.rules_version = 1
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

create or replace function public.classify_complete_power_outage_operational_sensitivity_v2(
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
  with input as (
    select
      company.id as candidate_id,
      company.company_name,
      company.candidate_status,
      company.business_relevance_status,
      company.candidate_status = 'confirmed'
        and company.business_relevance_status = 'eligible'
        and outage.ends_at >= now()
        and outage.source_status in ('scheduled', 'active')
        and not coalesce(profile.is_in_liquidation, false)
        and not coalesce(profile.is_terminated, false)
        and company.company_name !~* 'v[[:space:]]+likvidaci'
        and coalesce(profile.official_name, '') !~* 'v[[:space:]]+likvidaci'
        as hard_gate_passed,
      array(
        select distinct code
        from unnest(array[
          profile.primary_nace_2025_code,
          profile.primary_nace_2008_code,
          profile.primary_nace_code
        ]::text[]) code
        where code ~ '^[0-9]{2,6}$'
        order by code
      ) as primary_codes,
      array(
        select distinct code
        from unnest(
          coalesce(profile.nace_2025_codes, '{}'::text[])
          || coalesce(profile.nace_2008_codes, '{}'::text[])
          || coalesce(profile.nace_codes, '{}'::text[])
          || coalesce(company.nace_codes, '{}'::text[])
        ) code
        where code ~ '^[0-9]{2,6}$'
        order by code
      ) as all_codes,
      public.complete_power_outage_employee_category_min(
        profile.employee_category_code
      ) as employee_min,
      coalesce(mapy.labels, '{}'::text[]) as mapy_labels
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    left join public.complete_power_outage_company_profiles profile
      on profile.ico = company.ico
    left join lateral (
      select array_agg(
        distinct evidence.metadata ->> 'label'
        order by evidence.metadata ->> 'label'
      ) filter (
        where nullif(btrim(evidence.metadata ->> 'label'), '') is not null
      ) as labels
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider = 'mapy'
        and evidence.evidence_kind = 'establishment'
        and evidence.match_level in ('exact_address', 'same_building')
    ) mapy on true
    where company.id = requested_candidate_id
  ), matched as (
    select
      rule.rule_key,
      rule.category,
      rule.evidence_source,
      rule.effect,
      rule.priority,
      rule.minimum_employee_count,
      rule.match_value
    from input
    join public.complete_power_outage_operational_sensitivity_rules rule
      on rule.rules_version = 2
     and rule.active
     and case rule.evidence_source
       when 'ares_primary_nace' then exists (
         select 1 from unnest(input.primary_codes) code
         where code like rule.match_value || '%'
       )
       when 'ares_any_nace' then exists (
         select 1 from unnest(input.all_codes) code
         where code like rule.match_value || '%'
       )
       when 'mapy_exact_label' then exists (
         select 1 from unnest(input.mapy_labels) label
         where lower(btrim(label)) = lower(btrim(rule.match_value))
       )
       when 'company_name' then input.company_name ~* rule.match_value
       else false
     end
  ), applicable_direct as (
    select matched.*
    from matched
    cross join input
    where matched.effect = 'exclude'
       or (
         matched.effect in ('include', 'conditional_include')
         and (
           matched.effect <> 'conditional_include'
           or (
             input.employee_min is not null
             and input.employee_min >= matched.minimum_employee_count
           )
         )
         and (
           matched.evidence_source <> 'ares_primary_nace'
           or exists (
             select 1
             from unnest(input.primary_codes) code
             where code like matched.match_value || '%'
               and length(regexp_replace(code, '[^0-9]', '', 'g')) >= 4
           )
           or coalesce(input.employee_min >= 25, false)
           or exists (
             select 1
             from matched mapy_support
             where mapy_support.evidence_source = 'mapy_exact_label'
               and mapy_support.category = matched.category
               and mapy_support.effect in ('include', 'support')
           )
         )
       )
  ), combined_support as (
    select
      'v2:combined-support:' || matched.category as rule_key,
      matched.category,
      'combined_support'::text as evidence_source,
      'combined_support'::text as effect,
      least(500, max(matched.priority) + 100)::integer as priority,
      null::integer as minimum_employee_count,
      null::text as match_value
    from matched
    where matched.effect = 'support'
    group by matched.category
    having count(distinct case
      when matched.evidence_source in ('ares_primary_nace', 'ares_any_nace') then 'ares'
      else matched.evidence_source
    end) >= 2
  ), candidates as (
    select * from applicable_direct
    union all
    select * from combined_support
  ), winner as (
    select candidates.*
    from candidates
    order by
      candidates.priority desc,
      case candidates.effect when 'exclude' then 0 else 1 end,
      candidates.rule_key
    limit 1
  ), matched_keys as (
    select coalesce(
      array_agg(matched.rule_key order by matched.priority desc, matched.rule_key),
      '{}'::text[]
    ) as keys
    from matched
  )
  select
    input.hard_gate_passed
      and coalesce(
        winner.effect in ('include', 'conditional_include', 'combined_support'),
        false
      ) as is_eligible,
    case
      when input.hard_gate_passed
        and winner.effect in ('include', 'conditional_include', 'combined_support')
        then winner.category
      else null
    end as category,
    case
      when not input.hard_gate_passed then 'exclude'
      else coalesce(winner.effect, 'no_match')
    end as decision_kind,
    case
      when not input.hard_gate_passed then 'hard_gate'
      else coalesce(winner.evidence_source, 'none')
    end as decision_source,
    case when input.hard_gate_passed then winner.rule_key end as winning_rule_key,
    matched_keys.keys as matched_rule_keys,
    input.primary_codes as primary_nace_codes,
    input.employee_min as employee_count_min,
    input.mapy_labels as exact_mapy_labels,
    cardinality(input.mapy_labels) > 0 as mapy_evidence_available
  from input
  cross join matched_keys
  left join winner on true;
$$;

revoke all on function public.classify_complete_power_outage_operational_sensitivity_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.classify_complete_power_outage_operational_sensitivity_v2(uuid)
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
cross join lateral public.classify_complete_power_outage_operational_sensitivity_v2(
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

create or replace function public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()
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
      and state.rules_version = 2
      and state.rules_prepared
      and state.shadow_enabled
      and not state.selector_enabled
      and not state.ui_enabled
      and not state.contact_selector_enabled
      and not state.notification_selector_enabled
  ) then
    raise exception 'SHADOW rezim PROVOZNE CITLIVE v2 neni bezpecne pripraven.';
  end if;

  insert into public.complete_power_outage_operational_sensitivity_shadow_runs (
    rules_version, status
  ) values (2, 'running')
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
      'activeSubjectGate', true,
      'minimumPreciseNaceDigits', 4,
      'coarseNaceMinimumEmployeeCount', 25,
      'coarseNaceMayUseExactMapySupport', true,
      'mapyAbsenceDisposition', 'neutral',
      'externalRequestMade', false,
      'selectorChanged', false,
      'emailRuntimeChanged', false
    ),
    finished_at = now()
  where id = created_run_id;

  update public.complete_power_outage_operational_sensitivity_state
  set
    latest_shadow_run_id = created_run_id,
    updated_at = now()
  where singleton;

  return created_run_id;
end;
$$;

revoke all on function public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()
  to service_role;

update public.complete_power_outage_operational_sensitivity_state
set
  rules_version = 2,
  rules_prepared = true,
  shadow_enabled = true,
  selector_enabled = false,
  ui_enabled = false,
  contact_selector_enabled = false,
  notification_selector_enabled = false,
  metadata = metadata || jsonb_build_object(
    'contract', 'complete-operational-sensitivity-rules-v2',
    'activeSubjectGate', true,
    'minimumPreciseNaceDigits', 4,
    'coarseNaceMinimumEmployeeCount', 25,
    'coarseNaceExactMapySupportAllowed', true,
    'breweryNameRequiresStandaloneWord', true,
    'companyNameDirectEligibility', false,
    'missingMapyDisposition', 'neutral',
    'missingEmployeeCategoryDisposition', 'neutral',
    'googleUsed', false,
    'visibleScoreUsed', false
  ),
  updated_at = now()
where singleton;

commit;
