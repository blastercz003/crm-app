select 'CRON' as check_type,
       'TOP selection shadow evaluation every minute' as object_name,
       exists (
         select 1
         from cron.job
         where jobname = 'complete-power-outage-top-selection-shadow-v1'
           and active
           and schedule = '* * * * *'
           and command = 'select public.refresh_complete_power_outage_top_selection_shadow(1000);'
       ) as is_correct
union all
select 'DATA',
       'current grade A candidates are represented in TOP shadow',
       exists (
         select 1
         from public.complete_power_outage_top_selection_overview
         where represented_count = current_grade_a_count
       )
union all
select 'FUNCTION',
       'TOP selection uses primary NACE only',
       to_regprocedure('public.complete_power_outage_top_primary_nace_allowed(text)') is not null
       and position('primary_nace_code' in pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true)) > 0
       and position('nace_codes' in pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true)) = 0
union all
select 'FUNCTION',
       'TOP selection shadow evaluator',
       to_regprocedure('public.refresh_complete_power_outage_top_selection_shadow(integer)') is not null
union all
select 'GRANT',
       'authenticated cannot run TOP shadow evaluator',
       not has_function_privilege(
         'authenticated',
         'public.refresh_complete_power_outage_top_selection_shadow(integer)',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'TOP shadow does not reference MARKET records',
       position('power_outage_store_' in lower(pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true))) = 0
       and position('market' in lower(pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true))) = 0
union all
select 'LOGIC',
       'TOP shadow contains only ordinary grade A candidates',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections top_row
         join public.complete_power_outage_company_scores score_row
           on score_row.candidate_id = top_row.candidate_id
         where score_row.grade is distinct from 'A'
       )
union all
select 'LOGIC',
       'TOP eligible candidates satisfy all hard gates',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections
         where top_eligible
           and (
             evaluation_status <> 'eligible'
             or primary_nace_code is null
             or cardinality(exclusion_codes) > 0
           )
       )
union all
select 'LOGIC',
       'real establishments are exempt from address density alone',
       position('exact_establishment_evidence' in pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true)) > 0
       and position('registered_office_count >= 20' in pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true)) > 0
       and not exists (
         select 1
         from public.complete_power_outage_top_selection_inputs
         where exact_establishment_evidence
           and entity_kind in ('establishment', 'mixed')
           and not explicit_virtual_office
           and true_mass_or_virtual_office
       )
union all
select 'SAFETY',
       'ordinary A B C scores were not changed by TOP shadow',
       exists (
         select 1
         from public.complete_power_outage_commercial_selection_state
         where singleton
           and scoring_enabled
           and scoring_version >= 2
       )
       and position(
         'complete_power_outage_company_scores'
         in lower(pg_get_functiondef(
           'public.refresh_complete_power_outage_top_selection_shadow(integer)'::regprocedure
         ))
       ) = 0
union all
select 'SAFETY',
       'TOP selection UI remains disabled',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton and shadow_enabled and not ui_enabled
       )
union all
select 'STATE',
       'TOP selection shadow version one is active',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton
           and shadow_enabled
           and rules_version = 1
           and metadata ->> 'contract' = 'complete-top-selection-shadow-v1'
       )
order by check_type, object_name;

-- Souhrn prvniho experimentu pro dalsi ladeni pravidel.
select
  evaluation_status,
  top_eligible,
  count(*)::bigint as candidate_count,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 2) as share_percent
from public.complete_power_outage_company_top_selections
group by evaluation_status, top_eligible
order by top_eligible desc, evaluation_status;

select
  coalesce(primary_nace_code, 'CHYBI') as primary_nace_code,
  evaluation_status,
  count(*)::bigint as candidate_count
from public.complete_power_outage_company_top_selections
group by primary_nace_code, evaluation_status
order by candidate_count desc, primary_nace_code
limit 50;

select
  exclusion_code,
  count(*)::bigint as candidate_count
from public.complete_power_outage_company_top_selections top_row
cross join lateral unnest(top_row.exclusion_codes) exclusion_code
group by exclusion_code
order by candidate_count desc, exclusion_code;

-- Kontrolni sada zname dobrych a podezrelych prikladu. Neovlivnuje vypocet.
select
  input.company_name,
  input.primary_nace_code,
  input.score as ordinary_score,
  top_row.evaluation_status,
  top_row.top_eligible,
  top_row.reason_codes,
  top_row.exclusion_codes,
  top_row.evidence
from public.complete_power_outage_top_selection_inputs input
join public.complete_power_outage_company_top_selections top_row
  on top_row.candidate_id = input.candidate_id
where lower(input.company_name) like any (array[
  '%ekostavby%', '%donauchem%', '%kobit%', '%ikov trade%', '%egston%',
  '%jaroslav michalcik%', '%jaroslav michalčík%', '%závlahy kladno%',
  '%zavlahy kladno%', '%výškové práce%', '%vyskove prace%',
  '%pohřební služba jaroslav horký%', '%pohrebni sluzba jaroslav horky%',
  '%sh čms%', '%sh cms%', '%zahrady kratina%', '%roman kratina%',
  '%party stany%', '%pavel makový%', '%pavel makovy%', '%václav zoulík%',
  '%vaclav zoulik%', '%vodní zahrada%', '%vodni zahrada%', '%pneuservis husinec%'
])
order by input.company_name, input.starts_at;
