select 'CRON' as check_type,
       'published TOP selection is recalculated every minute' as object_name,
       exists (
         select 1 from cron.job
         where jobname = 'complete-power-outage-top-selection-shadow-v2'
           and active
           and schedule = '* * * * *'
           and command = 'select public.refresh_complete_power_outage_top_selection_shadow(1000);'
       ) as is_correct
union all
select 'DATA',
       'published TOP v1 snapshot contains complete activation universe',
       (select count(*) from public.complete_power_outage_top_selection_version_snapshot
         where version_key = 'top-v1-2026-09-11')
       = (select (rules_contract ->> 'activationSnapshotCount')::bigint
          from public.complete_power_outage_top_selection_versions
          where version_key = 'top-v1-2026-09-11')
union all
select 'FUNCTION',
       'company page uses published TOP selection results',
       position('complete_power_outage_company_top_selections' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
union all
select 'FUNCTION',
       'filtered counts use published TOP selection results',
       position('complete_power_outage_company_top_selections' in lower(
         pg_get_functiondef('public.count_complete_power_outage_companies_v3(text,text,text,text,text,text,text)'::regprocedure)
       )) > 0
       and position('complete_power_outage_company_top_selections' in lower(
         pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts_v2(text,text,text,text,text,text)'::regprocedure)
       )) > 0
union all
select 'GRANT',
       'authenticated reads but cannot mutate TOP version history',
       has_table_privilege('authenticated', 'public.complete_power_outage_top_selection_versions', 'SELECT')
       and has_table_privilege('authenticated', 'public.complete_power_outage_top_selection_version_snapshot', 'SELECT')
       and not has_table_privilege('authenticated', 'public.complete_power_outage_top_selection_versions', 'INSERT,UPDATE,DELETE')
       and not has_table_privilege('authenticated', 'public.complete_power_outage_top_selection_version_snapshot', 'INSERT,UPDATE,DELETE')
union all
select 'ISOLATION',
       'published TOP v1 snapshot records the approved v2 contract',
       not exists (
         select 1
         from public.complete_power_outage_top_selection_version_snapshot snapshot_row
         where snapshot_row.version_key = 'top-v1-2026-09-11'
           and snapshot_row.evidence ->> 'contract' is distinct from 'complete-top-selection-shadow-v2'
       )
union all
select 'ISOLATION',
       'TOP activation snapshot cannot block live candidate cleanup',
       not exists (
         select 1
         from pg_constraint constraint_row
         where constraint_row.conrelid = 'public.complete_power_outage_top_selection_version_snapshot'::regclass
           and constraint_row.contype = 'f'
           and constraint_row.confrelid = 'public.complete_power_outage_companies'::regclass
       )
union all
select 'LOGIC',
       'default COMPLETE selection is published TOP v1',
       exists (
         select 1 from public.complete_power_outage_commercial_selection_state
         where singleton
           and metadata ->> 'defaultFilter' = 'top'
           and metadata ->> 'topSelectionVersionKey' = 'top-v1-2026-09-11'
       )
union all
select 'LOGIC',
       'published TOP remains based on current grade A',
       not exists (
         select 1
         from public.complete_power_outage_company_top_selections top_row
         join public.complete_power_outage_company_scores score_row on score_row.candidate_id = top_row.candidate_id
         where top_row.top_eligible and score_row.grade is distinct from 'A'
       )
union all
select 'LOGIC',
       'TOP page and counts do not use ordinary score eligibility',
       position('score_row.selection_eligible' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
       and position('score_row.selection_eligible' in lower(
         pg_get_functiondef('public.count_complete_power_outage_companies_v3(text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
union all
select 'RLS',
       'TOP version history has RLS',
       coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_top_selection_versions'::regclass), false)
       and coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_top_selection_version_snapshot'::regclass), false)
union all
select 'SAFETY',
       'ordinary A B C scoring remains active',
       exists (
         select 1 from public.complete_power_outage_commercial_selection_state
         where singleton and scoring_enabled
       )
union all
select 'SAFETY',
       'TOP activation does not mutate source records',
       position('update public.complete_power_outages' in lower(
         pg_get_functiondef('public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)
       )) = 0
union all
select 'STATE',
       'published TOP v1 is active',
       exists (
         select 1 from public.complete_power_outage_top_selection_versions
         where version_key = 'top-v1-2026-09-11'
           and display_name = 'TOP VÝBĚR'
           and display_version = 'v1 – 11. 9. 26'
           and lifecycle_status = 'active'
           and internal_rules_version = 2
       )
union all
select 'STATE',
       'TOP v1 UI is active',
       exists (
         select 1 from public.complete_power_outage_top_selection_state
         where singleton and ui_enabled and rules_version = 2
       )
order by check_type, object_name;
