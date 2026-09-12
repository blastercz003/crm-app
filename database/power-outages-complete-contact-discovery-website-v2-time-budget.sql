begin;

-- V2 website verification must always release the global single-item queue.
-- A single company gets at most two full worker attempts. An expired lease is
-- terminally routed to manual review instead of repeating paid Brave searches.
alter table public.complete_power_outage_contact_discovery_website_v2_results
  alter column max_attempt_count set default 2;

update public.complete_power_outage_contact_discovery_website_v2_results
set max_attempt_count = greatest(attempt_count, 2);

update public.complete_power_outage_contact_discovery_website_v2_results result_row
set result_status = 'needs_review',
    reason_codes = case
      when 'worker_retry_budget_exhausted' = any(result_row.reason_codes) then result_row.reason_codes
      else array_append(result_row.reason_codes, 'worker_retry_budget_exhausted')
    end,
    processing_token = null,
    processing_expires_at = null,
    next_attempt_at = null,
    finished_at = now(),
    last_error_code = null,
    last_error_message = null,
    evidence = result_row.evidence || jsonb_build_object(
      'retryBudgetExhaustedAt', now(),
      'previousErrorCode', result_row.last_error_code,
      'previousErrorMessage', result_row.last_error_message,
      'automaticRetrySuppressed', true
    )
where result_row.result_status = 'error'
  and result_row.next_attempt_at is not null
  and result_row.attempt_count >= result_row.max_attempt_count;

create or replace function public.claim_complete_power_outage_contact_discovery_website_v2()
returns table (
  ico text,
  company_profile_id uuid,
  company_name text,
  processing_token uuid,
  attempt_count integer,
  prior_website_url text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
begin
  if not coalesce((
    select state_row.website_verification_v2_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then return; end if;

  update public.complete_power_outage_contact_discovery_website_v2_results result_row
  set result_status = 'needs_review',
      reason_codes = case
        when 'worker_lease_expired_terminal' = any(result_row.reason_codes) then result_row.reason_codes
        else array_append(result_row.reason_codes, 'worker_lease_expired_terminal')
      end,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      finished_at = now(),
      last_error_code = null,
      last_error_message = null,
      evidence = result_row.evidence || jsonb_build_object(
        'workerLeaseExpiredAt', now(),
        'automaticRetrySuppressed', true
      )
  where result_row.result_status = 'processing'
    and result_row.processing_expires_at <= now();

  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.result_status = 'processing'
      and result_row.processing_expires_at > now()
  ) then return; end if;

  return query
  with selected as materialized (
    select result_row.ico
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.attempt_count < result_row.max_attempt_count
      and result_row.result_status in ('pending', 'error')
      and coalesce(result_row.next_attempt_at, now()) <= now()
    order by result_row.next_attempt_at nulls first, result_row.created_at, result_row.ico
    for update skip locked
    limit 1
  ), claimed as (
    update public.complete_power_outage_contact_discovery_website_v2_results result_row
    set result_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '4 minutes',
        started_at = coalesce(result_row.started_at, now()),
        finished_at = null,
        attempt_count = result_row.attempt_count + 1,
        next_attempt_at = null,
        last_error_code = null,
        last_error_message = null
    from selected
    where result_row.ico = selected.ico
    returning result_row.ico, result_row.company_profile_id,
      result_row.processing_token, result_row.attempt_count
  )
  select claimed.ico, claimed.company_profile_id, profile.official_name,
    claimed.processing_token, claimed.attempt_count, website.website_url
  from claimed
  join public.complete_power_outage_company_profiles profile
    on profile.id = claimed.company_profile_id and profile.ico = claimed.ico
  left join public.complete_power_outage_contact_discovery_queue v1_queue
    on v1_queue.ico = claimed.ico
  left join public.complete_power_outage_company_websites website
    on website.id = v1_queue.discovered_website_id
   and website.company_profile_id = claimed.company_profile_id;
end;
$$;

revoke all on function public.claim_complete_power_outage_contact_discovery_website_v2()
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_contact_discovery_website_v2()
  to service_role;

update public.complete_power_outage_contact_discovery_state
set last_activity_at = now(),
    metadata = metadata || jsonb_build_object(
      'websiteVerificationV2TimeBudgetContract', 'v1',
      'websiteVerificationV2ItemBudgetSeconds', 210,
      'websiteVerificationV2CandidateBudgetSeconds', 35,
      'websiteVerificationV2MaximumAttempts', 2,
      'websiteVerificationV2TimeBudgetActivatedAt', now()
    )
where singleton;

notify pgrst, 'reload schema';
commit;
