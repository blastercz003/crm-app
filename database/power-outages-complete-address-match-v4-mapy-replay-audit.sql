with matcher_state as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
),
mapy_attempts as (
  select attempt.*
  from public.complete_power_outage_address_revalidation_v4_attempts attempt
  where attempt.provider = 'mapy'
    and attempt.outcome = 'inconclusive'
    and attempt.normalized_result ->> 'contract' = 'complete-address-revalidation-v4'
),
open_gate_regression as (
  select result.*
  from public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(
    'Babice', 'Babice', 'Babice', '5', null, '675 44', null,
    49.1242343, 15.7688553,
    'Na Navsi 5, 251 01 Babice-Ricany u Prahy',
    null, null, null, null
  ) result
),
checks(check_type, object_name, is_correct) as (
  values
    (
      'TABLE'::text,
      'immutable COMPLETE Mapy replay evidence exists'::text,
      to_regclass('public.complete_power_outage_address_revalidation_v4_replays') is not null
    ),
    (
      'RLS',
      'COMPLETE Mapy replay evidence has row level security',
      coalesce((
        select relrowsecurity
        from pg_class
        where oid = 'public.complete_power_outage_address_revalidation_v4_replays'::regclass
      ), false)
    ),
    (
      'FUNCTION',
      'narrow Mapy replay matcher and refresh exist',
      to_regprocedure(
        'public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)'
      ) is not null
      and to_regprocedure(
        'public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1()'
      ) is not null
    ),
    (
      'GRANT',
      'authenticated cannot inspect or execute private Mapy replay',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_revalidation_v4_replays',
        'SELECT'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1()',
        'EXECUTE'
      )
    ),
    (
      'DATA',
      'every stored inconclusive Mapy result has one local replay',
      not exists (
        select 1
        from mapy_attempts attempt
        left join public.complete_power_outage_address_revalidation_v4_replays replay
          on replay.attempt_id = attempt.id and replay.replay_version = 1
        where replay.attempt_id is null
      )
      and not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_replays replay
        where replay.replay_version = 1
          and not exists (select 1 from mapy_attempts attempt where attempt.id = replay.attempt_id)
      )
    ),
    (
      'LOGIC',
      'exact numbered Mapy candidates within five hundred metres can verify',
      exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_replays replay
        where replay.automatic_confirmation_allowed
          and 'coordinate_supported_number_match' = any(replay.reason_codes)
          and replay.distance_meters <= 500
      )
    ),
    (
      'LOGIC',
      'missing target building number never verifies automatically',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_replays replay
        where replay.automatic_confirmation_allowed
          and 'building_number_missing_target' = any(replay.original_reason_codes)
      )
    ),
    (
      'LOGIC',
      'Mapy replay never verifies beyond five hundred metres',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_replays replay
        where replay.automatic_confirmation_allowed
          and (replay.distance_meters is null or replay.distance_meters > 500)
      )
    ),
    (
      'LOGIC',
      'OPEN GATE regression remains rejected by postal conflict',
      coalesce((
        select regression.classification = 'address_conflict'
          and not regression.automatic_confirmation_allowed
          and 'postal_code_mismatch' = any(regression.reason_codes)
        from open_gate_regression regression
      ), false)
    ),
    (
      'SAFETY',
      'Mapy replay records no external request or production mutation',
      not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_replays replay
        where coalesce((replay.metadata ->> 'externalRequestMade')::boolean, true)
          or coalesce((replay.metadata ->> 'productionMutationMade')::boolean, true)
          or coalesce((replay.metadata ->> 'queueMutationMade')::boolean, true)
      )
    ),
    (
      'STATE',
      'external address worker remains paused after Mapy replay',
      coalesce((
        select state_row.runtime_mode = 'shadow'
          and not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
          and not coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
          and not coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
          and coalesce((state_row.metadata ->> 'mapyReplayReady')::boolean, false)
        from matcher_state state_row
      ), false)
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
