select
  count(*) filter (where queue_status = 'prepared')::bigint as prepared_pair_count,
  count(*) filter (where company_ico is not null)::bigint as ares_first_count,
  count(*) filter (where company_ico is null)::bigint as ruian_first_count,
  count(*) filter (where protected_record)::bigint as protected_pair_count,
  count(*) filter (where queue_status = 'cancelled')::bigint as cancelled_pair_count,
  count(*) filter (where queue_status not in ('prepared', 'cancelled'))::bigint as execution_started_count
from public.complete_power_outage_address_revalidation_v4_queue;

with state_row as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
), refresh_definition as (
  select lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(integer)'::regprocedure
  )) as definition
), eligible_pairs as (
  select
    evaluation.target_id,
    evaluation.company_id,
    bool_or(evaluation.protected_record) as protected_record,
    bool_or(evaluation.classification = 'needs_external_verification') as has_ambiguous,
    bool_or(evaluation.classification in ('exact_address', 'same_building')) as has_local_confirmation
  from public.complete_power_outage_address_match_v4_evaluations evaluation
  join public.complete_power_outage_address_match_v4_targets target
    on target.id = evaluation.target_id
  join public.complete_power_outage_companies company on company.id = evaluation.company_id
  join public.complete_power_outage_addresses address on address.id = target.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where target.source = 'egd'
    and outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and company.candidate_status not in ('dismissed', 'stale')
  group by evaluation.target_id, evaluation.company_id
), checks(check_type, object_name, is_correct) as (
  values
    (
      'TABLE'::text,
      'isolated COMPLETE address revalidation queue exists'::text,
      to_regclass('public.complete_power_outage_address_revalidation_v4_queue') is not null
    ),
    (
      'TABLE',
      'append only COMPLETE address revalidation attempts exist',
      to_regclass('public.complete_power_outage_address_revalidation_v4_attempts') is not null
      and exists (
        select 1 from pg_trigger trigger_row
        where trigger_row.tgrelid =
          'public.complete_power_outage_address_revalidation_v4_attempts'::regclass
          and trigger_row.tgname = 'cpo_address_revalidation_v4_attempts_immutable'
          and not trigger_row.tgisinternal
      )
    ),
    (
      'FUNCTION',
      'idempotent batched COMPLETE address revalidation queue preparation exists',
      to_regprocedure(
        'public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(integer)'
      ) is not null
    ),
    (
      'DATA',
      'every eligible ambiguous company address pair is prepared exactly once',
      not exists (
        select 1
        from eligible_pairs eligible
        where eligible.has_ambiguous
          and not eligible.has_local_confirmation
          and not exists (
            select 1
            from public.complete_power_outage_address_revalidation_v4_queue queue_row
            where queue_row.target_id = eligible.target_id
              and queue_row.company_id = eligible.company_id
              and queue_row.queue_status <> 'cancelled'
          )
      )
      and not exists (
        select queue_row.target_id, queue_row.company_id
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.queue_status <> 'cancelled'
        group by queue_row.target_id, queue_row.company_id
        having count(*) > 1
      )
    ),
    (
      'DATA',
      'locally confirmed company address pairs never enter revalidation',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        join eligible_pairs eligible
          on eligible.target_id = queue_row.target_id
         and eligible.company_id = queue_row.company_id
        where queue_row.queue_status <> 'cancelled'
          and eligible.has_local_confirmation
      )
    ),
    (
      'DATA',
      'conflict only company address pairs never enter revalidation',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        left join eligible_pairs eligible
          on eligible.target_id = queue_row.target_id
         and eligible.company_id = queue_row.company_id
        where queue_row.queue_status <> 'cancelled'
          and coalesce(eligible.has_ambiguous, false) = false
      )
    ),
    (
      'DATA',
      'address revalidation queue contains only EG.D records',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        join public.complete_power_outage_address_match_v4_targets target
          on target.id = queue_row.target_id
        where queue_row.source <> 'egd' or target.source <> 'egd'
      )
    ),
    (
      'LOGIC',
      'ARES backed companies use ARES RUIAN Mapy provider order',
      not exists (
        select 1 from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.queue_status <> 'cancelled'
          and queue_row.company_ico is not null
          and (
            queue_row.provider_plan <> array['ares', 'ruian', 'mapy']::text[]
            or queue_row.next_provider <> 'ares'
          )
      )
    ),
    (
      'LOGIC',
      'companies without ICO use RUIAN then Mapy provider order',
      not exists (
        select 1 from public.complete_power_outage_address_revalidation_v4_queue queue_row
        where queue_row.queue_status <> 'cancelled'
          and queue_row.company_ico is null
          and (
            queue_row.provider_plan <> array['ruian', 'mapy']::text[]
            or queue_row.next_provider <> 'ruian'
          )
      )
    ),
    (
      'LOGIC',
      'protected record marker matches local SHADOW evidence',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        join eligible_pairs eligible
          on eligible.target_id = queue_row.target_id
         and eligible.company_id = queue_row.company_id
        where queue_row.queue_status <> 'cancelled'
          and queue_row.protected_record <> eligible.protected_record
      )
    ),
    (
      'SAFETY',
      'stage three leaves external address processing disabled',
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
      'no external address revalidation attempt has been made',
      not exists (
        select 1 from public.complete_power_outage_address_revalidation_v4_attempts
      )
      and not exists (
        select 1 from public.complete_power_outage_address_revalidation_v4_queue
        where queue_status not in ('prepared', 'cancelled')
           or attempt_count <> 0
      )
    ),
    (
      'SAFETY',
      'queue preparation performs no HTTP or provider request',
      coalesce((
        select
          position('net.http' in refresh_definition.definition) = 0
          and position('http_get' in refresh_definition.definition) = 0
          and position('http_post' in refresh_definition.definition) = 0
        from refresh_definition
      ), false)
    ),
    (
      'SAFETY',
      'queue preparation cannot mutate production company or evidence data',
      coalesce((
        select
          position('update public.complete_power_outage_companies' in refresh_definition.definition) = 0
          and position('delete from public.complete_power_outage_companies' in refresh_definition.definition) = 0
          and position('insert into public.complete_power_outage_company_evidence' in refresh_definition.definition) = 0
          and position('update public.complete_power_outage_company_evidence' in refresh_definition.definition) = 0
        from refresh_definition
      ), false)
    ),
    (
      'CRON',
      'stage three creates no external address revalidation schedule',
      not exists (
        select 1 from cron.job job
        where lower(coalesce(job.jobname, '') || ' ' || coalesce(job.command, ''))
          like '%address_revalidation_v4%'
      )
    ),
    (
      'RLS',
      'private COMPLETE address revalidation tables have row level security',
      coalesce((select relrowsecurity from pg_class
        where oid = 'public.complete_power_outage_address_revalidation_v4_queue'::regclass), false)
      and coalesce((select relrowsecurity from pg_class
        where oid = 'public.complete_power_outage_address_revalidation_v4_attempts'::regclass), false)
    ),
    (
      'GRANT',
      'authenticated cannot inspect or prepare address revalidation',
      not has_table_privilege(
        'authenticated', 'public.complete_power_outage_address_revalidation_v4_queue', 'SELECT'
      )
      and not has_table_privilege(
        'authenticated', 'public.complete_power_outage_address_revalidation_v4_attempts', 'SELECT'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(integer)',
        'EXECUTE'
      )
    ),
    (
      'ISOLATION',
      'address revalidation queue remains in COMPLETE EG.D scope',
      coalesce((
        select
          position('market' in refresh_definition.definition) = 0
          and position('outage.source = ''egd''' in refresh_definition.definition) > 0
        from refresh_definition
      ), false)
    ),
    (
      'STATE',
      'paused COMPLETE address revalidation queue is fully prepared',
      coalesce((
        select
          coalesce((state_row.metadata ->> 'externalQueueReady')::boolean, false)
          and coalesce((state_row.metadata ->> 'externalQueueRemainingCount')::bigint, -1) = 0
          and state_row.metadata ->> 'externalQueueSource' = 'egd'
        from state_row
      ), false)
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
