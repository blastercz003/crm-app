with prepared_batch as (
  select batch.*
  from public.complete_power_outage_contact_discovery_batches batch
  join public.complete_power_outage_contact_discovery_state state_row
    on state_row.metadata ->> 'preparedBatchId' = batch.id::text
  where state_row.singleton
  order by batch.created_at desc
  limit 1
)
select
  batch.id as batch_id,
  batch.selector_key,
  batch.batch_status,
  batch.target_ico_count,
  batch.profile_ready_count,
  batch.profile_waiting_count,
  batch.represented_queue_count,
  count(*) filter (where queue_row.queue_status = 'pending') as pending_count,
  count(*) filter (where queue_row.queue_status = 'waiting_profile')
    as waiting_profile_count,
  count(*) filter (where queue_row.queue_status = 'processing')
    as processing_count,
  count(*) filter (where queue_row.queue_status in (
    'ready', 'no_website', 'no_contact'
  )) as finished_count,
  batch.captured_at
from prepared_batch batch
join public.complete_power_outage_contact_discovery_batch_items item
  on item.batch_id = batch.id
join public.complete_power_outage_contact_discovery_queue queue_row
  on queue_row.ico = item.ico
group by
  batch.id,
  batch.selector_key,
  batch.batch_status,
  batch.target_ico_count,
  batch.profile_ready_count,
  batch.profile_waiting_count,
  batch.represented_queue_count,
  batch.captured_at;
