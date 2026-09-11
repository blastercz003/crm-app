with checks as (
  select 'CRON'::text as check_type,
    'official website discovery every fifteen seconds'::text as object_name,
    count(*) = 1 as is_correct
  from cron.job
  where jobname = 'complete_contact_discovery_websites_every_fifteen_seconds'
    and schedule = '15 seconds'
  union all
  select 'CRON', 'obsolete website discovery schedules are absent',
    count(*) = 0
  from cron.job
  where jobname in (
    'complete_contact_discovery_websites_every_minute',
    'complete_contact_discovery_websites_every_two_minutes',
    'complete_contact_discovery_websites_every_five_minutes'
  )
  union all
  select 'DATA', 'website discovery acceleration preserves the active batch',
    count(queue_row.ico) = count(distinct queue_row.ico)
    and count(queue_row.ico) = max(batch.target_ico_count)
  from public.complete_power_outage_contact_discovery_state state_row
  join public.complete_power_outage_contact_discovery_batches batch
    on batch.id = nullif(state_row.metadata ->> 'preparedBatchId', '')::uuid
  left join public.complete_power_outage_contact_discovery_queue queue_row
    on queue_row.origin_batch_id = batch.id
  where state_row.singleton
  union all
  select 'LOGIC', 'only one website lookup remains processing',
    count(*) <= 1
  from public.complete_power_outage_contact_discovery_queue
  where queue_status = 'processing'
  union all
  select 'STATE', 'website discovery remains active',
    discovery_enabled and website_lookup_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton
  union all
  select 'SAFETY', 'contact extraction remains disabled',
    not contact_extraction_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton
  union all
  select 'SAFETY', 'email planning and dispatch remain disabled',
    not email_planning_enabled and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
