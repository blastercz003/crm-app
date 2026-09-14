with state_row as (
  select * from public.complete_power_outage_address_match_state where singleton
), checks(check_type, object_name, is_correct) as (
  values
    (
      'DATA'::text,
      'active queue contains no unusable RUIAN phase'::text,
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.queue_status in ('pending', 'processing')
          and 'ruian' = any(queue_row.provider_plan)
          and not (queue_row.candidate_snapshot ? 'ruianAddressId')
      )
    ),
    (
      'DATA',
      'provider plan correction preserves immutable attempt history',
      exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_attempts
      )
      and not exists (
        select attempt.queue_id, attempt.attempt_number
        from public.complete_power_outage_address_revalidation_v4_attempts attempt
        group by attempt.queue_id, attempt.attempt_number
        having count(*) > 1
      )
    ),
    (
      'LOGIC',
      'ARES companies without RUIAN evidence use ARES then Mapy',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.company_ico is not null
          and not (queue_row.candidate_snapshot ? 'ruianAddressId')
          and queue_row.provider_plan <> array['ares', 'mapy']::text[]
      )
    ),
    (
      'LOGIC',
      'companies without ICO or RUIAN evidence go directly to Mapy',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.company_ico is null
          and not (queue_row.candidate_snapshot ? 'ruianAddressId')
          and queue_row.provider_plan <> array['mapy']::text[]
      )
    ),
    (
      'LOGIC',
      'RUIAN remains available only with candidate address identity',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where 'ruian' = any(queue_row.provider_plan)
          and not (queue_row.candidate_snapshot ? 'ruianAddressId')
      )
    ),
    (
      'SAFETY',
      'provider correction remains active only in SHADOW mode',
      coalesce((
        select
          state_row.runtime_mode = 'shadow'
          and state_row.revalidation_enabled
          and state_row.external_validation_enabled
          and not coalesce(
            (state_row.metadata ->> 'productionMatchesMutationAllowed')::boolean,
            true
          )
        from state_row
      ), false)
    ),
    (
      'SAFETY',
      'provider plan revision changes no email runtime',
      coalesce((
        select
          coalesce((state_row.metadata ->> 'externalProviderPlanRevision')::integer, 0) = 2
          and coalesce(
            (state_row.metadata ->> 'externalRuianRequiresCandidateAddressId')::boolean,
            false
          )
        from state_row
      ), false)
    ),
    (
      'STATE',
      'corrected external address worker resumed',
      coalesce((
        select
          state_row.revalidation_enabled
          and state_row.external_validation_enabled
          and coalesce(
            (state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean,
            false
          )
          and coalesce(
            (state_row.metadata ->> 'externalRequestsAllowed')::boolean,
            false
          )
        from state_row
      ), false)
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
