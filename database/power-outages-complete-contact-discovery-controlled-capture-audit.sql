with prepared_batch as (
  select batch.*
  from public.complete_power_outage_contact_discovery_batches batch
  join public.complete_power_outage_contact_discovery_state state_row
    on state_row.metadata ->> 'preparedBatchId' = batch.id::text
  where state_row.singleton
  order by batch.created_at desc
  limit 1
)
select 'DATA' as check_type,
  'prepared selector batch exists' as object_name,
  exists (
    select 1
    from prepared_batch
    where selector_key = 'top_v1'
      and batch_status = 'ready'
      and captured_at is not null
  ) as is_correct
union all
select 'DATA', 'prepared batch counts match immutable items',
  exists (
    select 1
    from prepared_batch batch
    where batch.target_ico_count = (
      select count(*)
      from public.complete_power_outage_contact_discovery_batch_items item
      where item.batch_id = batch.id
    )
      and batch.profile_ready_count = (
        select count(*)
        from public.complete_power_outage_contact_discovery_batch_items item
        where item.batch_id = batch.id
          and item.profile_ready_at_capture
      )
      and batch.profile_waiting_count = (
        select count(*)
        from public.complete_power_outage_contact_discovery_batch_items item
        where item.batch_id = batch.id
          and not item.profile_ready_at_capture
      )
  )
union all
select 'DATA', 'prepared batch is fully represented in global queue',
  exists (
    select 1
    from prepared_batch batch
    where batch.represented_queue_count = batch.target_ico_count
      and not exists (
        select item.ico
        from public.complete_power_outage_contact_discovery_batch_items item
        where item.batch_id = batch.id
        except
        select queue_row.ico
        from public.complete_power_outage_contact_discovery_queue queue_row
      )
  )
union all
select 'DATA', 'prepared queue contains no processing or finished result',
  not exists (
    select 1
    from public.complete_power_outage_contact_discovery_queue
    where queue_status not in ('pending', 'waiting_profile')
  )
union all
select 'FUNCTION', 'controlled selector capture exists',
  to_regprocedure(
    'public.capture_complete_power_outage_contact_discovery_batch(text)'
  ) is not null
union all
select 'GRANT', 'authenticated cannot capture contact discovery batches',
  not has_function_privilege(
    'authenticated',
    'public.capture_complete_power_outage_contact_discovery_batch(text)',
    'EXECUTE'
  )
union all
select 'ISOLATION', 'controlled capture stays in COMPLETE scope',
  position('market_power_outage' in lower(pg_get_functiondef(
    'public.capture_complete_power_outage_contact_discovery_batch(text)'::regprocedure
  ))) = 0
  and position('store_power_outage' in lower(pg_get_functiondef(
    'public.capture_complete_power_outage_contact_discovery_batch(text)'::regprocedure
  ))) = 0
union all
select 'LOGIC', 'prepared selector is the configured default TOP selection',
  exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    join public.complete_power_outage_contact_discovery_selectors selector_row
      on selector_row.selector_key = state_row.selected_selector_key
    where state_row.singleton
      and state_row.selected_selector_key = 'top_v1'
      and selector_row.selection_version_key = 'top-v1-2026-09-11'
  )
union all
select 'LOGIC', 'queue uses one global item per ICO',
  not exists (
    select ico
    from public.complete_power_outage_contact_discovery_queue
    group by ico
    having count(*) > 1
  )
union all
select 'LOGIC', 'profile readiness maps to safe initial queue states',
  not exists (
    select 1
    from public.complete_power_outage_contact_discovery_queue queue_row
    where queue_row.queue_status = 'pending'
      and queue_row.company_profile_id is null
  )
  and not exists (
    select 1
    from public.complete_power_outage_contact_discovery_queue queue_row
    where queue_row.queue_status = 'waiting_profile'
      and queue_row.company_profile_id is not null
  )
union all
select 'LOGIC', 'capture is idempotent for unchanged selector target set',
  not exists (
    select selector_key, metadata ->> 'targetSetHash'
    from public.complete_power_outage_contact_discovery_batches
    where batch_status in ('ready', 'active', 'paused', 'completed')
    group by selector_key, metadata ->> 'targetSetHash'
    having count(*) > 1
  )
union all
select 'SAFETY', 'contact discovery remains fully disabled after capture',
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
select 'SAFETY', 'controlled capture performs no external request',
  position('http' in lower(pg_get_functiondef(
    'public.capture_complete_power_outage_contact_discovery_batch(text)'::regprocedure
  ))) = 0
  and position('request_power_outages_endpoint' in lower(pg_get_functiondef(
    'public.capture_complete_power_outage_contact_discovery_batch(text)'::regprocedure
  ))) = 0
union all
select 'SAFETY', 'no contact discovery worker or cron exists',
  to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is null
  and to_regprocedure('public.request_complete_power_outage_contact_discovery(integer)') is null
  and not exists (
    select 1
    from cron.job
    where lower(coalesce(command, '')) like
      '%complete_power_outage_contact_discovery%'
  )
union all
select 'SAFETY', 'capture creates no website evidence or contacts',
  (select count(*) from public.complete_power_outage_company_websites) = 0
  and not exists (
    select 1
    from public.complete_power_outage_company_contacts
    where source_registry in ('official_website', 'official_branch_website')
  )
order by check_type, object_name;
