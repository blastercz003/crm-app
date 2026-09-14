select
  count(*) filter (where queue_status = 'prepared')::bigint as prepared_pair_count,
  count(*) filter (where queue_status = 'pending')::bigint as pending_pair_count,
  count(*) filter (where queue_status = 'processing')::bigint as processing_pair_count,
  count(*) filter (where attempt_count > 0)::bigint as attempted_pair_count,
  (select count(*) from public.complete_power_outage_address_revalidation_v4_attempts)::bigint
    as attempt_event_count
from public.complete_power_outage_address_revalidation_v4_queue;

with state_row as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
), claim_definition as (
  select lower(pg_get_functiondef(
    'public.claim_complete_power_outage_address_revalidation_v4_v1(integer)'::regprocedure
  )) as definition
), finish_definition as (
  select lower(pg_get_functiondef(
    'public.finish_complete_power_outage_address_revalidation_v4_v1(uuid,uuid,text,text,jsonb,text,timestamp with time zone)'::regprocedure
  )) as definition
), checks(check_type, object_name, is_correct) as (
  values
    (
      'FUNCTION'::text,
      'gated COMPLETE external address revalidation claim exists'::text,
      to_regprocedure(
        'public.claim_complete_power_outage_address_revalidation_v4_v1(integer)'
      ) is not null
    ),
    (
      'FUNCTION',
      'token protected COMPLETE external address revalidation completion exists',
      to_regprocedure(
        'public.finish_complete_power_outage_address_revalidation_v4_v1(uuid,uuid,text,text,jsonb,text,timestamp with time zone)'
      ) is not null
    ),
    (
      'FUNCTION',
      'safe COMPLETE external address revalidation claim release exists',
      to_regprocedure(
        'public.release_complete_power_outage_address_revalidation_v4_claim_v1(uuid,uuid,integer)'
      ) is not null
    ),
    (
      'FUNCTION',
      'independent RUIAN quota reservation exists',
      to_regprocedure(
        'public.claim_complete_power_outage_address_revalidation_v4_ruian_quota(integer,integer)'
      ) is not null
    ),
    (
      'LOGIC',
      'claim requires every external runtime gate',
      coalesce((
        select
          position('state_row.revalidation_enabled' in definition) > 0
          and position('state_row.external_validation_enabled' in definition) > 0
          and position('externalqueueexecutionenabled' in definition) > 0
          and position('externalrequestsallowed' in definition) > 0
        from claim_definition
      ), false)
    ),
    (
      'LOGIC',
      'claim is serialized with skip locked and a bounded lease',
      coalesce((
        select
          position('for update skip locked' in definition) > 0
          and position('interval ''5 minutes''' in definition) > 0
          and position('least(3' in definition) > 0
        from claim_definition
      ), false)
    ),
    (
      'LOGIC',
      'completion requires the matching one time processing token',
      coalesce((
        select
          position('queue_row.lease_token <> requested_processing_token' in definition) > 0
          and position('queue_row.lease_expires_at < now()' in definition) > 0
        from finish_definition
      ), false)
    ),
    (
      'LOGIC',
      'provider execution has at most three attempts per source',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.max_attempt_count < cardinality(queue_row.provider_plan) * 3
           or queue_row.max_attempt_count > 9
           or queue_row.max_attempt_count < queue_row.attempt_count
      )
      and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid =
          'public.complete_power_outage_address_revalidation_v4_queue'::regclass
          and trigger_row.tgname = 'cpo_address_revalidation_v4_queue_retry_limit'
          and not trigger_row.tgisinternal
      )
    ),
    (
      'LOGIC',
      'configuration error automatically pauses external revalidation',
      coalesce((
        select
          position('revalidation_enabled = false' in definition) > 0
          and position('external_validation_enabled = false' in definition) > 0
          and position('externalworkerpausereason' in definition) > 0
        from finish_definition
      ), false)
    ),
    (
      'SAFETY',
      'installation leaves every external runtime gate disabled',
      coalesce((
        select
          state_row.runtime_mode = 'shadow'
          and not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
          and not coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, true)
          and not coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, true)
        from state_row
      ), false)
    ),
    (
      'SAFETY',
      'disabled worker cannot claim a prepared address pair',
      (
        select count(*) = 0
        from public.claim_complete_power_outage_address_revalidation_v4_v1(3)
      )
      and not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue
        where queue_status not in ('prepared', 'cancelled')
      )
    ),
    (
      'SAFETY',
      'worker installation records no external attempt or quota use',
      not exists (
        select 1 from public.complete_power_outage_address_revalidation_v4_attempts
      )
      and coalesce((
        select quota.last_request_at is null
          and quota.minute_request_count = 0
          and quota.day_request_count = 0
        from public.complete_power_outage_address_revalidation_v4_ruian_quota quota
        where quota.singleton
      ), false)
    ),
    (
      'SAFETY',
      'database worker contract cannot mutate production matches or evidence',
      coalesce((
        select
          position('update public.complete_power_outage_companies' in claim_definition.definition) = 0
          and position('complete_power_outage_company_evidence' in claim_definition.definition) = 0
          and position('update public.complete_power_outage_companies' in finish_definition.definition) = 0
          and position('complete_power_outage_company_evidence' in finish_definition.definition) = 0
        from claim_definition cross join finish_definition
      ), false)
    ),
    (
      'CRON',
      'stage four creates no external address revalidation schedule',
      not exists (
        select 1
        from cron.job job
        where lower(coalesce(job.jobname, '') || ' ' || coalesce(job.command, ''))
          like '%address_revalidation_v4%'
      )
    ),
    (
      'GRANT',
      'authenticated cannot claim complete or inspect external revalidation',
      not has_function_privilege(
        'authenticated',
        'public.claim_complete_power_outage_address_revalidation_v4_v1(integer)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.finish_complete_power_outage_address_revalidation_v4_v1(uuid,uuid,text,text,jsonb,text,timestamp with time zone)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.claim_complete_power_outage_address_revalidation_v4_ruian_quota(integer,integer)',
        'EXECUTE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_revalidation_v4_ruian_quota',
        'SELECT'
      )
    ),
    (
      'RLS',
      'private COMPLETE RUIAN quota table has row level security',
      coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.complete_power_outage_address_revalidation_v4_ruian_quota'::regclass
      ), false)
    ),
    (
      'ISOLATION',
      'external address worker database contract does not reference MARKET objects',
      coalesce((
        select
          position('market' in claim_definition.definition) = 0
          and position('market' in finish_definition.definition) = 0
        from claim_definition cross join finish_definition
      ), false)
    ),
    (
      'STATE',
      'COMPLETE external address worker contract is installed without activation',
      coalesce((
        select
          coalesce((state_row.metadata ->> 'externalWorkerInstalled')::boolean, false)
          and coalesce((state_row.metadata ->> 'externalWorkerBatchLimit')::integer, 0) = 3
          and coalesce((state_row.metadata ->> 'externalProviderRetryLimit')::integer, 0) = 3
          and coalesce((state_row.metadata ->> 'externalRuianMinuteLimit')::integer, 0) = 4
          and coalesce((state_row.metadata ->> 'externalRuianDayLimit')::integer, 0) = 500
        from state_row
      ), false)
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
