select
  run.id as run_id,
  run.target_count,
  run.evidence_count,
  run.exact_count,
  run.same_building_count,
  run.external_verification_count,
  run.conflict_count,
  run.postal_conflict_count,
  run.protected_count,
  run.created_at
from public.complete_power_outage_address_match_v4_runs run
order by run.created_at desc, run.id desc
limit 1;

with matcher_state as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
),
latest_run as (
  select *
  from public.complete_power_outage_address_match_v4_runs
  order by created_at desc, id desc
  limit 1
),
refresh_function as (
  select lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_address_match_v4_shadow_v1(integer)'::regprocedure
  )) as definition
),
open_gate_regression as (
  select result.*
  from public.evaluate_complete_power_outage_address_match_v4(
    'Babice', 'Babice', 'Babice', '5', null, '675 44', null,
    49.1242343, 15.7688553,
    'Na Navsi 5, 251 01 Babice-Ricany u Prahy',
    null, null, null, null
  ) result
),
valid_exact_regression as (
  select result.*
  from public.evaluate_complete_power_outage_address_match_v4(
    'Praha', null, 'Na Prikope', '12', null, '110 00', null,
    null, null,
    'Na Prikope 12, 110 00 Praha',
    null, null, null, null
  ) result
),
checks(check_type, object_name, is_correct) as (
  values
    (
      'TABLE'::text,
      'independent COMPLETE address matcher v4 evaluations exist'::text,
      to_regclass('public.complete_power_outage_address_match_v4_evaluations') is not null
    ),
    (
      'TABLE',
      'append only COMPLETE local SHADOW run history exists',
      to_regclass('public.complete_power_outage_address_match_v4_runs') is not null
      and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid =
          'public.complete_power_outage_address_match_v4_runs'::regclass
          and trigger_row.tgname = 'cpo_address_match_v4_runs_immutable'
          and not trigger_row.tgisinternal
      )
    ),
    (
      'FUNCTION',
      'deterministic COMPLETE address matcher v4 exists',
      to_regprocedure(
        'public.evaluate_complete_power_outage_address_match_v4(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)'
      ) is not null
    ),
    (
      'FUNCTION',
      'idempotent local COMPLETE address SHADOW refresh exists',
      to_regprocedure(
        'public.refresh_complete_power_outage_address_match_v4_shadow_v1(integer)'
      ) is not null
    ),
    (
      'DATA',
      'every eligible current EG.D address has one SHADOW target',
      (
        select count(*)
        from public.complete_power_outage_address_match_v4_targets
      ) = (
        select count(*)
        from public.complete_power_outage_addresses address
        join public.complete_power_outages outage on outage.id = address.outage_id
        where outage.ends_at >= now()
          and outage.source = 'egd'
          and outage.source_status in ('scheduled', 'active')
          and coalesce(
            nullif(btrim(address.municipality), ''),
            nullif(btrim(outage.municipality), '')
          ) is not null
      )
    ),
    (
      'DATA',
      'local SHADOW projection contains only EG.D outages',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v4_targets shadow_target
        where shadow_target.source <> 'egd'
      )
    ),
    (
      'DATA',
      'every current stored evidence row has one local SHADOW evaluation',
      (
        select count(*)
        from public.complete_power_outage_address_match_v4_evaluations
      ) = (
        select count(*)
        from public.complete_power_outage_company_evidence evidence
        join public.complete_power_outage_companies company on company.id = evidence.company_id
        join public.complete_power_outage_address_match_v4_targets shadow_target
          on shadow_target.outage_address_id = company.outage_address_id
      )
    ),
    (
      'DATA',
      'local SHADOW evaluations contain no duplicate evidence',
      not exists (
        select evaluation.evidence_id
        from public.complete_power_outage_address_match_v4_evaluations evaluation
        group by evaluation.evidence_id
        having count(*) > 1
      )
    ),
    (
      'DATA',
      'EG.D SHADOW projection retains trusted building number pairs',
      exists (
        select 1
        from public.complete_power_outage_address_match_v4_targets shadow_target
        where jsonb_array_length(shadow_target.building_number_pairs) > 0
      )
    ),
    (
      'DATA',
      'latest local SHADOW run accounts for every classification',
      coalesce((
        select
          run.metrics ->> 'scope' = 'current_and_future_egd_outages'
          and run.metrics ->> 'source' = 'egd'
          and
          run.evidence_count = (
            select count(*)
            from public.complete_power_outage_address_match_v4_evaluations
          )
          and run.target_count = (
            select count(*)
            from public.complete_power_outage_address_match_v4_targets
          )
          and run.exact_count
            + run.same_building_count
            + run.external_verification_count
            + run.conflict_count = run.evidence_count
        from latest_run run
      ), false)
    ),
    (
      'LOGIC',
      'OPEN GATE regression is rejected by postal conflict',
      coalesce((
        select
          regression.classification = 'address_conflict'
          and not regression.automatic_confirmation_allowed
          and 'postal_code_mismatch' = any(regression.reason_codes)
        from open_gate_regression regression
      ), false)
    ),
    (
      'LOGIC',
      'valid exact address remains automatically confirmable',
      coalesce((
        select
          regression.classification = 'exact_address'
          and regression.automatic_confirmation_allowed
          and 'postal_code_match' = any(regression.reason_codes)
        from valid_exact_regression regression
      ), false)
    ),
    (
      'LOGIC',
      'real EG.D evidence contains locally confirmable address matches',
      coalesce((
        select run.exact_count + run.same_building_count > 0
        from latest_run run
      ), false)
    ),
    (
      'LOGIC',
      'street identical to municipality is not treated as independent evidence',
      coalesce((
        select regression.meaningful_street is null
        from open_gate_regression regression
      ), false)
    ),
    (
      'LOGIC',
      'assigned and communicated records are correctly protected',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v4_evaluations evaluation
        where evaluation.protected_record <> (
          exists (
            select 1
            from public.complete_power_outage_company_assignments assignment
            where assignment.candidate_id = evaluation.company_id
          )
          or exists (
            select 1
            from public.complete_power_outage_communication_states communication_state
            where communication_state.candidate_id = evaluation.company_id
              and communication_state.communication_status <> 'not_contacted'
          )
        )
      )
    ),
    (
      'LOGIC',
      'only exact and same building results allow automatic confirmation',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v4_evaluations evaluation
        where evaluation.automatic_confirmation_allowed <>
          (evaluation.classification in ('exact_address', 'same_building'))
      )
    ),
    (
      'RLS',
      'local COMPLETE address SHADOW tables have row level security',
      (
        select count(*) = 2
        from pg_class class_row
        join pg_namespace namespace_row on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname in (
            'complete_power_outage_address_match_v4_evaluations',
            'complete_power_outage_address_match_v4_runs'
          )
          and class_row.relrowsecurity
      )
    ),
    (
      'GRANT',
      'authenticated cannot enumerate local address SHADOW results',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_evaluations',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_runs',
        'SELECT'
      )
    ),
    (
      'GRANT',
      'authenticated cannot run the address matcher or SHADOW refresh',
      not has_function_privilege(
        'authenticated',
        'public.evaluate_complete_power_outage_address_match_v4(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.refresh_complete_power_outage_address_match_v4_shadow_v1(integer)',
        'EXECUTE'
      )
    ),
    (
      'ISOLATION',
      'local address SHADOW refresh stays in COMPLETE scope',
      not exists (
        select 1
        from refresh_function
        where definition like '%market_power_outage%'
          or definition like '%notification_email%'
          or definition like '%jobs%'
      )
    ),
    (
      'SAFETY',
      'local SHADOW refresh cannot mutate production matches or communication',
      not exists (
        select 1
        from refresh_function
        where definition like '%update public.complete_power_outage_companies%'
          or definition like '%delete from public.complete_power_outage_companies%'
          or definition like '%insert into public.complete_power_outage_companies%'
          or definition like '%update public.complete_power_outage_company_evidence%'
          or definition like '%delete from public.complete_power_outage_company_evidence%'
          or definition like '%insert into public.complete_power_outage_company_evidence%'
          or definition like '%update public.complete_power_outage_company_assignments%'
          or definition like '%delete from public.complete_power_outage_company_assignments%'
          or definition like '%update public.complete_power_outage_communication_states%'
          or definition like '%delete from public.complete_power_outage_communication_states%'
      )
    ),
    (
      'SAFETY',
      'local SHADOW refresh performs no HTTP or provider request',
      not exists (
        select 1
        from refresh_function
        where definition like '%net.http%'
          or definition like '%http_get%'
          or definition like '%http_post%'
          or definition like '%request_power_outages_endpoint%'
          or definition like '%provider_quota%'
      )
    ),
    (
      'SAFETY',
      'address revalidation and external validation remain disabled',
      exists (
        select 1
        from matcher_state state_row
        where state_row.runtime_mode = 'shadow'
          and not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
      )
    ),
    (
      'STATE',
      'local COMPLETE address SHADOW projection is recorded as ready',
      exists (
        select 1
        from matcher_state state_row
        where (state_row.metadata ->> 'stage')::integer = 2
          and state_row.metadata ->> 'localShadowSource' = 'egd'
          and (state_row.metadata ->> 'localShadowProjectionRevision')::integer = 2
          and (state_row.metadata ->> 'localShadowProjectionReady')::boolean
          and not (state_row.metadata ->> 'currentDataMutationAllowed')::boolean
          and not (state_row.metadata ->> 'externalRequestsAllowed')::boolean
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
