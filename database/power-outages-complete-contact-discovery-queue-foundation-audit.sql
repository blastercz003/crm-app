select 'DATA' as check_type,
  'contact discovery batches start empty' as object_name,
  (select count(*) = 0
   from public.complete_power_outage_contact_discovery_batches) as is_correct
union all
select 'DATA', 'contact discovery batch items start empty',
  (select count(*) = 0
   from public.complete_power_outage_contact_discovery_batch_items)
union all
select 'DATA', 'contact discovery queue starts empty',
  (select count(*) = 0
   from public.complete_power_outage_contact_discovery_queue)
union all
select 'GRANT', 'authenticated cannot enumerate or mutate discovery queue',
  not has_table_privilege(
    'authenticated',
    'public.complete_power_outage_contact_discovery_batches',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.complete_power_outage_contact_discovery_batch_items',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not has_table_privilege(
    'authenticated',
    'public.complete_power_outage_contact_discovery_queue',
    'SELECT,INSERT,UPDATE,DELETE'
  )
union all
select 'ISOLATION', 'contact discovery queue foreign keys stay in COMPLETE scope',
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
        'complete_power_outage_contact_discovery_batches',
        'complete_power_outage_contact_discovery_batch_items',
        'complete_power_outage_contact_discovery_queue'
      )
      and (
        target_schema.nspname <> 'public'
        or target_table.relname not like 'complete_power_outage_%'
      )
  )
union all
select 'LOGIC', 'one queue item per ICO is enforced',
  exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (ico)'
  )
union all
select 'LOGIC', 'queue item requires exact batch membership',
  exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and conname = 'cpo_contact_discovery_queue_batch_item_fkey'
      and confrelid =
        'public.complete_power_outage_contact_discovery_batch_items'::regclass
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and conname = 'cpo_contact_discovery_queue_batch_selector_fkey'
      and confrelid =
        'public.complete_power_outage_contact_discovery_batches'::regclass
  )
union all
select 'LOGIC', 'profile and website evidence must belong to queue ICO',
  exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and conname = 'cpo_contact_discovery_queue_profile_fkey'
  )
  and exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and conname = 'cpo_contact_discovery_queue_website_fkey'
  )
union all
select 'LOGIC', 'missing company profile has a dedicated waiting state',
  exists (
    select 1
    from pg_constraint
    where conrelid =
      'public.complete_power_outage_contact_discovery_queue'::regclass
      and conname = 'cpo_contact_discovery_queue_profile_check'
      and position('waiting_profile' in pg_get_constraintdef(oid)) > 0
  )
union all
select 'LOGIC', 'selector changes preserve batch contract snapshots',
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_contact_discovery_batches'
      and column_name = 'selector_contract_snapshot'
      and data_type = 'jsonb'
  )
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_contact_discovery_batches'
      and column_name = 'selection_version_key'
  )
  and to_regprocedure(
    'public.protect_complete_power_outage_contact_discovery_batch()'
  ) is not null
  and to_regprocedure(
    'public.protect_complete_power_outage_contact_discovery_batch_item()'
  ) is not null
union all
select 'RLS', 'contact discovery queue foundation has RLS',
  (
    select count(*) = 3 and bool_and(table_row.relrowsecurity)
    from pg_class table_row
    join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
    where schema_row.nspname = 'public'
      and table_row.relname in (
        'complete_power_outage_contact_discovery_batches',
        'complete_power_outage_contact_discovery_batch_items',
        'complete_power_outage_contact_discovery_queue'
      )
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
select 'SAFETY', 'no contact discovery worker or activation function exists',
  to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is null
  and to_regprocedure('public.request_complete_power_outage_contact_discovery(integer)') is null
  and to_regprocedure('public.activate_complete_power_outage_contact_discovery()') is null
union all
select 'SAFETY', 'no contact discovery cron exists',
  not exists (
    select 1
    from cron.job
    where lower(coalesce(command, '')) like
      '%complete_power_outage_contact_discovery%'
  )
union all
select 'SAFETY', 'queue foundation creates no website evidence or contacts',
  (select count(*) = 0
   from public.complete_power_outage_company_websites)
  and not exists (
    select 1
    from public.complete_power_outage_company_contacts
    where source_registry in ('official_website', 'official_branch_website')
  )
union all
select 'SAFETY', 'ordinary scoring and AI selection remain enabled',
  exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton and scoring_enabled and ui_enabled
  )
union all
select 'TABLE', 'contact discovery batches',
  to_regclass('public.complete_power_outage_contact_discovery_batches')
    is not null
union all
select 'TABLE', 'contact discovery batch items',
  to_regclass('public.complete_power_outage_contact_discovery_batch_items')
    is not null
union all
select 'TABLE', 'contact discovery queue',
  to_regclass('public.complete_power_outage_contact_discovery_queue')
    is not null
order by check_type, object_name;
