select
  attempt.provider,
  attempt.outcome,
  count(*)::bigint as attempt_count,
  max(attempt.finished_at) as latest_attempt_at
from public.complete_power_outage_address_revalidation_v4_attempts attempt
group by attempt.provider, attempt.outcome
order by attempt.provider, attempt.outcome;

select
  state_row.runtime_mode,
  state_row.revalidation_enabled,
  state_row.external_validation_enabled,
  coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
    as queue_execution_enabled,
  coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
    as external_requests_allowed,
  count(*) filter (where queue_row.queue_status = 'prepared')::bigint as prepared_count,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status = 'verified')::bigint as verified_count,
  count(*) filter (where queue_row.queue_status = 'conflict')::bigint as conflict_count,
  count(*) filter (where queue_row.queue_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where queue_row.queue_status = 'exhausted')::bigint as exhausted_count,
  count(*) filter (where queue_row.queue_status = 'cancelled')::bigint as cancelled_count,
  count(*) filter (where queue_row.attempt_count > 0)::bigint as attempted_pair_count,
  coalesce(sum(queue_row.attempt_count), 0)::bigint as total_attempt_count,
  round(
    100.0 * count(*) filter (where queue_row.queue_status in (
      'verified', 'conflict', 'needs_review', 'exhausted', 'cancelled'
    )) / nullif(count(*), 0),
    2
  ) as progress_percent,
  min(queue_row.next_attempt_at) filter (where queue_row.queue_status = 'pending')
    as next_attempt_at,
  max(queue_row.updated_at) filter (where queue_row.attempt_count > 0)
    as latest_progress_at,
  state_row.metadata ->> 'externalWorkerPauseReason' as pause_reason
from public.complete_power_outage_address_match_state state_row
cross join public.complete_power_outage_address_revalidation_v4_queue queue_row
where state_row.singleton
group by state_row.runtime_mode, state_row.revalidation_enabled,
  state_row.external_validation_enabled, state_row.metadata;
