with latest_analysis as (
  select analysis_run.*
  from public.complete_power_outage_address_match_v4_analysis_runs analysis_run
  where analysis_run.analysis_version = 1
), expected_pairs as (
  select count(*)::bigint as pair_count
  from (
    select evaluation.target_id, evaluation.company_id
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    group by evaluation.target_id, evaluation.company_id
  ) pair
), nitto_regression as (
  select analysis_row.final_disposition, analysis_row.reason_codes
  from public.complete_power_outage_address_match_v4_analysis analysis_row
  join public.complete_power_outage_companies company on company.id = analysis_row.company_id
  where company.company_name ilike 'Nitto Denko Czech%'
), checks(check_type, object_name, is_correct) as (
  values
    (
      'DATA'::text,
      'final analysis contains every evaluated company address pair'::text,
      (select evaluated_pair_count from latest_analysis)
        = (select pair_count from expected_pairs)
      and (select count(*) from public.complete_power_outage_address_match_v4_analysis)
        = (select pair_count from expected_pairs)
    ),
    (
      'DATA',
      'final analysis accounts for every disposition exactly once',
      exists (
        select 1
        from latest_analysis analysis_run
        where analysis_run.verified_count
          + analysis_run.conflict_count
          + analysis_run.needs_review_count
          + analysis_run.exhausted_count
          = analysis_run.evaluated_pair_count
      )
    ),
    (
      'DATA',
      'completed external queue is fully represented in final analysis',
      (select external_queue_count from latest_analysis)
        = (select count(*) from public.complete_power_outage_address_revalidation_v4_queue)
      and not exists (
        select 1
        from public.complete_power_outage_address_revalidation_v4_queue queue_row
        left join public.complete_power_outage_address_match_v4_analysis analysis_row
          on analysis_row.target_id = queue_row.target_id
         and analysis_row.company_id = queue_row.company_id
        where analysis_row.company_id is null
      )
    ),
    (
      'LOGIC',
      'verified disposition is the only automatically confirmable result',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v4_analysis analysis_row
        where analysis_row.automatic_confirmation_allowed
          <> (analysis_row.final_disposition = 'verified')
      )
    ),
    (
      'LOGIC',
      'Mapy replay confirmations are included in effective analysis',
      (select count(*)
       from public.complete_power_outage_address_match_v4_analysis analysis_row
       where analysis_row.decision_source = 'mapy_replay'
         and analysis_row.final_disposition = 'verified')
      = (select count(*)
         from public.complete_power_outage_address_revalidation_v4_replays replay
         where replay.automatic_confirmation_allowed)
    ),
    (
      'LOGIC',
      'Nitto Denko regression is rejected by postal conflict',
      exists (
        select 1
        from nitto_regression regression
        where regression.final_disposition = 'conflict'
          and 'postal_code_mismatch' = any(regression.reason_codes)
      )
    ),
    (
      'STATE',
      'external audit remains safely stopped after analysis capture',
      exists (
        select 1
        from public.complete_power_outage_address_match_state state_row
        where state_row.singleton
          and state_row.runtime_mode = 'shadow'
          and not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
          and not coalesce(
            (state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean,
            false
          )
          and not coalesce(
            (state_row.metadata ->> 'externalRequestsAllowed')::boolean,
            false
          )
          and state_row.metadata ->> 'externalWorkerPauseReason' = 'queue_complete'
      )
    ),
    (
      'SAFETY',
      'final analysis records no production mutation or external request',
      exists (
        select 1
        from latest_analysis analysis_run
        where analysis_run.metrics ->> 'captureStatus' = 'complete'
          and not (analysis_run.metrics ->> 'productionMutationMade')::boolean
          and not (analysis_run.metrics ->> 'externalRequestMade')::boolean
          and not (analysis_run.metrics ->> 'emailRuntimeChanged')::boolean
      )
    ),
    (
      'RLS',
      'private final analysis tables have row level security',
      (select relrowsecurity
       from pg_class
       where oid = 'public.complete_power_outage_address_match_v4_analysis_runs'::regclass)
      and (select relrowsecurity
           from pg_class
           where oid = 'public.complete_power_outage_address_match_v4_analysis'::regclass)
    ),
    (
      'GRANT',
      'authenticated cannot enumerate or capture final analysis',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_analysis',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_analysis_runs',
        'SELECT'
      )
      and not has_function_privilege(
        'authenticated',
        'public.capture_complete_power_outage_address_match_v4_final_analysis_v1()',
        'EXECUTE'
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  analysis_run.id as analysis_id,
  analysis_run.evaluation_count,
  analysis_run.evaluated_pair_count,
  analysis_run.external_queue_count,
  analysis_run.external_attempt_count,
  analysis_run.verified_count,
  analysis_run.conflict_count,
  analysis_run.needs_review_count,
  analysis_run.exhausted_count,
  analysis_run.protected_count,
  analysis_run.metrics,
  analysis_run.created_at
from public.complete_power_outage_address_match_v4_analysis_runs analysis_run
where analysis_run.analysis_version = 1;

select
  analysis_row.original_candidate_status,
  analysis_row.final_disposition,
  analysis_row.decision_source,
  count(*)::bigint as record_count
from public.complete_power_outage_address_match_v4_analysis analysis_row
group by
  analysis_row.original_candidate_status,
  analysis_row.final_disposition,
  analysis_row.decision_source
order by record_count desc, analysis_row.original_candidate_status,
  analysis_row.final_disposition, analysis_row.decision_source;
