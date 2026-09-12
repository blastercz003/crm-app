with progress as (
  select
    state_row.contact_extraction_shadow_enabled,
    count(distinct queue_row.ico)::bigint as target_count,
    count(distinct queue_row.ico) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
    count(distinct queue_row.ico) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
    count(distinct queue_row.ico) filter (where queue_row.queue_status = 'contacts_found')::bigint as contacts_found_count,
    count(distinct queue_row.ico) filter (where queue_row.queue_status = 'no_contact')::bigint as no_contact_count,
    count(distinct queue_row.ico) filter (where queue_row.queue_status = 'needs_review')::bigint as needs_review_count,
    count(distinct queue_row.ico) filter (
      where queue_row.queue_status = 'error' and queue_row.next_attempt_at is not null
    )::bigint as retryable_error_count,
    count(distinct queue_row.ico) filter (
      where queue_row.queue_status = 'error' and queue_row.next_attempt_at is null
    )::bigint as terminal_error_count,
    count(result_row.id)::bigint as extracted_contact_count,
    count(result_row.id) filter (where result_row.contact_type = 'email')::bigint as email_count,
    count(result_row.id) filter (where result_row.contact_type = 'phone')::bigint as phone_count,
    count(result_row.id) filter (where result_row.is_personal)::bigint as personal_contact_count,
    max(queue_row.updated_at) as latest_activity_at
  from public.complete_power_outage_contact_discovery_state state_row
  left join public.complete_power_outage_contact_extraction_shadow_queue queue_row on true
  left join public.complete_power_outage_contact_extraction_shadow_results result_row
    on result_row.ico = queue_row.ico
  where state_row.singleton
  group by state_row.contact_extraction_shadow_enabled
)
select
  progress.*,
  contacts_found_count + no_contact_count + needs_review_count + terminal_error_count
    as finished_count,
  round(
    100 * (
      contacts_found_count + no_contact_count + needs_review_count + terminal_error_count
    )::numeric / nullif(target_count, 0),
    2
  ) as progress_percent
from progress;
