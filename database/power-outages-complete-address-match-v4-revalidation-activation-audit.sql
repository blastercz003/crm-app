with state_row as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
), requester_definition as (
  select lower(pg_get_functiondef(
    'public.request_complete_power_outage_address_revalidation_v4_v1()'::regprocedure
  )) as definition
), activation_definition as (
  select lower(pg_get_functiondef(
    'public.activate_complete_power_outage_address_revalidation_v4_v1()'::regprocedure
  )) as definition
), checks(check_type, object_name, is_correct) as (
  values
    (
      'FUNCTION'::text,
      'controlled COMPLETE external address activation and pause exist'::text,
      to_regprocedure(
        'public.activate_complete_power_outage_address_revalidation_v4_v1()'
      ) is not null
      and to_regprocedure(
        'public.pause_complete_power_outage_address_revalidation_v4_v1(text)'
      ) is not null
    ),
    (
      'FUNCTION',
      'isolated COMPLETE external address HTTP requester exists',
      to_regprocedure(
        'public.request_complete_power_outage_address_revalidation_v4_v1()'
      ) is not null
    ),
    (
      'CRON',
      'COMPLETE external address worker checks every minute',
      (
        select count(*) = 1
        from cron.job job
        where job.jobname = 'complete_address_revalidation_v4_every_minute'
          and job.schedule = '* * * * *'
          and job.command =
            'select public.request_complete_power_outage_address_revalidation_v4_v1();'
      )
    ),
    (
      'LOGIC',
      'activation runs the prepared queue security preflight',
      coalesce((
        select
          position('localshadowprojectionready' in definition) > 0
          and position('externalqueueready' in definition) > 0
          and position('externalworkerinstalled' in definition) > 0
          and position('externalqueueremainingcount' in definition) > 0
        from activation_definition
      ), false)
    ),
    (
      'LOGIC',
      'requester targets only the COMPLETE revalidation endpoint',
      coalesce((
        select
          position('/api/power-outages/complete/addresses/revalidate-v4?limit=3' in definition) > 0
          and position('/api/power-outages/notifications' in definition) = 0
          and position('/api/power-outages/client-emails' in definition) = 0
        from requester_definition
      ), false)
    ),
    (
      'LOGIC',
      'requester suppresses HTTP while disabled idle or waiting for retry',
      coalesce((
        select
          position('state_row.revalidation_enabled' in definition) > 0
          and position('state_row.external_validation_enabled' in definition) > 0
          and position('externalqueueexecutionenabled' in definition) > 0
          and position('externalrequestsallowed' in definition) > 0
          and position('queue_row.next_attempt_at <= now()' in definition) > 0
          and position('net.http_get' in definition) > 0
        from requester_definition
      ), false)
    ),
    (
      'LOGIC',
      'completed queue automatically disables external runtime',
      coalesce((
        select
          position('externalworkercompletedat' in definition) > 0
          and position('revalidation_enabled = false' in definition) > 0
          and position('external_validation_enabled = false' in definition) > 0
        from requester_definition
      ), false)
    ),
    (
      'DATA',
      'released address revalidation queue contains no prepared records',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.queue_status = 'prepared'
      )
    ),
    (
      'DATA',
      'active external address queue still contains only EG.D records',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        join public.complete_power_outage_address_match_v4_targets target
          on target.id = queue_row.target_id
        where queue_row.source <> 'egd' or target.source <> 'egd'
      )
    ),
    (
      'DATA',
      'external address attempt history remains internally consistent',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_attempts attempt
        join public.complete_power_outage_address_revalidation_v4_queue queue_row
          on queue_row.id = attempt.queue_id
        where (
            not (attempt.provider = any(queue_row.provider_plan))
            and not (
              attempt.provider = 'ruian'
              and queue_row.metadata ->> 'providerPlanCorrection'
                = 'skip_ruian_without_candidate_address_id'
            )
          )
          or attempt.attempt_number > queue_row.max_attempt_count
      )
      and not exists (
        select attempt.queue_id, attempt.attempt_number
        from public.complete_power_outage_address_revalidation_v4_attempts attempt
        group by attempt.queue_id, attempt.attempt_number
        having count(*) > 1
      )
    ),
    (
      'SAFETY',
      'address activation does not enable email planning or dispatch',
      coalesce((
        select
          position('notification_email' in definition) = 0
          and position('dispatch_enabled' in definition) = 0
          and position('planning_enabled' in definition) = 0
        from activation_definition
      ), false)
    ),
    (
      'SAFETY',
      'external revalidation remains SHADOW without production mutation',
      coalesce((
        select
          state_row.runtime_mode = 'shadow'
          and not coalesce(
            (state_row.metadata ->> 'productionMatchesMutationAllowed')::boolean,
            true
          )
        from state_row
      ), false)
    ),
    (
      'GRANT',
      'authenticated cannot activate pause or invoke external requester',
      not has_function_privilege(
        'authenticated',
        'public.activate_complete_power_outage_address_revalidation_v4_v1()',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.pause_complete_power_outage_address_revalidation_v4_v1(text)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.request_complete_power_outage_address_revalidation_v4_v1()',
        'EXECUTE'
      )
    ),
    (
      'ISOLATION',
      'external activation and requester do not reference MARKET objects',
      coalesce((
        select
          position('market' in requester_definition.definition) = 0
          and position('market' in activation_definition.definition) = 0
        from requester_definition cross join activation_definition
      ), false)
    ),
    (
      'STATE',
      'external EG.D address SHADOW revalidation is active or safely completed',
      coalesce((
        select
          (
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
          )
          or (
            not state_row.revalidation_enabled
            and not state_row.external_validation_enabled
            and state_row.metadata ->> 'externalWorkerPauseReason' = 'queue_complete'
          )
        from state_row
      ), false)
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
