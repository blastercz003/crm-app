begin;

-- Dávkové promítnutí dokončeného adresního auditu výhradně pro EG.D v tabu
-- KOMPLETNÍ. ČEZ, PRE ani tabulky MARKET nejsou zdrojem ani cílem změn.
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_address_match_v4_analysis') is null then
    missing := array_append(missing, 'final EG.D analysis');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_evaluations') is null then
    missing := array_append(missing, 'EG.D SHADOW evaluations');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_production_config') is null then
    missing := array_append(missing, 'COMPLETE production email config');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing := array_append(missing, 'COMPLETE email runtime state');
  end if;
  if cardinality(missing) > 0 then
    raise exception 'Chybi zavislosti pro EG.D matcher v5: %', array_to_string(missing, ', ');
  end if;
end
$$;

create or replace function public.normalize_complete_power_outage_building_number_v5(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when btrim(lower(value)) ~ '^0*[0-9]+[a-z]?$'
      and regexp_replace(btrim(lower(value)), '[^0-9].*$', '')::numeric > 0
    then regexp_replace(btrim(lower(value)), '^0+([0-9])', '\1')
    else null
  end
$$;

create or replace function public.complete_power_outage_number_role_result_v5(
  target_pairs jsonb,
  candidate_address text,
  candidate_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  safe_targets jsonb := case when jsonb_typeof(target_pairs) = 'array'
    then target_pairs else '[]'::jsonb end;
  safe_metadata jsonb := case when jsonb_typeof(candidate_metadata) = 'object'
    then candidate_metadata else '{}'::jsonb end;
  clean_address text;
  candidate_pairs jsonb := '[]'::jsonb;
  target_pair jsonb;
  candidate_pair jsonb;
  regex_match text[];
  target_house text;
  target_orientation text;
  candidate_house text;
  candidate_orientation text;
  candidate_roles_reliable boolean;
  ambiguous_match boolean := false;
begin
  candidate_house := public.normalize_complete_power_outage_building_number_v5(
    safe_metadata #>> '{structuredAddress,houseNumber}'
  );
  candidate_orientation := public.normalize_complete_power_outage_building_number_v5(
    safe_metadata #>> '{structuredAddress,orientationNumber}'
  );

  if candidate_house is not null or candidate_orientation is not null then
    candidate_pairs := jsonb_build_array(jsonb_build_object(
      'houseNumber', candidate_house,
      'orientationNumber', candidate_orientation,
      'rolesReliable', true
    ));
  else
    clean_address := regexp_replace(
      coalesce(candidate_address, ''),
      '(^|[^0-9])([0-9]{3})[[:space:]]?([0-9]{2})([^0-9]|$)',
      '\1 \4',
      'g'
    );
    for regex_match in
      select regexp_matches(
        lower(clean_address),
        '(^|[^[:alnum:]])0*([0-9]+[a-z]?)([[:space:]]*/[[:space:]]*0*([0-9]+[a-z]?))?($|[^[:alnum:]])',
        'g'
      )
    loop
      candidate_pairs := candidate_pairs || jsonb_build_array(jsonb_build_object(
        'houseNumber', public.normalize_complete_power_outage_building_number_v5(regex_match[2]),
        'orientationNumber', public.normalize_complete_power_outage_building_number_v5(regex_match[4]),
        'rolesReliable', regex_match[4] is not null
      ));
    end loop;
  end if;

  if jsonb_array_length(safe_targets) = 0 or jsonb_array_length(candidate_pairs) = 0 then
    return 'unresolved';
  end if;

  for target_pair in select value from jsonb_array_elements(safe_targets)
  loop
    target_house := public.normalize_complete_power_outage_building_number_v5(
      target_pair ->> 'houseNumber'
    );
    target_orientation := public.normalize_complete_power_outage_building_number_v5(
      target_pair ->> 'orientationNumber'
    );
    if target_house is null and target_orientation is null then
      continue;
    end if;

    for candidate_pair in select value from jsonb_array_elements(candidate_pairs)
    loop
      candidate_house := public.normalize_complete_power_outage_building_number_v5(
        candidate_pair ->> 'houseNumber'
      );
      candidate_orientation := public.normalize_complete_power_outage_building_number_v5(
        candidate_pair ->> 'orientationNumber'
      );
      candidate_roles_reliable := coalesce(
        (candidate_pair ->> 'rolesReliable')::boolean,
        false
      );

      if candidate_roles_reliable then
        if target_house is not null and target_orientation is not null
          and candidate_house = target_house
          and candidate_orientation = target_orientation then
          return 'exact';
        elsif target_house is not null and target_orientation is null
          and candidate_house = target_house then
          return 'exact';
        elsif target_house is null and target_orientation is not null
          and candidate_orientation = target_orientation then
          return 'exact';
        end if;
      elsif candidate_house = target_house or candidate_house = target_orientation then
        ambiguous_match := true;
      end if;
    end loop;
  end loop;

  return case when ambiguous_match then 'unresolved' else 'conflict' end;
end
$$;

create table if not exists public.complete_power_outage_address_match_v5_apply_runs (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null
    references public.complete_power_outage_address_match_v4_analysis_runs(id) on delete restrict,
  apply_version integer not null default 1,
  source text not null default 'egd',
  scope text not null default 'complete',
  status text not null default 'preparing',
  planned_count bigint not null default 0,
  applied_count bigint not null default 0,
  preserved_count bigint not null default 0,
  verified_count bigint not null default 0,
  conflict_count bigint not null default 0,
  needs_review_count bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cpo_address_match_v5_apply_run_unique unique (apply_version),
  constraint cpo_address_match_v5_apply_source_check check (source = 'egd'),
  constraint cpo_address_match_v5_apply_scope_check check (scope = 'complete'),
  constraint cpo_address_match_v5_apply_status_check check (
    status in ('preparing', 'running', 'complete', 'failed', 'paused')
  ),
  constraint cpo_address_match_v5_apply_counts_check check (
    planned_count >= 0 and applied_count >= 0 and preserved_count >= 0
    and verified_count >= 0 and conflict_count >= 0 and needs_review_count >= 0
  ),
  constraint cpo_address_match_v5_apply_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.complete_power_outage_address_match_v5_apply_items (
  run_id uuid not null
    references public.complete_power_outage_address_match_v5_apply_runs(id) on delete restrict,
  target_id uuid not null
    references public.complete_power_outage_address_match_v4_targets(id) on delete restrict,
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete restrict,
  final_disposition text not null,
  number_role_result text,
  protected_record boolean not null,
  original_candidate_status text not null,
  original_snapshot jsonb not null,
  apply_status text not null default 'pending',
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, target_id, company_id),
  constraint cpo_address_match_v5_item_disposition_check check (
    final_disposition in ('verified', 'conflict', 'needs_review')
  ),
  constraint cpo_address_match_v5_item_role_check check (
    number_role_result is null or number_role_result in ('exact', 'unresolved', 'conflict')
  ),
  constraint cpo_address_match_v5_item_status_check check (
    apply_status in ('pending', 'applied', 'preserved')
  ),
  constraint cpo_address_match_v5_item_snapshot_check check (
    jsonb_typeof(original_snapshot) = 'object'
  )
);

create index if not exists cpo_address_match_v5_apply_items_queue_idx
  on public.complete_power_outage_address_match_v5_apply_items
  (run_id, apply_status, company_id)
  where apply_status = 'pending';

alter table public.complete_power_outage_address_match_v5_apply_runs enable row level security;
alter table public.complete_power_outage_address_match_v5_apply_items enable row level security;
revoke all on table public.complete_power_outage_address_match_v5_apply_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_match_v5_apply_items
  from public, anon, authenticated;
grant all on table public.complete_power_outage_address_match_v5_apply_runs to service_role;
grant all on table public.complete_power_outage_address_match_v5_apply_items to service_role;

create or replace function public.prepare_complete_power_outage_address_match_v5_egd_apply_v1()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_run_id uuid;
  selected_analysis_id uuid;
  new_run_id uuid := gen_random_uuid();
  planned bigint;
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_match_v5_egd_apply_v1')
  ) then
    raise exception 'Pripravu prepoctu EG.D prave provadi jiny proces.';
  end if;

  select id into existing_run_id
  from public.complete_power_outage_address_match_v5_apply_runs
  where apply_version = 1;
  if existing_run_id is not null then return existing_run_id; end if;

  if not exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and not config.production_activation_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.planning_enabled
      and not email_state.dispatch_enabled
      and email_state.runtime_mode <> 'live'
  ) then
    raise exception 'Pred prepoctem EG.D musi byt planovani i odesilani COMPLETE e-mailu vypnute.';
  end if;

  select id into selected_analysis_id
  from public.complete_power_outage_address_match_v4_analysis_runs
  where analysis_version = 1
    and runtime_mode = 'shadow'
    and metrics ->> 'captureStatus' = 'complete'
    and not coalesce((metrics ->> 'productionMutationMade')::boolean, true)
  order by created_at desc
  limit 1;
  if selected_analysis_id is null then
    raise exception 'Chybi dokonceny a nemenny finalni audit EG.D.';
  end if;

  select count(*) into planned
  from public.complete_power_outage_address_match_v4_analysis analysis_row
  join public.complete_power_outage_address_match_v4_targets target
    on target.id = analysis_row.target_id and target.source = 'egd'
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id and outage.source = 'egd'
  where analysis_row.analysis_id = selected_analysis_id;
  if planned = 0 then
    raise exception 'Finalni audit neobsahuje zadnou dvojici EG.D pro prepocet.';
  end if;

  insert into public.complete_power_outage_address_match_v5_apply_runs (
    id, analysis_id, status, planned_count, metadata
  ) values (
    new_run_id,
    selected_analysis_id,
    'preparing',
    planned,
    jsonb_build_object(
      'contract', 'complete-address-match-v5-egd-production-apply-v1',
      'planPreparationMode', 'bounded_batches',
      'preparedItemCount', 0,
      'sourceRestrictedToEgd', true,
      'scopeRestrictedToComplete', true,
      'cezMutationAllowed', false,
      'preMutationAllowed', false,
      'marketMutationAllowed', false,
      'externalRequestAllowed', false,
      'emailRuntimeChanged', false
    )
  );

  return new_run_id;
end
$$;

create or replace function public.prepare_complete_power_outage_address_match_v5_egd_batch_v1(
  requested_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(1000, greatest(1, coalesce(requested_limit, 1000)));
  active_run_id uuid;
  active_analysis_id uuid;
  inserted_now bigint := 0;
  prepared_total bigint := 0;
  expected_total bigint := 0;
  next_status text;
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_match_v5_egd_apply_v1')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and not config.production_activation_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.planning_enabled
      and not email_state.dispatch_enabled
      and email_state.runtime_mode <> 'live'
  ) then
    return jsonb_build_object(
      'status', 'paused',
      'reason', 'complete_email_runtime_not_paused'
    );
  end if;

  select id, analysis_id, planned_count
  into active_run_id, active_analysis_id, expected_total
  from public.complete_power_outage_address_match_v5_apply_runs
  where apply_version = 1 and status = 'preparing'
  for update;
  if active_run_id is null then
    return jsonb_build_object('status', 'not_preparing');
  end if;

  create temporary table if not exists pg_temp.cpo_egd_v5_plan_batch (
    target_id uuid,
    company_id uuid,
    primary key (target_id, company_id)
  ) on commit drop;
  truncate table pg_temp.cpo_egd_v5_plan_batch;

  insert into pg_temp.cpo_egd_v5_plan_batch (target_id, company_id)
  select analysis_row.target_id, analysis_row.company_id
  from public.complete_power_outage_address_match_v4_analysis analysis_row
  join public.complete_power_outage_address_match_v4_targets target
    on target.id = analysis_row.target_id and target.source = 'egd'
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id and outage.source = 'egd'
  left join public.complete_power_outage_address_match_v5_apply_items item
    on item.run_id = active_run_id
   and item.target_id = analysis_row.target_id
   and item.company_id = analysis_row.company_id
  where analysis_row.analysis_id = active_analysis_id
    and item.company_id is null
  order by analysis_row.target_id, analysis_row.company_id
  limit safe_limit;

  with evidence_roles as (
    select
      analysis_row.target_id,
      analysis_row.company_id,
      analysis_row.original_candidate_status,
      analysis_row.protected_record,
      analysis_row.final_disposition,
      public.complete_power_outage_number_role_result_v5(
        target.building_number_pairs,
        evidence.display_address,
        evidence.metadata
      ) as number_role_result
    from pg_temp.cpo_egd_v5_plan_batch batch
    join public.complete_power_outage_address_match_v4_analysis analysis_row
      on analysis_row.analysis_id = active_analysis_id
     and analysis_row.target_id = batch.target_id
     and analysis_row.company_id = batch.company_id
    join public.complete_power_outage_address_match_v4_targets target
      on target.id = analysis_row.target_id and target.source = 'egd'
    join public.complete_power_outage_address_match_v4_evaluations evaluation
      on evaluation.target_id = analysis_row.target_id
     and evaluation.company_id = analysis_row.company_id
    join public.complete_power_outage_company_evidence evidence
      on evidence.id = evaluation.evidence_id
  ), pair_decisions as (
    select
      role.target_id,
      role.company_id,
      min(role.original_candidate_status) as original_candidate_status,
      bool_or(role.protected_record) as protected_record,
      min(role.final_disposition) as audited_disposition,
      case
        when min(role.final_disposition) <> 'verified'
          then case when min(role.final_disposition) = 'conflict'
            then 'conflict' else 'needs_review' end
        when bool_or(role.number_role_result = 'exact') then 'verified'
        when bool_or(role.number_role_result = 'unresolved') then 'needs_review'
        else 'conflict'
      end as effective_disposition,
      case
        when bool_or(role.number_role_result = 'exact') then 'exact'
        when bool_or(role.number_role_result = 'unresolved') then 'unresolved'
        else 'conflict'
      end as effective_number_role_result
    from evidence_roles role
    group by role.target_id, role.company_id
  )
  insert into public.complete_power_outage_address_match_v5_apply_items (
    run_id, target_id, company_id, final_disposition, number_role_result,
    protected_record, original_candidate_status, original_snapshot
  )
  select
    active_run_id,
    decision.target_id,
    decision.company_id,
    decision.effective_disposition,
    decision.effective_number_role_result,
    decision.protected_record or company.resolved_by is not null,
    decision.original_candidate_status,
    jsonb_build_object(
      'candidateStatus', company.candidate_status,
      'confidence', company.confidence,
      'evaluationVersion', company.evaluation_version,
      'evaluationReasons', company.evaluation_reasons,
      'resolvedBy', company.resolved_by,
      'metadata', company.metadata,
      'auditedDispositionV4', decision.audited_disposition
    )
  from pair_decisions decision
  join public.complete_power_outage_companies company on company.id = decision.company_id
  on conflict (run_id, target_id, company_id) do nothing;
  get diagnostics inserted_now = row_count;

  select count(*) into prepared_total
  from public.complete_power_outage_address_match_v5_apply_items
  where run_id = active_run_id;
  if prepared_total > expected_total then
    raise exception 'Davkova priprava vytvorila vice polozek nez obsahuje audit EG.D.';
  end if;
  next_status := case when prepared_total = expected_total then 'running' else 'preparing' end;

  update public.complete_power_outage_address_match_v5_apply_runs run
  set status = next_status,
      verified_count = (select count(*) from public.complete_power_outage_address_match_v5_apply_items where run_id = active_run_id and final_disposition = 'verified'),
      conflict_count = (select count(*) from public.complete_power_outage_address_match_v5_apply_items where run_id = active_run_id and final_disposition = 'conflict'),
      needs_review_count = (select count(*) from public.complete_power_outage_address_match_v5_apply_items where run_id = active_run_id and final_disposition = 'needs_review'),
      metadata = run.metadata || jsonb_build_object(
        'preparedItemCount', prepared_total,
        'latestPreparationBatchAt', now()
      ),
      updated_at = now()
  where run.id = active_run_id;

  return jsonb_build_object(
    'status', next_status,
    'insertedCount', inserted_now,
    'preparedCount', prepared_total,
    'plannedCount', expected_total
  );
end
$$;

create or replace function public.apply_complete_power_outage_address_match_v5_egd_batch_v1(
  requested_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(1000, greatest(1, coalesce(requested_limit, 500)));
  active_run_id uuid;
  selected_count bigint := 0;
  applied_now bigint := 0;
  preserved_now bigint := 0;
  remaining bigint := 0;
  final_status text;
  existing_job record;
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_match_v5_egd_apply_v1')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and not config.production_activation_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.planning_enabled
      and not email_state.dispatch_enabled
      and email_state.runtime_mode <> 'live'
  ) then
    update public.complete_power_outage_address_match_v5_apply_runs
    set status = 'paused', metadata = metadata || jsonb_build_object(
      'pauseReason', 'complete_email_runtime_not_paused', 'pausedAt', now()
    ), updated_at = now()
    where apply_version = 1 and status in ('running', 'preparing');
    return jsonb_build_object('status', 'paused', 'reason', 'complete_email_runtime_not_paused');
  end if;

  select id into active_run_id
  from public.complete_power_outage_address_match_v5_apply_runs
  where apply_version = 1 and status in ('running', 'paused')
  order by started_at desc limit 1;
  if active_run_id is null then
    return jsonb_build_object('status', 'complete', 'processedCount', 0, 'remainingCount', 0);
  end if;

  update public.complete_power_outage_address_match_v5_apply_runs
  set status = 'running', updated_at = now()
  where id = active_run_id and status = 'paused';

  create temporary table if not exists pg_temp.cpo_egd_v5_batch (
    run_id uuid,
    target_id uuid,
    company_id uuid primary key,
    final_disposition text,
    number_role_result text,
    protected_record boolean
  ) on commit drop;
  truncate table pg_temp.cpo_egd_v5_batch;

  insert into pg_temp.cpo_egd_v5_batch
  select item.run_id, item.target_id, item.company_id, item.final_disposition,
    item.number_role_result,
    item.protected_record or company.resolved_by is not null
  from public.complete_power_outage_address_match_v5_apply_items item
  join public.complete_power_outage_companies company
    on company.id = item.company_id
  join public.complete_power_outage_address_match_v4_targets target
    on target.id = item.target_id and target.source = 'egd'
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id and outage.source = 'egd'
  where item.run_id = active_run_id and item.apply_status = 'pending'
  order by item.company_id
  limit safe_limit
  for update of item skip locked;
  get diagnostics selected_count = row_count;

  update public.complete_power_outage_company_evidence evidence
  set match_level = case
        when batch.final_disposition = 'verified'
          and public.complete_power_outage_number_role_result_v5(
            target.building_number_pairs, evidence.display_address, evidence.metadata
          ) = 'exact'
        then case when evaluation.original_match_level = 'same_building'
          then 'same_building' else 'exact_address' end
        else 'unresolved'
      end,
      confidence = least(
        evidence.confidence,
        case batch.final_disposition
          when 'verified' then 0.98
          when 'needs_review' then 0.68
          else 0.20
        end
      ),
      metadata = evidence.metadata || jsonb_build_object(
        'addressMatch', jsonb_build_object(
          'contract', 'complete-address-match-v5',
          'version', 5,
          'sourceScope', 'complete_egd',
          'finalDisposition', batch.final_disposition,
          'numberRoleResult', public.complete_power_outage_number_role_result_v5(
            target.building_number_pairs, evidence.display_address, evidence.metadata
          ),
          'appliedAt', now()
        )
      )
  from pg_temp.cpo_egd_v5_batch batch
  join public.complete_power_outage_address_match_v4_targets target
    on target.id = batch.target_id and target.source = 'egd'
  join public.complete_power_outage_address_match_v4_evaluations evaluation
    on evaluation.target_id = batch.target_id
   and evaluation.company_id = batch.company_id
  where not batch.protected_record
    and evidence.id = evaluation.evidence_id;

  update public.complete_power_outage_companies company
  set candidate_status = case batch.final_disposition
        when 'verified' then 'confirmed'
        when 'needs_review' then 'needs_review'
        else 'stale'
      end,
      evaluation_version = case when batch.final_disposition = 'conflict'
        then company.evaluation_version else 0 end,
      evaluation_reasons = array[
        'complete_address_match_v5',
        case batch.final_disposition
          when 'verified' then 'egd_address_verified'
          when 'needs_review' then 'egd_address_needs_review'
          else 'egd_address_conflict'
        end
      ]::text[],
      evaluated_at = now(),
      metadata = company.metadata || jsonb_build_object(
        'addressMatchV5', jsonb_build_object(
          'contract', 'complete-address-match-v5-egd-production-apply-v1',
          'finalDisposition', batch.final_disposition,
          'numberRoleResult', batch.number_role_result,
          'appliedAt', now()
        )
      ),
      updated_at = now()
  from pg_temp.cpo_egd_v5_batch batch
  where company.id = batch.company_id
    and not batch.protected_record
    and company.resolved_by is null;
  get diagnostics applied_now = row_count;

  update public.complete_power_outage_address_match_v5_apply_items item
  set apply_status = case when batch.protected_record then 'preserved' else 'applied' end,
      applied_at = now(), updated_at = now()
  from pg_temp.cpo_egd_v5_batch batch
  where item.run_id = batch.run_id
    and item.target_id = batch.target_id
    and item.company_id = batch.company_id;

  select count(*) into preserved_now
  from pg_temp.cpo_egd_v5_batch where protected_record;

  select count(*) into remaining
  from public.complete_power_outage_address_match_v5_apply_items
  where run_id = active_run_id and apply_status = 'pending';
  final_status := case when remaining = 0 then 'complete' else 'running' end;

  update public.complete_power_outage_address_match_v5_apply_runs run
  set status = final_status,
      applied_count = (select count(*) from public.complete_power_outage_address_match_v5_apply_items where run_id = active_run_id and apply_status = 'applied'),
      preserved_count = (select count(*) from public.complete_power_outage_address_match_v5_apply_items where run_id = active_run_id and apply_status = 'preserved'),
      finished_at = case when remaining = 0 then now() else null end,
      metadata = run.metadata || jsonb_build_object(
        'remainingCount', remaining,
        'latestBatchAt', now(),
        'productionMutationMade', true,
        'externalRequestMade', false,
        'emailRuntimeChanged', false
      ),
      updated_at = now()
  where run.id = active_run_id;

  if remaining = 0 then
    for existing_job in
      select jobid from cron.job
      where jobname = 'complete-power-outage-egd-address-v5-apply'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
  end if;

  return jsonb_build_object(
    'status', final_status,
    'selectedCount', selected_count,
    'updatedCompanyCount', applied_now,
    'preservedCount', preserved_now,
    'remainingCount', remaining
  );
end
$$;

create or replace function public.process_complete_power_outage_address_match_v5_egd_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select status into current_status
  from public.complete_power_outage_address_match_v5_apply_runs
  where apply_version = 1;

  if current_status = 'preparing' then
    return public.prepare_complete_power_outage_address_match_v5_egd_batch_v1(1000);
  end if;
  if current_status in ('running', 'paused') then
    return public.apply_complete_power_outage_address_match_v5_egd_batch_v1(1000);
  end if;
  return jsonb_build_object('status', coalesce(current_status, 'missing'));
end
$$;

revoke all on function public.normalize_complete_power_outage_building_number_v5(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_number_role_result_v5(jsonb,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.prepare_complete_power_outage_address_match_v5_egd_apply_v1()
  from public, anon, authenticated;
revoke all on function public.prepare_complete_power_outage_address_match_v5_egd_batch_v1(integer)
  from public, anon, authenticated;
revoke all on function public.apply_complete_power_outage_address_match_v5_egd_batch_v1(integer)
  from public, anon, authenticated;
revoke all on function public.process_complete_power_outage_address_match_v5_egd_v1()
  from public, anon, authenticated;
grant execute on function public.normalize_complete_power_outage_building_number_v5(text) to service_role;
grant execute on function public.complete_power_outage_number_role_result_v5(jsonb,text,jsonb) to service_role;
grant execute on function public.prepare_complete_power_outage_address_match_v5_egd_apply_v1() to service_role;
grant execute on function public.prepare_complete_power_outage_address_match_v5_egd_batch_v1(integer) to service_role;
grant execute on function public.apply_complete_power_outage_address_match_v5_egd_batch_v1(integer) to service_role;
grant execute on function public.process_complete_power_outage_address_match_v5_egd_v1() to service_role;

-- SQL editor nema uzivatelskou auth relaci, proto bezpecne a auditovane
-- normalizujeme historicky stav "planner bezi, odesilani ne". Skutecne LIVE
-- odesilani se nikdy nevypina potichu: v takovem pripade migrace skonci.
do $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  previous_config jsonb;
  planning_was_enabled boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete-notification-email-production-config-v1')
  );

  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton
  for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton
  for update;

  if config_row.singleton is null or email_state.singleton is null then
    raise exception 'Chybi jednoznacny stav produkcnich e-mailu KOMPLETNI.';
  end if;
  if config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled
    or email_state.dispatch_enabled
    or email_state.runtime_mode = 'live' then
    raise exception 'Odesilani COMPLETE e-mailu je skutecne aktivni. Pozastavte je nejprve v aplikaci.';
  end if;

  planning_was_enabled := config_row.continuous_planning_enabled
    or email_state.planning_enabled;
  if planning_was_enabled then
    previous_config := to_jsonb(config_row);

    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        continuous_planning_enabled = false,
        continuous_dispatch_enabled = false,
        configuration_version = configuration_version + 1,
        metadata = metadata || jsonb_build_object(
          'maintenancePausedAt', now(),
          'maintenanceReason', 'egd_address_match_v5_historical_recalculation'
        ),
        updated_at = now()
    where singleton
    returning * into config_row;

    update public.complete_power_outage_notification_email_state
    set runtime_mode = 'paused',
        planning_enabled = false,
        dispatch_enabled = false,
        metadata = metadata || jsonb_build_object(
          'maintenancePausedAt', now(),
          'maintenanceReason', 'egd_address_match_v5_historical_recalculation'
        ),
        updated_at = now()
    where singleton;

    if to_regclass('public.cpo_notification_email_production_safety_state') is not null then
      update public.cpo_notification_email_production_safety_state
      set live_signal_ingestion_enabled = false,
          updated_at = now()
      where singleton;
    end if;

    if to_regclass('public.cpo_notification_email_production_activation_intents') is not null then
      update public.cpo_notification_email_production_activation_intents
      set revoked_at = now(),
          metadata = metadata || jsonb_build_object(
            'revocationReason', 'egd_address_match_v5_historical_recalculation'
          )
      where consumed_at is null and revoked_at is null;
    end if;

    insert into public.complete_power_outage_notification_email_production_config_events (
      event_kind, configuration_version, actor_user_id, previous_configuration,
      resulting_configuration, reason, metadata
    ) values (
      'planning_paused', config_row.configuration_version, null, previous_config,
      to_jsonb(config_row),
      'Bezpecnostni pozastaveni planovani pro historicky prepocet adres EG.D.',
      jsonb_build_object(
        'contract', 'complete-address-match-v5-egd-production-apply-v1',
        'sendingAttempted', false,
        'externalRequestMade', false,
        'marketEmailIsolation', true
      )
    );
  end if;
end
$$;

select public.prepare_complete_power_outage_address_match_v5_egd_apply_v1();

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete-power-outage-egd-address-v5-apply'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete-power-outage-egd-address-v5-apply',
    '* * * * *',
    'select public.process_complete_power_outage_address_match_v5_egd_v1();'
  );
end
$$;

commit;
