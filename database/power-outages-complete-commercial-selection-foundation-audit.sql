select 'DATA' as check_type,
  'commercial selection foundation tables are empty' as object_name,
  (
    (select count(*) from public.complete_power_outage_company_profiles) = 0
    and (select count(*) from public.complete_power_outage_company_contacts) = 0
    and (select count(*) from public.complete_power_outage_company_enrichment_queue) = 0
    and (select count(*) from public.complete_power_outage_company_scores) = 0
  ) as is_correct
union all
select 'GRANT', 'authenticated cannot mutate commercial selection data',
  not has_table_privilege('authenticated', 'public.complete_power_outage_commercial_selection_state', 'INSERT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_commercial_selection_state', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_commercial_selection_state', 'DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_profiles', 'DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_contacts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_contacts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_contacts', 'DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_enrichment_queue', 'INSERT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_enrichment_queue', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_enrichment_queue', 'DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_scores', 'INSERT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_scores', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_scores', 'DELETE')
union all
select 'ISOLATION', 'commercial selection foreign keys stay in COMPLETE scope',
  not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_namespace source_schema on source_schema.oid = source_table.relnamespace
    join pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_namespace target_schema on target_schema.oid = target_table.relnamespace
    where constraint_row.contype = 'f'
      and source_schema.nspname = 'public'
      and source_table.relname in (
        'complete_power_outage_company_profiles',
        'complete_power_outage_company_contacts',
        'complete_power_outage_company_enrichment_queue',
        'complete_power_outage_company_scores'
      )
      and (
        target_schema.nspname <> 'public'
        or target_table.relname not like 'complete_power_outage_%'
      )
  )
union all
select 'RLS', 'commercial selection tables have RLS',
  (
    select count(*) = 5
    from pg_class table_row
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname in (
        'complete_power_outage_commercial_selection_state',
        'complete_power_outage_company_profiles',
        'complete_power_outage_company_contacts',
        'complete_power_outage_company_enrichment_queue',
        'complete_power_outage_company_scores'
      )
      and table_row.relrowsecurity
  )
union all
select 'SAFETY', 'ARES RES enrichment remains disabled',
  exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton and not res_enrichment_enabled
  )
union all
select 'SAFETY', 'commercial scoring remains disabled',
  exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton and not scoring_enabled
  )
union all
select 'SAFETY', 'commercial selection UI remains disabled',
  exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton and not ui_enabled
  )
union all
select 'SAFETY', 'no enrichment claim function exists',
  to_regprocedure('public.claim_complete_power_outage_company_enrichment(integer)') is null
union all
select 'SAFETY', 'no enrichment request function exists',
  to_regprocedure('public.request_complete_power_outage_company_enrichment(integer)') is null
union all
select 'TABLE', 'complete commercial selection state',
  to_regclass('public.complete_power_outage_commercial_selection_state') is not null
union all
select 'TABLE', 'complete company profiles',
  to_regclass('public.complete_power_outage_company_profiles') is not null
union all
select 'TABLE', 'complete company contacts',
  to_regclass('public.complete_power_outage_company_contacts') is not null
union all
select 'TABLE', 'complete company enrichment queue',
  to_regclass('public.complete_power_outage_company_enrichment_queue') is not null
union all
select 'TABLE', 'complete company scores',
  to_regclass('public.complete_power_outage_company_scores') is not null
order by check_type, object_name;
