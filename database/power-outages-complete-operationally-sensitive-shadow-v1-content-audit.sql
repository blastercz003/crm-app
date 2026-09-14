-- KROK 4 / PROVOZNE CITLIVE v1
-- Read-only obsahovy audit posledniho dokonceneho SHADOW behu.
-- Nic nemeni, nevola externi sluzby a neaktivuje selector, UI ani e-maily.

with latest_run as (
  select run.*
  from public.complete_power_outage_operational_sensitivity_shadow_runs run
  join public.complete_power_outage_operational_sensitivity_state state
    on state.latest_shadow_run_id = run.id
  where state.singleton
), latest_results as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_run on latest_run.id = result.run_id
), checks(check_type, object_name, is_correct) as (
  values
    ('DATA', 'latest SHADOW run is complete',
      exists (
        select 1 from latest_run
        where status = 'complete' and finished_at is not null
      )),
    ('DATA', 'latest run counters account for every result',
      exists (
        select 1
        from latest_run
        where target_count = eligible_count + excluded_count + no_match_count
          and target_count = (select count(*) from latest_results)
          and eligible_count = (select count(*) from latest_results where is_eligible)
          and excluded_count = (select count(*) from latest_results where decision_kind = 'exclude')
          and no_match_count = (select count(*) from latest_results where decision_kind = 'no_match')
      )),
    ('DATA', 'latest results contain no duplicate company outage candidate',
      not exists (
        select candidate_id
        from latest_results
        group by candidate_id
        having count(*) > 1
      )),
    ('LOGIC', 'every eligible record has an approved positive category',
      not exists (
        select 1
        from latest_results
        where is_eligible
          and category not in (
            'food_and_cold_chain',
            'continuous_industry',
            'automotive_manufacturing',
            'critical_healthcare',
            'residential_care',
            'data_and_telecom',
            'water_and_wastewater',
            'livestock',
            'temperature_controlled_logistics',
            'large_hospitality_and_gastro',
            'emergency_services'
          )
      )),
    ('LOGIC', 'Mapy decisions always use exact stored Mapy evidence',
      not exists (
        select 1
        from latest_results
        where is_eligible
          and decision_source = 'mapy_exact_label'
          and (not mapy_evidence_available or cardinality(exact_mapy_labels) = 0)
      )),
    ('LOGIC', 'missing Mapy evidence remains neutral',
      exists (
        select 1 from latest_run
        where eligible_without_mapy_count > 0
          and metrics ->> 'mapyAbsenceDisposition' = 'neutral'
      )),
    ('LOGIC', 'secondary NACE never qualifies a record by itself',
      not exists (
        select 1
        from latest_results
        where is_eligible and decision_source = 'ares_any_nace'
      )),
    ('LOGIC', 'conditional rules meet their employee threshold',
      not exists (
        select 1
        from latest_results result
        join public.complete_power_outage_operational_sensitivity_rules rule
          on rule.rule_key = result.winning_rule_key
        where result.is_eligible
          and rule.effect = 'conditional_include'
          and (
            result.employee_count_min is null
            or result.employee_count_min < rule.minimum_employee_count
          )
      )),
    ('LOGIC', 'combined support uses at least two independent evidence groups',
      not exists (
        select 1
        from latest_results result
        where result.is_eligible
          and result.decision_source = 'combined_support'
          and (
            select count(distinct case
              when rule.evidence_source in ('ares_primary_nace', 'ares_any_nace') then 'ares'
              else rule.evidence_source
            end)
            from public.complete_power_outage_operational_sensitivity_rules rule
            where rule.rule_key = any(result.matched_rule_keys)
              and rule.effect = 'support'
              and rule.category = result.category
          ) < 2
      )),
    ('LOGIC', 'an exclusion rule never becomes the winning eligible rule',
      not exists (
        select 1
        from latest_results result
        join public.complete_power_outage_operational_sensitivity_rules rule
          on rule.rule_key = result.winning_rule_key
        where result.is_eligible and rule.effect = 'exclude'
      )),
    ('LOGIC', 'eligible automotive records are manufacturing not service',
      not exists (
        select 1
        from latest_results result
        where result.is_eligible
          and result.category = 'excluded_automotive_service'
      )),
    ('LOGIC', 'eligible healthcare records are not classified as small outpatient care',
      not exists (
        select 1
        from latest_results result
        where result.is_eligible
          and result.category = 'excluded_small_healthcare'
      )),
    ('LOGIC', 'ordinary public nonprofit and education exclusions are not eligible',
      not exists (
        select 1
        from latest_results result
        where result.is_eligible
          and result.category = 'excluded_ordinary_public_or_nonprofit'
      )),
    ('ISOLATION', 'content audit remains limited to COMPLETE distributors',
      not exists (
        select 1 from latest_results
        where outage_source not in ('cez', 'egd', 'pre')
      )),
    ('SAFETY', 'content audit has not enabled any production surface',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_state
        where singleton
          and shadow_enabled
          and not selector_enabled
          and not ui_enabled
          and not contact_selector_enabled
          and not notification_selector_enabled
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
