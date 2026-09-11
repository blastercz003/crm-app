select 'DATA' as check_type,
  'official website and website contact foundation starts empty' as object_name,
  (
    (select count(*) from public.complete_power_outage_company_websites) = 0
    and not exists (
      select 1
      from public.complete_power_outage_company_contacts
      where source_registry in ('official_website', 'official_branch_website')
    )
  ) as is_correct
union all
select 'DATA', 'four initial contact selectors are registered',
  (
    select count(*) = 4
      and bool_and(lifecycle_status = 'active')
    from public.complete_power_outage_contact_discovery_selectors
    where selector_key in ('top_v1', 'grade_a', 'grade_b', 'all_confirmed')
  )
union all
select 'GRANT', 'authenticated cannot mutate contact discovery foundation',
  not has_table_privilege('authenticated', 'public.complete_power_outage_contact_discovery_selectors', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_contact_discovery_state', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_websites', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_company_contacts', 'INSERT,UPDATE,DELETE')
union all
select 'ISOLATION', 'contact discovery foreign keys stay in COMPLETE scope',
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
        'complete_power_outage_contact_discovery_selectors',
        'complete_power_outage_contact_discovery_state',
        'complete_power_outage_company_websites',
        'complete_power_outage_company_contacts'
      )
      and (
        target_schema.nspname <> 'public'
        or target_table.relname not like 'complete_power_outage_%'
      )
  )
union all
select 'LOGIC', 'default contact selector is published TOP v1',
  exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    join public.complete_power_outage_contact_discovery_selectors selector_row
      on selector_row.selector_key = state_row.selected_selector_key
    where state_row.singleton
      and state_row.selected_selector_key = 'top_v1'
      and selector_row.commercial_filter = 'top'
      and selector_row.selection_version_key = 'top-v1-2026-09-11'
      and selector_row.lifecycle_status = 'active'
  )
union all
select 'LOGIC', 'official website contacts require website evidence',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.complete_power_outage_company_contacts'::regclass
      and conname = 'cpo_company_contacts_website_evidence_check'
  )
union all
select 'LOGIC', 'contact sources support ARES and verified official websites',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.complete_power_outage_company_contacts'::regclass
      and conname = 'cpo_company_contacts_source_check'
      and position('ares_res' in pg_get_constraintdef(oid)) > 0
      and position('official_website' in pg_get_constraintdef(oid)) > 0
      and position('official_branch_website' in pg_get_constraintdef(oid)) > 0
  )
union all
select 'LOGIC', 'selector registry accepts future filter keys',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.complete_power_outage_contact_discovery_selectors'::regclass
      and conname = 'cpo_contact_selectors_key_check'
  )
  and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.complete_power_outage_contact_discovery_selectors'::regclass
      and conname = 'cpo_contact_selectors_filter_enum_check'
  )
union all
select 'RLS', 'contact discovery foundation tables have RLS',
  (
    select count(*) = 3
    from pg_class table_row
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname in (
        'complete_power_outage_contact_discovery_selectors',
        'complete_power_outage_contact_discovery_state',
        'complete_power_outage_company_websites'
      )
      and table_row.relrowsecurity
  )
union all
select 'SAFETY', 'contact discovery remains fully disabled',
  exists (
    select 1
    from public.complete_power_outage_contact_discovery_state
    where singleton
      and not discovery_enabled
      and not website_lookup_enabled
      and not contact_extraction_enabled
      and not ui_enabled
      and not email_planning_enabled
      and not email_dispatch_enabled
  )
union all
select 'SAFETY', 'no contact discovery worker function exists',
  to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is null
  and to_regprocedure('public.request_complete_power_outage_contact_discovery(integer)') is null
union all
select 'SAFETY', 'no automatic email planner or sender exists',
  to_regprocedure('public.plan_complete_power_outage_company_emails(integer)') is null
  and to_regprocedure('public.claim_complete_power_outage_company_emails(integer)') is null
union all
select 'SAFETY', 'no contact discovery cron exists',
  not exists (
    select 1
    from cron.job
    where lower(coalesce(command, '')) like '%complete_power_outage_contact_discovery%'
  )
union all
select 'SAFETY', 'ordinary scoring and AI selection remain enabled',
  exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton and scoring_enabled and ui_enabled
  )
union all
select 'TABLE', 'complete contact discovery selectors',
  to_regclass('public.complete_power_outage_contact_discovery_selectors') is not null
union all
select 'TABLE', 'complete contact discovery state',
  to_regclass('public.complete_power_outage_contact_discovery_state') is not null
union all
select 'TABLE', 'complete company websites',
  to_regclass('public.complete_power_outage_company_websites') is not null
order by check_type, object_name;
