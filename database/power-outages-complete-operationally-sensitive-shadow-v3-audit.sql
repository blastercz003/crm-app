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
    ('FUNCTION', 'operational sensitivity classifier version three exists',
      to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v3(uuid)') is not null),
    ('FUNCTION', 'operational sensitivity SHADOW refresh version three exists',
      to_regprocedure('public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()') is not null),
    ('STATE', 'latest operational sensitivity SHADOW run uses version three',
      exists (
        select 1 from latest_run
        where rules_version = 3 and status = 'complete' and finished_at is not null
      )),
    ('DATA', 'version three counters account for every result',
      exists (
        select 1 from latest_run
        where target_count = eligible_count + excluded_count + no_match_count
          and target_count = (select count(*) from latest_results)
      )),
    ('DATA', 'version three results contain no duplicate candidate',
      not exists (
        select candidate_id from latest_results
        group by candidate_id having count(*) > 1
      )),
    ('LOGIC', 'ordinary ambulance and surgery names are excluded',
      not exists (
        select 1
        from latest_results
        where is_eligible
          and company_name ~*
            '(^|[^[:alpha:]])(ambulance|ordinace)($|[^[:alpha:]])'
          and category not in ('critical_healthcare', 'residential_care')
      )),
    ('LOGIC', 'RADION outpatient regression is excluded',
      not exists (
        select 1 from latest_results
        where is_eligible
          and company_name = 'RADION - onkologická ambulance s.r.o.'
      )),
    ('LOGIC', 'critical healthcare and residential care override is preserved',
      not exists (
        select 1
        from latest_results
        where winning_rule_key = 'v3:name-small-outpatient-practice'
          and category in ('critical_healthcare', 'residential_care')
      )),
    ('LOGIC', 'version two safeguards remain recorded in version three state',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_state
        where singleton
          and metadata ->> 'baseClassifier' = 'v2'
          and metadata ->> 'companyNameDirectEligibility' = 'false'
          and metadata ->> 'coarseNaceMinimumEmployeeCount' = '25'
      )),
    ('GRANT', 'authenticated cannot execute version three classifier or refresh',
      not has_function_privilege(
        'authenticated',
        'public.classify_complete_power_outage_operational_sensitivity_v3(uuid)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()',
        'EXECUTE'
      )),
    ('SAFETY', 'version three keeps every production surface disabled',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_state
        where singleton
          and rules_version = 3
          and shadow_enabled
          and not selector_enabled
          and not ui_enabled
          and not contact_selector_enabled
          and not notification_selector_enabled
      )),
    ('SAFETY', 'version three performs no external request or email mutation',
      exists (
        select 1 from latest_run
        where metrics ->> 'externalRequestMade' = 'false'
          and metrics ->> 'emailRuntimeChanged' = 'false'
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
