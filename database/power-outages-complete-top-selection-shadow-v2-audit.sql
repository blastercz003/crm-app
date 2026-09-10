select 'CRON' as check_type,
       'TOP selection shadow v2 evaluation every minute' as object_name,
       exists (
         select 1
         from cron.job
         where jobname = 'complete-power-outage-top-selection-shadow-v2'
           and active
           and schedule = '* * * * *'
           and command = 'select public.refresh_complete_power_outage_top_selection_shadow(1000);'
       )
       and not exists (
         select 1
         from cron.job
         where jobname = 'complete-power-outage-top-selection-shadow-v1'
           and active
       ) as is_correct
union all
select 'DATA',
       'current grade A candidates are represented in TOP shadow v2',
       exists (
         select 1
         from public.complete_power_outage_top_selection_overview
         where represented_count = current_grade_a_count
           and error_count = 0
       )
union all
select 'FUNCTION',
       'TOP v2 requires precise primary NACE',
       to_regprocedure('public.complete_power_outage_top_primary_nace_is_precise(text)') is not null
       and not exists (
         select 1
         from public.complete_power_outage_company_top_selections
         where top_eligible
           and not public.complete_power_outage_top_primary_nace_is_precise(primary_nace_code)
       )
union all
select 'FUNCTION',
       'TOP v2 supports both chemical wholesale NACE variants',
       public.complete_power_outage_top_primary_nace_allowed('46750')
       and public.complete_power_outage_top_primary_nace_allowed('46850')
union all
select 'GRANT',
       'authenticated cannot run TOP shadow v2 evaluator',
       not has_function_privilege(
         'authenticated',
         'public.refresh_complete_power_outage_top_selection_shadow(integer)',
         'EXECUTE'
       )
       and not has_function_privilege(
         'authenticated',
         'public.complete_power_outage_top_primary_nace_is_precise(text)',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'TOP shadow v2 stays in COMPLETE scope',
       position('power_outage_store_' in lower(pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true))) = 0
       and position('market' in lower(pg_get_viewdef('public.complete_power_outage_top_selection_inputs'::regclass, true))) = 0
union all
select 'LOGIC',
       'broad NACE codes require review and are never TOP eligible',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections
         where primary_nace_code is not null
           and not public.complete_power_outage_top_primary_nace_is_precise(primary_nace_code)
           and (evaluation_status <> 'needs_review' or top_eligible)
           and not (
             exclusion_codes && array[
               'company_in_liquidation',
               'terminated_company',
               'natural_person_registered_office_only',
               'noncommercial_association_firefighter_or_hunting_entity',
               'low_fit_business_name',
               'true_mass_or_virtual_office',
               'outage_shorter_than_three_hours'
             ]::text[]
           )
       )
union all
select 'LOGIC',
       'hard exclusions precede missing or broad NACE review',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections
         where evaluation_status = 'needs_review'
           and exclusion_codes && array[
             'company_in_liquidation',
             'terminated_company',
             'natural_person_registered_office_only',
             'noncommercial_association_firefighter_or_hunting_entity',
             'low_fit_business_name',
             'true_mass_or_virtual_office',
             'outage_shorter_than_three_hours'
           ]::text[]
       )
union all
select 'LOGIC',
       'generic building and installation groups are not TOP eligible',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections
         where top_eligible
           and (
             regexp_replace(primary_nace_code, '[^0-9]', '', 'g') like '41%'
             or regexp_replace(primary_nace_code, '[^0-9]', '', 'g') like '43%'
           )
       )
union all
select 'LOGIC',
       'selected road infrastructure NACE remains allowed',
       public.complete_power_outage_top_primary_nace_allowed('42110')
union all
select 'SAFETY',
       'ordinary A B C scoring remains enabled and unchanged',
       exists (
         select 1
         from public.complete_power_outage_commercial_selection_state
         where scoring_enabled
       )
       and position(
         'complete_power_outage_company_scores'
         in lower(pg_get_functiondef('public.refresh_complete_power_outage_top_selection_shadow(integer)'::regprocedure))
       ) = 0
union all
select 'SAFETY',
       'TOP selection v2 UI remains disabled',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton and shadow_enabled and not ui_enabled
       )
union all
select 'STATE',
       'TOP selection shadow version two is active',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton
           and shadow_enabled
           and not ui_enabled
           and rules_version = 2
           and metadata ->> 'contract' = 'complete-top-selection-shadow-v2'
       )
order by check_type, object_name;

-- Spustit samostatne: nove rozdeleni v2.
select
  evaluation_status,
  top_eligible,
  count(*) as item_count,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 2) as share_percent
from public.complete_power_outage_company_top_selections
group by evaluation_status, top_eligible
order by top_eligible desc, evaluation_status;

-- Spustit samostatne: rozdil vuci ulozenemu vychozimu stavu v1.
select
  metadata -> 'v1Baseline' as v1_baseline,
  jsonb_build_object(
    'eligibleCount', count(*) filter (where top_eligible),
    'excludedCount', count(*) filter (where evaluation_status = 'excluded'),
    'reviewCount', count(*) filter (where evaluation_status = 'needs_review'),
    'totalCount', count(*)
  ) as v2_current
from public.complete_power_outage_top_selection_state state_row
cross join public.complete_power_outage_company_top_selections result_row
where state_row.singleton
group by state_row.metadata;

-- Spustit samostatne: nejcastejsi NACE po zpresneni.
select
  coalesce(primary_nace_code, 'CHYBI') as primary_nace_code,
  evaluation_status,
  count(*) as item_count
from public.complete_power_outage_company_top_selections
group by primary_nace_code, evaluation_status
order by item_count desc, primary_nace_code
limit 60;

-- Spustit samostatne: duvody vyrazeni a rucni kontroly.
select
  exclusion_code,
  count(*) as item_count
from public.complete_power_outage_company_top_selections
cross join lateral unnest(exclusion_codes) as exclusion_code
group by exclusion_code
order by item_count desc, exclusion_code;

-- Spustit samostatne: kontrolni firmy pro v2.
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
where lower(input.company_name) ~
  '(donauchem|egston system electronic|ekostavby louny|ikov trade|kobit - thz|jaroslav michalčík|jaroslav michalcik|václav zoulík|vaclav zoulik|pohřební služba|pohrebni sluzba|sh čms|sh cms|zahrady kratina|roman kratina|závlahy kladno|zavlahy kladno|výškové práce|vyskove prace|party stany|vodní zahrada|vodni zahrada|pneuservis husinec)'
order by input.company_name, input.starts_at;
