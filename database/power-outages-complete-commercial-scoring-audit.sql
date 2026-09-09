select 'CRON' as check_type, 'local commercial scoring every minute' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'complete-power-outage-commercial-scoring-v1'
      and active and schedule = '* * * * *'
      and command = 'select public.refresh_complete_power_outage_company_scores(1000);'
  ) as is_correct
union all
select 'DATA', 'current COMPLETE candidates are represented in scoring',
  exists (
    select 1 from public.complete_power_outage_company_scoring_overview
    where represented_count = current_candidate_count
  )
union all
select 'FUNCTION', 'deterministic local commercial score',
  to_regprocedure('public.refresh_complete_power_outage_company_scores(integer)') is not null
  and to_regprocedure('public.complete_power_outage_industry_points(text[])') is not null
  and to_regprocedure('public.pause_complete_power_outage_company_scoring()') is not null
union all
select 'GRANT', 'authenticated cannot calculate commercial scores',
  not has_function_privilege('authenticated', 'public.refresh_complete_power_outage_company_scores(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pause_complete_power_outage_company_scoring()', 'EXECUTE')
union all
select 'ISOLATION', 'commercial scoring stays in COMPLETE scope',
  position('public.power_outages' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
  and position('public.stores' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
union all
select 'LOGIC', 'score bands and component limits are valid',
  not exists (
    select 1 from public.complete_power_outage_company_scores
    where score is not null and (
      score not between 0 and 100
      or grade <> case when score >= 75 then 'A' when score >= 50 then 'B' else 'C' end
      or industry_points not between 0 and 70
      or outage_points not between 0 and 25
      or establishment_points not between 0 and 5
      or penalty_points not between 0 and 100
    )
  )
union all
select 'LOGIC', 'score input flags are never null',
  not exists (
    select 1 from public.complete_power_outage_company_score_inputs
    where mass_or_virtual_office is null
      or natural_person_office_only is null
      or incomplete_address is null
      or provider_conflict is null
      or short_outage is null
      or insufficient_notice is null
  )
union all
select 'LOGIC', 'score inputs contain only constraint-safe NACE codes',
  not exists (
    select 1 from public.complete_power_outage_company_score_inputs
    where (primary_nace_code is not null and primary_nace_code !~ '^[0-9]{2,6}$')
      or array_position(nace_codes, null) is not null
      or (
        cardinality(nace_codes) > 0
        and array_to_string(nace_codes, ',') !~ '^[0-9]{2,6}(,[0-9]{2,6})*$'
      )
  )
union all
select 'LOGIC', 'excluded business inputs do not affect scoring',
  position('employee_category' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
  and position('assignment' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
  and position('communication' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
union all
select 'SAFETY', 'AI selection UI remains disabled',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and res_enrichment_enabled and scoring_enabled and not ui_enabled
  )
union all
select 'SAFETY', 'local scoring makes no external requests',
  position('http' in lower(pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure))) = 0
  and position('request_power_outages_endpoint' in pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure)) = 0
union all
select 'SAFETY', 'local scoring does not mutate COMPLETE source records',
  position('update public.complete_power_outage_companies' in lower(pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure))) = 0
  and position('update public.complete_power_outages' in lower(pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure))) = 0
  and position('update public.complete_power_outage_addresses' in lower(pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure))) = 0
union all
select 'STATE', 'commercial scoring version one is active',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and scoring_enabled and scoring_version = 1
  )
union all
select 'VIEW', 'commercial scoring operational overview exists',
  to_regclass('public.complete_power_outage_company_scoring_overview') is not null
order by check_type, object_name;
