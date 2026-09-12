with progress as (
  select
    state_row.website_verification_v2_enabled,
    nullif(state_row.metadata ->> 'websiteVerificationV2ActivatedAt', '')::timestamptz as activated_at,
    count(result_row.ico)::bigint as target_count,
    count(*) filter (where result_row.result_status = 'pending')::bigint as pending_count,
    count(*) filter (where result_row.result_status = 'processing')::bigint as processing_count,
    count(*) filter (where result_row.result_status = 'verified_company')::bigint as verified_company_count,
    count(*) filter (where result_row.result_status = 'verified_group')::bigint as verified_group_count,
    count(*) filter (where result_row.result_status = 'needs_review')::bigint as needs_review_count,
    count(*) filter (where result_row.result_status = 'no_website')::bigint as no_website_count,
    count(*) filter (
      where result_row.result_status = 'error' and result_row.next_attempt_at is not null
    )::bigint as retryable_error_count,
    count(*) filter (
      where result_row.result_status = 'error' and result_row.next_attempt_at is null
    )::bigint as terminal_error_count,
    max(result_row.updated_at) as latest_activity_at
  from public.complete_power_outage_contact_discovery_state state_row
  left join public.complete_power_outage_contact_discovery_website_v2_results result_row on true
  where state_row.singleton
  group by state_row.website_verification_v2_enabled, state_row.metadata
), calculated as (
  select
    progress.*,
    verified_company_count + verified_group_count + needs_review_count
      + no_website_count + terminal_error_count as finished_count,
    extract(epoch from (now() - activated_at)) / nullif(
      verified_company_count + verified_group_count + needs_review_count
        + no_website_count + terminal_error_count,
      0
    ) as seconds_per_finished_item
  from progress
)
select
  website_verification_v2_enabled,
  target_count,
  finished_count,
  pending_count,
  processing_count,
  verified_company_count,
  verified_group_count,
  needs_review_count,
  no_website_count,
  retryable_error_count,
  terminal_error_count,
  round(100 * finished_count::numeric / nullif(target_count, 0), 2) as progress_percent,
  case
    when seconds_per_finished_item is null then null
    else round(
      ((pending_count + processing_count + retryable_error_count) * seconds_per_finished_item / 60)::numeric,
      1
    )
  end as estimated_remaining_minutes,
  activated_at,
  latest_activity_at
from calculated;
