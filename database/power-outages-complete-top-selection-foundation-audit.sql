select 'DATA' as check_type,
       'TOP selection shadow results start empty' as object_name,
       not exists (
         select 1 from public.complete_power_outage_company_top_selections
       ) as is_correct
union all
select 'GRANT',
       'authenticated cannot mutate TOP selection shadow data',
       not has_table_privilege('authenticated', 'public.complete_power_outage_top_selection_state', 'INSERT,UPDATE,DELETE')
       and not has_table_privilege('authenticated', 'public.complete_power_outage_company_top_selections', 'INSERT,UPDATE,DELETE')
union all
select 'ISOLATION',
       'TOP selection results reference COMPLETE candidates only',
       exists (
         select 1
         from pg_constraint constraint_row
         where constraint_row.conrelid = 'public.complete_power_outage_company_top_selections'::regclass
           and constraint_row.contype = 'f'
           and constraint_row.confrelid = 'public.complete_power_outage_companies'::regclass
       )
union all
select 'RLS',
       'TOP selection shadow tables have RLS',
       coalesce((
         select bool_and(table_row.relrowsecurity)
         from pg_class table_row
         where table_row.oid in (
           'public.complete_power_outage_top_selection_state'::regclass,
           'public.complete_power_outage_company_top_selections'::regclass
         )
       ), false)
union all
select 'SAFETY',
       'ordinary A B C scoring remains enabled',
       exists (
         select 1
         from public.complete_power_outage_commercial_selection_state
         where singleton and scoring_enabled
       )
union all
select 'SAFETY',
       'TOP selection shadow evaluation remains disabled',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton and not shadow_enabled
       )
union all
select 'SAFETY',
       'TOP selection UI remains disabled',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton and not ui_enabled
       )
union all
select 'STATE',
       'TOP selection draft contract is recorded',
       exists (
         select 1
         from public.complete_power_outage_top_selection_state
         where singleton
           and rules_version = 1
           and candidate_grade = 'A'
           and metadata ->> 'contract' = 'complete-top-selection-shadow-v1-draft'
           and metadata ->> 'industryEvidence' = 'primary-nace-only'
       )
union all
select 'TABLE',
       'TOP selection shadow state',
       to_regclass('public.complete_power_outage_top_selection_state') is not null
union all
select 'TABLE',
       'TOP selection shadow results',
       to_regclass('public.complete_power_outage_company_top_selections') is not null
order by check_type, object_name;
