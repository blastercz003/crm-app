-- Technická a bezpečnostní kontrola neveřejného auditu VELKÉ FIRMY.
select 'COLUMN' as check_type,
       'ARES RES employee category is stored separately' as object_name,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'complete_power_outage_company_profiles'
           and column_name = 'employee_category_code'
       ) as is_correct
union all
select 'COLUMN',
       'CZ NACE 2025 and 2008 are stored separately',
       (select count(*) = 4
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'complete_power_outage_company_profiles'
          and column_name in (
            'primary_nace_2025_code', 'nace_2025_codes',
            'primary_nace_2008_code', 'nace_2008_codes'
          ))
union all
select 'FUNCTION',
       'employee category boundaries match audit thresholds',
       public.complete_power_outage_employee_category_min('230') = 25
       and public.complete_power_outage_employee_category_min('240') = 50
       and public.complete_power_outage_employee_category_min('310') = 100
       and public.complete_power_outage_employee_category_min('330') = 250
union all
select 'FUNCTION',
       'controlled audit enrichment enqueue exists',
       to_regprocedure('public.enqueue_complete_power_outage_large_company_audit_enrichment()') is not null
union all
select 'GRANT',
       'authenticated cannot access private large company audit',
       not has_table_privilege(
         'authenticated', 'public.complete_power_outage_large_company_audit_inputs', 'SELECT'
       )
       and not has_table_privilege(
         'authenticated', 'public.complete_power_outage_large_company_size_variants', 'SELECT'
       )
       and not has_function_privilege(
         'authenticated',
         'public.enqueue_complete_power_outage_large_company_audit_enrichment()',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'large company audit reads COMPLETE scope only',
       position(
         'power_outage_store_' in lower(
           pg_get_viewdef('public.complete_power_outage_large_company_audit_inputs'::regclass, true)
         )
       ) = 0
       and position(
         'market' in lower(
           pg_get_viewdef('public.complete_power_outage_large_company_audit_inputs'::regclass, true)
         )
       ) = 0
union all
select 'LOGIC',
       'audit universe contains confirmed records only',
       position(
         'candidate_status' in lower(
           pg_get_viewdef('public.complete_power_outage_large_company_audit_inputs'::regclass, true)
         )
       ) > 0
       and position(
         '''confirmed''' in lower(
           pg_get_viewdef('public.complete_power_outage_large_company_audit_inputs'::regclass, true)
         )
       ) > 0
union all
select 'LOGIC',
       'four employee thresholds are available',
       coalesce((
         select array_agg(employee_threshold order by employee_threshold)
         from public.complete_power_outage_large_company_size_variants
       ), '{}'::integer[]) = array[25, 50, 100, 250]
union all
select 'SAFETY',
       'ordinary A B C scoring remains active',
       exists (
         select 1
         from public.complete_power_outage_commercial_selection_state
         where singleton and scoring_enabled
       )
union all
select 'SAFETY',
       'TOP selection remains active and unchanged',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton and ui_enabled
       )
       and position(
         'complete_power_outage_company_top_selections' in lower(
           pg_get_viewdef('public.complete_power_outage_large_company_audit_inputs'::regclass, true)
         )
       ) = 0
union all
select 'SAFETY',
       'large company audit has no UI activation',
       not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name in (
             'complete_power_outage_commercial_selection_state',
             'complete_power_outage_top_selection_state'
           )
           and column_name = 'large_company_ui_enabled'
       )
union all
select 'VIEW',
       'private four variant comparison exists',
       to_regclass('public.complete_power_outage_large_company_size_variants') is not null
order by check_type, object_name;

-- Spustit samostatně po dokončení doplňovací fronty: hlavní porovnání 4 variant.
select *
from public.complete_power_outage_large_company_size_variants
order by employee_threshold;

-- Spustit samostatně: připravenost dat pro audit.
select
  count(*) as confirmed_record_count,
  count(distinct ico) filter (where ico is not null) as confirmed_ico_count,
  count(*) filter (where res_profile_available) as profile_record_count,
  count(*) filter (where employee_size_known) as known_size_record_count,
  count(*) filter (where not res_profile_available) as missing_profile_count,
  count(*) filter (
    where res_profile_available and not employee_size_known
  ) as missing_or_unknown_size_count,
  count(*) filter (where nace_version = 'cz-nace-2025') as nace_2025_record_count,
  count(*) filter (
    where audit_profile_current
  ) as current_audit_profile_record_count,
  count(*) filter (
    where primary_nace_2025_source = 'czNacePrevazujici'
  ) as explicit_primary_nace_2025_count,
  count(*) filter (
    where primary_nace_2025_source = 'firstCzNace'
  ) as first_listed_nace_2025_count,
  count(*) filter (
    where res_profile_available and nace_version is distinct from 'cz-nace-2025'
  ) as missing_nace_2025_count
from public.complete_power_outage_large_company_audit_inputs;

-- Spustit samostatně: rozdělení každé varianty podle sekce a oddílu NACE.
with thresholds(employee_threshold) as (
  values (25), (50), (100), (250)
)
select
  threshold.employee_threshold,
  coalesce(input.nace_section, 'NEZAŘAZENO') as nace_section,
  coalesce(left(input.primary_nace_code, 2), 'CHYBÍ') as nace_division,
  count(*) as record_count,
  count(distinct input.ico) as company_count
from thresholds threshold
join public.complete_power_outage_large_company_audit_inputs input
  on input.active_subject_gate
 and input.employee_count_min >= threshold.employee_threshold
group by threshold.employee_threshold, input.nace_section, left(input.primary_nace_code, 2)
order by threshold.employee_threshold, record_count desc, nace_section, nace_division;

-- Spustit samostatně: konkrétní firmy v jednotlivých variantách.
with thresholds(employee_threshold) as (
  values (25), (50), (100), (250)
)
select
  threshold.employee_threshold,
  input.company_name,
  input.ico,
  input.source,
  input.primary_nace_code,
  input.nace_section,
  input.employee_category_code,
  input.employee_count_min,
  input.employee_count_max,
  input.legal_form,
  input.starts_at,
  input.ends_at
from thresholds threshold
join public.complete_power_outage_large_company_audit_inputs input
  on input.active_subject_gate
 and input.employee_count_min >= threshold.employee_threshold
order by threshold.employee_threshold desc,
  input.employee_count_min desc,
  input.starts_at,
  input.company_name;

-- Spustit samostatně: právní formy, které bude třeba před aktivací povolit/vyloučit.
select
  coalesce(legal_form, 'CHYBÍ') as legal_form,
  count(*) as record_count,
  count(distinct ico) as company_count,
  count(*) filter (where employee_count_min >= 25) as count_25_plus,
  count(*) filter (where employee_count_min >= 50) as count_50_plus,
  count(*) filter (where employee_count_min >= 100) as count_100_plus,
  count(*) filter (where employee_count_min >= 250) as count_250_plus
from public.complete_power_outage_large_company_audit_inputs
group by legal_form
order by count_50_plus desc, record_count desc, legal_form;

-- Spustit samostatně: známé referenční firmy bez ohledu na dosaženou hranici.
select
  company_name,
  ico,
  source,
  primary_nace_code,
  nace_version,
  nace_section,
  employee_category_code,
  employee_count_min,
  employee_count_max,
  legal_form,
  active_subject_gate,
  starts_at,
  ends_at
from public.complete_power_outage_large_company_audit_inputs
where lower(company_name) ~
  '(donauchem|egston system electronic|ekostavby louny|ikov trade|kobit[[:space:]-]*thz)'
order by company_name, starts_at;
