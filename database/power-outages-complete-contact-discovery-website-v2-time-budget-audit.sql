with checks(check_type, object_name, is_correct) as (
  values
    (
      'DATA'::text,
      'website v2 queue has no expired processing lease'::text,
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_website_v2_results
        where result_status = 'processing' and processing_expires_at <= now()
      )
    ),
    (
      'DATA',
      'website v2 retry budget has no retryable exhausted item',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_website_v2_results
        where result_status = 'error'
          and next_attempt_at is not null
          and attempt_count >= max_attempt_count
      )
    ),
    (
      'FUNCTION',
      'website v2 bounded claim function exists',
      to_regprocedure('public.claim_complete_power_outage_contact_discovery_website_v2()') is not null
    ),
    (
      'GRANT',
      'authenticated cannot claim website v2 queue',
      not has_function_privilege(
        'authenticated',
        'public.claim_complete_power_outage_contact_discovery_website_v2()',
        'EXECUTE'
      )
    ),
    (
      'LOGIC',
      'new website v2 items allow only two attempts',
      (
        select column_default = '2'
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'complete_power_outage_contact_discovery_website_v2_results'
          and column_name = 'max_attempt_count'
      )
    ),
    (
      'LOGIC',
      'website v2 runtime budget contract is active',
      coalesce((
        select metadata ->> 'websiteVerificationV2TimeBudgetContract' = 'v1'
        from public.complete_power_outage_contact_discovery_state
        where singleton
      ), false)
    ),
    (
      'SAFETY',
      'contact extraction and email phases remain disabled',
      coalesce((
        select not contact_extraction_enabled
          and not email_planning_enabled
          and not email_dispatch_enabled
        from public.complete_power_outage_contact_discovery_state
        where singleton
      ), false)
    ),
    (
      'STATE',
      'website v2 queue is no longer blocked',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_website_v2_results
        where result_status = 'processing'
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
