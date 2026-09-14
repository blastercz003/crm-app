begin;

-- Finalni analyticky snapshot adresniho auditu EG.D.
-- Soubor pouze zachyti vysledky lokalniho matcheru, externi revalidace a
-- opravneho Mapy replay. Nemeni produkcni firmy, dukazy ani komunikaci.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_address_match_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'address matcher state');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_evaluations') is null then
    missing_dependencies := array_append(missing_dependencies, 'local SHADOW evaluations');
  end if;
  if to_regclass('public.complete_power_outage_address_revalidation_v4_queue') is null then
    missing_dependencies := array_append(missing_dependencies, 'external revalidation queue');
  end if;
  if to_regclass('public.complete_power_outage_address_revalidation_v4_attempts') is null then
    missing_dependencies := array_append(missing_dependencies, 'external attempt history');
  end if;
  if to_regclass('public.complete_power_outage_address_revalidation_v4_replays') is null then
    missing_dependencies := array_append(missing_dependencies, 'Mapy replay evidence');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro finalni analyzu EG.D: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_address_match_v4_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  analysis_version integer not null default 1,
  runtime_mode text not null default 'shadow',
  evaluation_count bigint not null,
  evaluated_pair_count bigint not null,
  external_queue_count bigint not null,
  external_attempt_count bigint not null,
  verified_count bigint not null,
  conflict_count bigint not null,
  needs_review_count bigint not null,
  exhausted_count bigint not null,
  protected_count bigint not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_address_match_v4_analysis_runs_version_check
    check (analysis_version = 1),
  constraint cpo_address_match_v4_analysis_runs_mode_check
    check (runtime_mode = 'shadow'),
  constraint cpo_address_match_v4_analysis_runs_counts_check check (
    evaluation_count >= 0
    and evaluated_pair_count >= 0
    and external_queue_count >= 0
    and external_attempt_count >= 0
    and verified_count >= 0
    and conflict_count >= 0
    and needs_review_count >= 0
    and exhausted_count >= 0
    and protected_count >= 0
    and verified_count + conflict_count + needs_review_count + exhausted_count
      = evaluated_pair_count
  ),
  constraint cpo_address_match_v4_analysis_runs_metrics_check
    check (jsonb_typeof(metrics) = 'object'),
  constraint cpo_address_match_v4_analysis_runs_version_unique
    unique (analysis_version)
);

create table if not exists public.complete_power_outage_address_match_v4_analysis (
  analysis_id uuid not null
    references public.complete_power_outage_address_match_v4_analysis_runs(id)
      on delete restrict deferrable initially deferred,
  target_id uuid not null
    references public.complete_power_outage_address_match_v4_targets(id) on delete restrict,
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete restrict,
  analysis_version integer not null default 1,
  original_candidate_status text not null,
  final_disposition text not null,
  decision_source text not null,
  automatic_confirmation_allowed boolean not null,
  protected_record boolean not null,
  reason_codes text[] not null default '{}'::text[],
  external_queue_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (analysis_id, target_id, company_id),
  constraint cpo_address_match_v4_analysis_version_check
    check (analysis_version = 1),
  constraint cpo_address_match_v4_analysis_original_check check (
    original_candidate_status in ('new', 'confirmed', 'needs_review', 'dismissed', 'stale')
  ),
  constraint cpo_address_match_v4_analysis_disposition_check check (
    final_disposition in ('verified', 'conflict', 'needs_review', 'exhausted')
  ),
  constraint cpo_address_match_v4_analysis_source_check check (
    decision_source in ('local', 'external', 'mapy_replay', 'unresolved_local')
  ),
  constraint cpo_address_match_v4_analysis_confirmation_check check (
    automatic_confirmation_allowed = (final_disposition = 'verified')
  ),
  constraint cpo_address_match_v4_analysis_queue_check check (
    external_queue_status is null
    or external_queue_status in ('verified', 'conflict', 'needs_review', 'exhausted')
  ),
  constraint cpo_address_match_v4_analysis_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_address_match_v4_analysis_disposition_idx
  on public.complete_power_outage_address_match_v4_analysis (
    final_disposition,
    original_candidate_status,
    decision_source,
    company_id
  );

create or replace function public.prevent_complete_power_outage_address_match_v4_analysis_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Finalni analyza adresniho matcheru EG.D je nemenna.';
end;
$$;

drop trigger if exists cpo_address_match_v4_analysis_runs_immutable
  on public.complete_power_outage_address_match_v4_analysis_runs;
create trigger cpo_address_match_v4_analysis_runs_immutable
before update or delete
on public.complete_power_outage_address_match_v4_analysis_runs
for each row execute function public.prevent_complete_power_outage_address_match_v4_analysis_mutation();

drop trigger if exists cpo_address_match_v4_analysis_immutable
  on public.complete_power_outage_address_match_v4_analysis;
create trigger cpo_address_match_v4_analysis_immutable
before update or delete
on public.complete_power_outage_address_match_v4_analysis
for each row execute function public.prevent_complete_power_outage_address_match_v4_analysis_mutation();

create or replace function public.capture_complete_power_outage_address_match_v4_final_analysis_v1()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_analysis_id uuid;
  new_analysis_id uuid := gen_random_uuid();
  v_evaluation_count bigint;
  v_pair_count bigint;
  v_queue_count bigint;
  v_attempt_count bigint;
  v_verified_count bigint;
  v_conflict_count bigint;
  v_needs_review_count bigint;
  v_exhausted_count bigint;
  v_protected_count bigint;
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_match_v4_final_analysis_v1')
  ) then
    raise exception 'Finalni analyzu EG.D prave vytvari jiny proces.';
  end if;

  select analysis_run.id
  into existing_analysis_id
  from public.complete_power_outage_address_match_v4_analysis_runs analysis_run
  where analysis_run.analysis_version = 1;

  if existing_analysis_id is not null then
    return existing_analysis_id;
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
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
      and coalesce((state_row.metadata ->> 'externalQueueRemainingCount')::bigint, -1) = 0
  ) then
    raise exception 'Finalni analyzu lze zachytit pouze po bezpecnem dokonceni SHADOW fronty.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_address_revalidation_v4_queue queue_row
    where queue_row.queue_status not in ('verified', 'conflict', 'needs_review', 'exhausted')
  ) then
    raise exception 'Externi SHADOW fronta stale obsahuje nedokoncene polozky.';
  end if;

  with local_pairs as (
    select
      evaluation.target_id,
      evaluation.company_id,
      min(evaluation.original_candidate_status) as original_candidate_status,
      bool_or(evaluation.automatic_confirmation_allowed) as locally_verified,
      bool_or(evaluation.classification = 'needs_external_verification') as locally_ambiguous,
      bool_or(evaluation.protected_record) as protected_record
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    group by evaluation.target_id, evaluation.company_id
  ), local_reasons as (
    select
      evaluation.target_id,
      evaluation.company_id,
      array_agg(distinct reason_value.reason_code order by reason_value.reason_code)
        as all_reason_codes,
      array_agg(distinct reason_value.reason_code order by reason_value.reason_code)
        filter (where evaluation.automatic_confirmation_allowed)
        as verified_reason_codes
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    cross join lateral unnest(evaluation.reason_codes) as reason_value(reason_code)
    group by evaluation.target_id, evaluation.company_id
  ), latest_attempt as (
    select distinct on (attempt.queue_id)
      attempt.queue_id,
      attempt.provider,
      attempt.outcome,
      attempt.normalized_result,
      attempt.error_code
    from public.complete_power_outage_address_revalidation_v4_attempts attempt
    order by attempt.queue_id, attempt.finished_at desc, attempt.id desc
  ), replay_result as (
    select distinct on (replay.queue_id)
      replay.queue_id,
      replay.classification,
      replay.automatic_confirmation_allowed,
      replay.reason_codes
    from public.complete_power_outage_address_revalidation_v4_replays replay
    order by replay.queue_id, replay.replay_version desc
  ), decisions as (
    select
      local_pair.*,
      local_reason.all_reason_codes,
      local_reason.verified_reason_codes,
      queue_row.id as queue_id,
      queue_row.queue_status,
      latest.provider as latest_provider,
      latest.outcome as latest_outcome,
      latest.normalized_result,
      latest.error_code,
      replay.classification as replay_classification,
      replay.automatic_confirmation_allowed as replay_verified,
      replay.reason_codes as replay_reason_codes,
      case
        when local_pair.locally_verified then 'verified'
        when coalesce(replay.automatic_confirmation_allowed, false) then 'verified'
        when queue_row.queue_status in ('verified', 'conflict', 'needs_review', 'exhausted')
          then queue_row.queue_status
        when local_pair.locally_ambiguous then 'needs_review'
        else 'conflict'
      end as final_disposition,
      case
        when local_pair.locally_verified then 'local'
        when coalesce(replay.automatic_confirmation_allowed, false) then 'mapy_replay'
        when queue_row.id is not null then 'external'
        when local_pair.locally_ambiguous then 'unresolved_local'
        else 'local'
      end as decision_source
    from local_pairs local_pair
    join local_reasons local_reason
      on local_reason.target_id = local_pair.target_id
     and local_reason.company_id = local_pair.company_id
    left join public.complete_power_outage_address_revalidation_v4_queue queue_row
      on queue_row.target_id = local_pair.target_id
     and queue_row.company_id = local_pair.company_id
    left join latest_attempt latest on latest.queue_id = queue_row.id
    left join replay_result replay on replay.queue_id = queue_row.id
  )
  insert into public.complete_power_outage_address_match_v4_analysis (
    analysis_id,
    target_id,
    company_id,
    analysis_version,
    original_candidate_status,
    final_disposition,
    decision_source,
    automatic_confirmation_allowed,
    protected_record,
    reason_codes,
    external_queue_status,
    metadata
  )
  select
    new_analysis_id,
    decision.target_id,
    decision.company_id,
    1,
    decision.original_candidate_status,
    decision.final_disposition,
    decision.decision_source,
    decision.final_disposition = 'verified',
    decision.protected_record,
    case
      when decision.decision_source = 'mapy_replay'
        then coalesce(decision.replay_reason_codes, array[]::text[])
      when decision.decision_source = 'external'
        then case
          when jsonb_typeof(decision.normalized_result -> 'reasonCodes') = 'array'
            and jsonb_array_length(decision.normalized_result -> 'reasonCodes') > 0
          then array(
            select jsonb_array_elements_text(
              decision.normalized_result -> 'reasonCodes'
            )
          )
          else array_remove(array[
            decision.normalized_result ->> 'reason',
            decision.error_code
          ], null)
        end
      else case
        when decision.final_disposition = 'verified'
          then coalesce(decision.verified_reason_codes, array[]::text[])
        else coalesce(decision.all_reason_codes, array[]::text[])
      end
    end,
    decision.queue_status,
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'analysisVersion', 1,
      'latestProvider', decision.latest_provider,
      'latestOutcome', decision.latest_outcome,
      'replayClassification', decision.replay_classification,
      'productionMutationMade', false,
      'externalRequestMade', false
    )
  from decisions decision;

  select
    count(*),
    count(*) filter (where final_disposition = 'verified'),
    count(*) filter (where final_disposition = 'conflict'),
    count(*) filter (where final_disposition = 'needs_review'),
    count(*) filter (where final_disposition = 'exhausted'),
    count(*) filter (where protected_record)
  into
    v_pair_count,
    v_verified_count,
    v_conflict_count,
    v_needs_review_count,
    v_exhausted_count,
    v_protected_count
  from public.complete_power_outage_address_match_v4_analysis analysis_row
  where analysis_row.analysis_id = new_analysis_id;

  select count(*) into v_evaluation_count
  from public.complete_power_outage_address_match_v4_evaluations;
  select count(*) into v_queue_count
  from public.complete_power_outage_address_revalidation_v4_queue;
  select count(*) into v_attempt_count
  from public.complete_power_outage_address_revalidation_v4_attempts;

  -- Odlozeny cizi klic dovoli nejdrive vlozit detail a pote jeho hotovou
  -- hlavicku. Snapshot proto nikdy nepotrebuje docasne vypnout immutable trigger.
  insert into public.complete_power_outage_address_match_v4_analysis_runs (
    id,
    analysis_version,
    runtime_mode,
    evaluation_count,
    evaluated_pair_count,
    external_queue_count,
    external_attempt_count,
    verified_count,
    conflict_count,
    needs_review_count,
    exhausted_count,
    protected_count,
    metrics
  ) values (
    new_analysis_id,
    1,
    'shadow',
    v_evaluation_count,
    v_pair_count,
    v_queue_count,
    v_attempt_count,
    v_verified_count,
    v_conflict_count,
    v_needs_review_count,
    v_exhausted_count,
    v_protected_count,
    jsonb_build_object(
        'captureStatus', 'complete',
        'verifiedPercent', round(100 * v_verified_count::numeric / nullif(v_pair_count, 0), 2),
        'conflictPercent', round(100 * v_conflict_count::numeric / nullif(v_pair_count, 0), 2),
        'needsReviewPercent', round(100 * v_needs_review_count::numeric / nullif(v_pair_count, 0), 2),
        'exhaustedPercent', round(100 * v_exhausted_count::numeric / nullif(v_pair_count, 0), 2),
        'productionMutationMade', false,
        'externalRequestMade', false,
        'emailRuntimeChanged', false
      )
  );

  return new_analysis_id;
end;
$$;

revoke all on table public.complete_power_outage_address_match_v4_analysis_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_match_v4_analysis
  from public, anon, authenticated;
revoke all on function public.capture_complete_power_outage_address_match_v4_final_analysis_v1()
  from public, anon, authenticated;
revoke all on function public.prevent_complete_power_outage_address_match_v4_analysis_mutation()
  from public, anon, authenticated;

grant all on table public.complete_power_outage_address_match_v4_analysis_runs
  to service_role;
grant all on table public.complete_power_outage_address_match_v4_analysis
  to service_role;
grant execute on function public.capture_complete_power_outage_address_match_v4_final_analysis_v1()
  to service_role;
grant execute on function public.prevent_complete_power_outage_address_match_v4_analysis_mutation()
  to service_role;

alter table public.complete_power_outage_address_match_v4_analysis_runs enable row level security;
alter table public.complete_power_outage_address_match_v4_analysis enable row level security;

select public.capture_complete_power_outage_address_match_v4_final_analysis_v1();

commit;
