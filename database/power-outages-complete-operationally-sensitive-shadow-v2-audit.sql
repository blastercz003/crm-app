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
    ('FUNCTION', 'operational sensitivity classifier version two exists',
      to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v2(uuid)') is not null),
    ('FUNCTION', 'operational sensitivity SHADOW refresh version two exists',
      to_regprocedure('public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()') is not null),
    ('STATE', 'latest operational sensitivity SHADOW run uses version two',
      exists (
        select 1 from latest_run
        where rules_version = 2 and status = 'complete' and finished_at is not null
      )),
    ('DATA', 'version two counters account for every result',
      exists (
        select 1 from latest_run
        where target_count = eligible_count + excluded_count + no_match_count
          and target_count = (select count(*) from latest_results)
      )),
    ('DATA', 'version two results contain no duplicate candidate',
      not exists (
        select candidate_id from latest_results
        group by candidate_id having count(*) > 1
      )),
    ('LOGIC', 'liquidated and terminated subjects are never eligible',
      not exists (
        select 1
        from latest_results result
        left join public.complete_power_outage_company_profiles profile
          on profile.ico = result.ico
        where result.is_eligible
          and (
            coalesce(profile.is_in_liquidation, false)
            or coalesce(profile.is_terminated, false)
            or result.company_name ~* 'v[[:space:]]+likvidaci'
            or coalesce(profile.official_name, '') ~* 'v[[:space:]]+likvidaci'
          )
      )),
    ('LOGIC', 'company name never qualifies a record by itself',
      not exists (
        select 1 from latest_results
        where is_eligible
          and decision_source = 'company_name'
      )),
    ('LOGIC', 'brewery name rule is support only and uses standalone pivovar',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_rules
        where rule_key = 'v2:name-brewery'
          and rules_version = 2
          and effect = 'support'
          and match_value = '(^|[^[:alpha:]])pivovar($|[^[:alpha:]])'
      )),
    ('LOGIC', 'Pivovarska street name regression is excluded',
      not exists (
        select 1 from latest_results
        where is_eligible
          and company_name like 'Společenství vlastníků Pivovarská%'
      )),
    ('LOGIC', 'coarse primary NACE requires scale or exact Mapy support',
      not exists (
        select 1
        from latest_results result
        join public.complete_power_outage_operational_sensitivity_rules rule
          on rule.rule_key = result.winning_rule_key
        where result.is_eligible
          and result.decision_source = 'ares_primary_nace'
          and not exists (
            select 1 from unnest(result.primary_nace_codes) code
            where code like rule.match_value || '%'
              and length(regexp_replace(code, '[^0-9]', '', 'g')) >= 4
          )
          and coalesce(result.employee_count_min < 25, true)
          and not exists (
            select 1
            from public.complete_power_outage_operational_sensitivity_rules support_rule
            where support_rule.rule_key = any(result.matched_rule_keys)
              and support_rule.evidence_source = 'mapy_exact_label'
              and support_rule.category = result.category
              and support_rule.effect in ('include', 'support')
          )
      )),
    ('LOGIC', 'missing Mapy evidence remains neutral in version two',
      exists (
        select 1 from latest_run
        where eligible_without_mapy_count > 0
          and metrics ->> 'mapyAbsenceDisposition' = 'neutral'
      )),
    ('LOGIC', 'Mapy-only entities without ICO may remain visible',
      exists (
        select 1 from latest_results
        where is_eligible and decision_source = 'mapy_exact_label' and ico is null
      )),
    ('GRANT', 'authenticated cannot execute version two classifier or refresh',
      not has_function_privilege(
        'authenticated',
        'public.classify_complete_power_outage_operational_sensitivity_v2(uuid)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()',
        'EXECUTE'
      )),
    ('SAFETY', 'version two keeps every production surface disabled',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_state
        where singleton
          and rules_version = 2
          and shadow_enabled
          and not selector_enabled
          and not ui_enabled
          and not contact_selector_enabled
          and not notification_selector_enabled
      )),
    ('SAFETY', 'version two performs no external request or email mutation',
      exists (
        select 1 from latest_run
        where metrics ->> 'externalRequestMade' = 'false'
          and metrics ->> 'emailRuntimeChanged' = 'false'
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
