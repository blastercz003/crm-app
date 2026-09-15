begin;

-- Jednorazove produkcni srovnani prechodove mezery matcheru v5.
-- Rozsah je striktne omezen na aktualni/budouci EG.D v tabu KOMPLETNI.
-- Nepouziva sit, nevola ARES/Mapy.com/EG.D a nesaha na CEZ, PRE ani MARKET.

do $$
declare
  missing text[] := '{}'::text[];
begin
  if to_regclass('public.complete_power_outages') is null then
    missing := array_append(missing, 'complete_power_outages');
  end if;
  if to_regclass('public.complete_power_outage_addresses') is null then
    missing := array_append(missing, 'complete_power_outage_addresses');
  end if;
  if to_regclass('public.complete_power_outage_address_targets') is null then
    missing := array_append(missing, 'complete_power_outage_address_targets');
  end if;
  if to_regclass('public.complete_power_outage_companies') is null then
    missing := array_append(missing, 'complete_power_outage_companies');
  end if;
  if to_regclass('public.complete_power_outage_company_evidence') is null then
    missing := array_append(missing, 'complete_power_outage_company_evidence');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_production_config') is null
     or to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing := array_append(missing, 'COMPLETE email safety state');
  end if;
  if to_regprocedure(
    'public.evaluate_complete_power_outage_address_match_v4(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)'
  ) is null then
    missing := array_append(missing, 'evaluate_complete_power_outage_address_match_v4');
  end if;
  if to_regprocedure(
    'public.complete_power_outage_number_role_result_v5(jsonb,text,jsonb)'
  ) is null then
    missing := array_append(missing, 'complete_power_outage_number_role_result_v5');
  end if;
  if cardinality(missing) > 0 then
    raise exception 'Chybi zavislosti pro EG.D v5 gap reconciliation: %',
      array_to_string(missing, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs (
  id uuid primary key default gen_random_uuid(),
  contract text not null unique
    default 'complete-egd-v5-gap-production-reconciliation-v2',
  source text not null default 'egd',
  scope text not null default 'complete',
  candidate_count integer not null,
  evidence_count integer not null,
  confirmed_count integer not null,
  needs_review_count integer not null,
  stale_count integer not null,
  changed_count integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_egd_v5_gap_reconciliation_v2_run_contract_check check (
    contract = 'complete-egd-v5-gap-production-reconciliation-v2'
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_run_scope_check check (
    source = 'egd' and scope = 'complete'
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_run_counts_check check (
    candidate_count >= 0 and evidence_count >= 0
    and confirmed_count >= 0 and needs_review_count >= 0 and stale_count >= 0
    and confirmed_count + needs_review_count + stale_count = candidate_count
    and changed_count between 0 and candidate_count
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_run_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create table if not exists public.complete_power_outage_egd_v5_gap_reconciliation_v2_items (
  run_id uuid not null references
    public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs(id) on delete restrict,
  -- Produkcni objekty se mohou pozdeji prirozene promazat. Audit uchovava
  -- jejich identifikatory a snapshot, ale nesmi jejich zivotni cyklus blokovat.
  outage_id uuid not null,
  outage_address_id uuid not null,
  company_id uuid not null,
  scope_reason text not null,
  original_candidate_status text not null,
  final_disposition text not null,
  resulting_candidate_status text not null,
  evaluated_target_count integer not null,
  evidence_count integer not null,
  evaluated_combination_count bigint not null,
  has_postal_conflict boolean not null,
  original_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, company_id),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_scope_check check (
    scope_reason in ('confirmed_without_v5', 'needs_review_number_role_conflict')
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_original_check check (
    original_candidate_status in ('confirmed', 'needs_review')
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_disposition_check check (
    final_disposition in ('verified', 'needs_review', 'conflict')
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_result_check check (
    resulting_candidate_status = case final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_counts_check check (
    evaluated_target_count > 0 and evidence_count > 0
    and evaluated_combination_count > 0
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_item_snapshot_check check (
    jsonb_typeof(original_snapshot) = 'object'
  )
);

create table if not exists public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence (
  run_id uuid not null references
    public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs(id) on delete restrict,
  company_id uuid not null,
  evidence_id uuid not null,
  provider text not null,
  final_disposition text not null,
  number_role_result text not null,
  has_postal_conflict boolean not null,
  evaluated_target_count integer not null,
  original_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, evidence_id),
  constraint cpo_egd_v5_gap_reconciliation_v2_evidence_disposition_check check (
    final_disposition in ('verified', 'needs_review', 'conflict')
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_evidence_role_check check (
    number_role_result in ('exact', 'unresolved', 'conflict')
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_evidence_count_check check (
    evaluated_target_count > 0
  ),
  constraint cpo_egd_v5_gap_reconciliation_v2_evidence_snapshot_check check (
    jsonb_typeof(original_snapshot) = 'object'
  )
);

create index if not exists cpo_egd_v5_gap_reconciliation_v2_items_result_idx
  on public.complete_power_outage_egd_v5_gap_reconciliation_v2_items (
    run_id, resulting_candidate_status, company_id
  );

alter table public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
  enable row level security;
alter table public.complete_power_outage_egd_v5_gap_reconciliation_v2_items
  enable row level security;
alter table public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence
  enable row level security;

revoke all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_items
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence
  from public, anon, authenticated;
grant all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
  to service_role;
grant all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_items
  to service_role;
grant all on table public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence
  to service_role;

create or replace function public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'EG.D v5 gap production reconciliation audit je nemenny.';
end
$$;

drop trigger if exists cpo_egd_v5_gap_reconciliation_v2_runs_immutable
  on public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs;
create trigger cpo_egd_v5_gap_reconciliation_v2_runs_immutable
before update or delete on public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
for each row execute function
  public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation();

drop trigger if exists cpo_egd_v5_gap_reconciliation_v2_items_immutable
  on public.complete_power_outage_egd_v5_gap_reconciliation_v2_items;
create trigger cpo_egd_v5_gap_reconciliation_v2_items_immutable
before update or delete on public.complete_power_outage_egd_v5_gap_reconciliation_v2_items
for each row execute function
  public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation();

drop trigger if exists cpo_egd_v5_gap_reconciliation_v2_evidence_immutable
  on public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence;
create trigger cpo_egd_v5_gap_reconciliation_v2_evidence_immutable
before update or delete on public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence
for each row execute function
  public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation();

create or replace function public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_run_id uuid := gen_random_uuid();
  existing_run_id uuid;
  candidate_total integer;
  evidence_total integer;
  confirmed_total integer;
  review_total integer;
  stale_total integer;
  changed_total integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete-egd-v5-gap-production-reconciliation-v2')
  );

  select id into existing_run_id
  from public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
  where contract = 'complete-egd-v5-gap-production-reconciliation-v2';
  if existing_run_id is not null then
    return existing_run_id;
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
    raise exception 'Pred srovnanim EG.D musi byt planovani i odesilani COMPLETE e-mailu vypnute.';
  end if;

  -- Zamkneme stejny rozsah pred vytvorenim snapshotu, aby bezici reconciler
  -- nemohl mezi rozhodnutim a zapisem zmenit stav kandidata.
  perform company.id
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and (
      (
        company.candidate_status = 'confirmed'
        and company.metadata #>> '{addressMatchV5,finalDisposition}' is null
        and not exists (
          select 1
          from public.complete_power_outage_company_evidence existing_evidence
          where existing_evidence.company_id = company.id
            and existing_evidence.metadata #>> '{addressMatch,contract}'
              = 'complete-address-match-v5'
        )
      )
      or (
        company.candidate_status = 'needs_review'
        and company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
      )
    )
  for update of company;

  drop table if exists pg_temp.cpo_egd_v5_gap_scope_v2;
  create temporary table cpo_egd_v5_gap_scope_v2 on commit drop as
  select
    outage.id as outage_id,
    address.id as outage_address_id,
    address.municipality,
    address.town_part,
    address.street,
    address.postal_code,
    address.ruian_address_id,
    address.latitude as address_latitude,
    address.longitude as address_longitude,
    company.id as company_id,
    company.company_name,
    company.ico,
    company.candidate_status as original_candidate_status,
    company.latitude as company_latitude,
    company.longitude as company_longitude,
    company.resolved_by,
    case
      when company.candidate_status = 'confirmed' then 'confirmed_without_v5'
      else 'needs_review_number_role_conflict'
    end as scope_reason,
    jsonb_build_object(
      'candidateStatus', company.candidate_status,
      'confidence', company.confidence,
      'evaluationVersion', company.evaluation_version,
      'evaluationReasons', company.evaluation_reasons,
      'evaluatedAt', company.evaluated_at,
      'resolvedAt', company.resolved_at,
      'resolvedBy', company.resolved_by,
      'metadata', company.metadata
    ) as original_snapshot
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address
    on address.outage_id = outage.id
  join public.complete_power_outage_companies company
    on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and (
      (
        company.candidate_status = 'confirmed'
        and company.metadata #>> '{addressMatchV5,finalDisposition}' is null
        and not exists (
          select 1
          from public.complete_power_outage_company_evidence existing_evidence
          where existing_evidence.company_id = company.id
            and existing_evidence.metadata #>> '{addressMatch,contract}'
              = 'complete-address-match-v5'
        )
      )
      or (
        company.candidate_status = 'needs_review'
        and company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
      )
    );

  if exists (
    select 1 from pg_temp.cpo_egd_v5_gap_scope_v2 where resolved_by is not null
  ) then
    raise exception 'Rozsah EG.D obsahuje rucne vyreseny zaznam; automaticke srovnani bylo zastaveno.';
  end if;

  drop table if exists pg_temp.cpo_egd_v5_gap_effective_v2;
  create temporary table cpo_egd_v5_gap_effective_v2 on commit drop as
  with production_targets as (
    select
      scope.*,
      target.id as target_id,
      target.number_token,
      coalesce(
        nullif(target.metadata ->> 'houseNumber', ''),
        case when nullif(target.metadata ->> 'orientationNumber', '') is null
          then target.number_token else null end
      ) as effective_house_number,
      nullif(target.metadata ->> 'orientationNumber', '') as effective_orientation_number,
      coalesce(target.latitude, scope.address_latitude) as target_latitude,
      coalesce(target.longitude, scope.address_longitude) as target_longitude,
      jsonb_build_array(jsonb_build_object(
        'houseNumber', coalesce(
          nullif(target.metadata ->> 'houseNumber', ''),
          case when nullif(target.metadata ->> 'orientationNumber', '') is null
            then target.number_token else null end
        ),
        'orientationNumber', nullif(target.metadata ->> 'orientationNumber', '')
      )) as target_number_pair
    from pg_temp.cpo_egd_v5_gap_scope_v2 scope
    join public.complete_power_outage_address_targets target
      on target.outage_address_id = scope.outage_address_id
     and target.target_kind = 'exact_number'
  ), evaluated as (
    select
      target.*,
      evidence.id as evidence_id,
      evidence.provider,
      evidence.match_level as original_match_level,
      evidence.display_address as evidence_display_address,
      evidence.confidence as evidence_confidence,
      evidence.metadata as evidence_metadata,
      evidence.updated_at as evidence_updated_at,
      base.classification as base_classification,
      base.automatic_confirmation_allowed as base_confirmation_allowed,
      base.reason_codes as base_reason_codes,
      public.complete_power_outage_number_role_result_v5(
        target.target_number_pair,
        evidence.display_address,
        evidence.metadata
      ) as number_role_result
    from production_targets target
    join public.complete_power_outage_company_evidence evidence
      on evidence.company_id = target.company_id
     and evidence.provider <> 'google'
    left join lateral public.evaluate_complete_power_outage_address_match_v4(
      target.municipality,
      target.town_part,
      target.street,
      target.effective_house_number,
      target.effective_orientation_number,
      target.postal_code,
      target.ruian_address_id,
      target.target_latitude,
      target.target_longitude,
      evidence.display_address,
      case
        when coalesce(
          evidence.metadata ->> 'ruianAddressId',
          evidence.metadata #>> '{structuredAddress,ruianAddressId}'
        ) ~ '^[0-9]+$'
        then coalesce(
          evidence.metadata ->> 'ruianAddressId',
          evidence.metadata #>> '{structuredAddress,ruianAddressId}'
        )::bigint
        else null
      end,
      target.company_latitude,
      target.company_longitude,
      evidence.distance_meters
    ) base on true
  )
  select
    evaluated.*,
    case
      when base_classification = 'address_conflict' then 'conflict'
      when not base_confirmation_allowed then 'needs_review'
      when number_role_result = 'exact' then 'verified'
      when number_role_result = 'unresolved' then 'needs_review'
      else 'conflict'
    end as evidence_target_disposition,
    case
      when base_classification = 'address_conflict' then base_reason_codes
      when not base_confirmation_allowed then base_reason_codes
      when number_role_result = 'exact'
        then array_append(base_reason_codes, 'building_number_roles_match')
      when number_role_result = 'unresolved'
        then array['building_number_roles_unresolved']::text[]
      else array['building_number_roles_mismatch']::text[]
    end as effective_reason_codes
  from evaluated;

  drop table if exists pg_temp.cpo_egd_v5_gap_evidence_decisions_v2;
  create temporary table cpo_egd_v5_gap_evidence_decisions_v2 on commit drop as
  select
    effective.company_id,
    effective.evidence_id,
    min(effective.provider) as provider,
    count(distinct effective.target_id)::integer as evaluated_target_count,
    coalesce(bool_or(
      'postal_code_mismatch' = any(effective.effective_reason_codes)
    ), false) as has_postal_conflict,
    case
      when bool_or(effective.evidence_target_disposition = 'verified') then 'verified'
      when bool_or(effective.evidence_target_disposition = 'needs_review') then 'needs_review'
      else 'conflict'
    end as final_disposition,
    case
      when bool_or(
        effective.evidence_target_disposition = 'verified'
        and effective.number_role_result = 'exact'
      ) then 'exact'
      when bool_or(effective.evidence_target_disposition = 'needs_review') then 'unresolved'
      else 'conflict'
    end as number_role_result,
    jsonb_build_object(
      'matchLevel', min(effective.original_match_level),
      'confidence', min(effective.evidence_confidence),
      'metadata', min(effective.evidence_metadata::text)::jsonb,
      'updatedAt', min(effective.evidence_updated_at)
    ) as original_snapshot
  from pg_temp.cpo_egd_v5_gap_effective_v2 effective
  group by effective.company_id, effective.evidence_id;

  drop table if exists pg_temp.cpo_egd_v5_gap_company_decisions_v2;
  create temporary table cpo_egd_v5_gap_company_decisions_v2 on commit drop as
  select
    scope.outage_id,
    scope.outage_address_id,
    scope.company_id,
    scope.scope_reason,
    scope.original_candidate_status,
    scope.original_snapshot,
    count(distinct effective.target_id)::integer as evaluated_target_count,
    count(distinct effective.evidence_id)::integer as evidence_count,
    count(effective.evidence_id)::bigint as evaluated_combination_count,
    coalesce(bool_or(
      'postal_code_mismatch' = any(effective.effective_reason_codes)
    ), false) as has_postal_conflict,
    case
      when bool_or(effective.evidence_target_disposition = 'verified') then 'verified'
      when bool_or(effective.evidence_target_disposition = 'needs_review') then 'needs_review'
      else 'conflict'
    end as final_disposition
  from pg_temp.cpo_egd_v5_gap_scope_v2 scope
  join pg_temp.cpo_egd_v5_gap_effective_v2 effective
    on effective.company_id = scope.company_id
  group by
    scope.outage_id, scope.outage_address_id, scope.company_id,
    scope.scope_reason, scope.original_candidate_status, scope.original_snapshot;

  select
    count(*)::integer,
    count(*) filter (where final_disposition = 'verified')::integer,
    count(*) filter (where final_disposition = 'needs_review')::integer,
    count(*) filter (where final_disposition = 'conflict')::integer,
    count(*) filter (
      where original_candidate_status <> case final_disposition
        when 'verified' then 'confirmed'
        when 'needs_review' then 'needs_review'
        else 'stale'
      end
    )::integer
  into candidate_total, confirmed_total, review_total, stale_total, changed_total
  from pg_temp.cpo_egd_v5_gap_company_decisions_v2;

  select count(*)::integer into evidence_total
  from pg_temp.cpo_egd_v5_gap_evidence_decisions_v2;

  if candidate_total <> 209
     or confirmed_total <> 37
     or review_total <> 56
     or stale_total <> 116
     or changed_total <> 171 then
    raise exception
      'Rozsah se zmenil od schvaleneho SHADOW auditu (celkem %, potvrzeno %, k overeni %, stale %, zmeny %).',
      candidate_total, confirmed_total, review_total, stale_total, changed_total;
  end if;

  insert into public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs (
    id, candidate_count, evidence_count, confirmed_count,
    needs_review_count, stale_count, changed_count, metadata
  ) values (
    new_run_id, candidate_total, evidence_total, confirmed_total,
    review_total, stale_total, changed_total,
    jsonb_build_object(
      'contract', 'complete-egd-v5-gap-production-reconciliation-v2',
      'matcherContract', 'complete-address-match-v5',
      'matcherVersion', 5,
      'sourceRestrictedToEgd', true,
      'scopeRestrictedToComplete', true,
      'currentAndFutureOnly', true,
      'cezMutationAllowed', false,
      'preMutationAllowed', false,
      'marketMutationAllowed', false,
      'externalRequestMade', false,
      'emailRuntimeChanged', false,
      'approvedShadowCandidateCount', 209,
      'approvedShadowChangedCount', 171
    )
  );

  insert into public.complete_power_outage_egd_v5_gap_reconciliation_v2_items (
    run_id, outage_id, outage_address_id, company_id, scope_reason,
    original_candidate_status, final_disposition, resulting_candidate_status,
    evaluated_target_count, evidence_count, evaluated_combination_count,
    has_postal_conflict, original_snapshot
  )
  select
    new_run_id, decision.outage_id, decision.outage_address_id,
    decision.company_id, decision.scope_reason,
    decision.original_candidate_status, decision.final_disposition,
    case decision.final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end,
    decision.evaluated_target_count, decision.evidence_count,
    decision.evaluated_combination_count, decision.has_postal_conflict,
    decision.original_snapshot
  from pg_temp.cpo_egd_v5_gap_company_decisions_v2 decision;

  insert into public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence (
    run_id, company_id, evidence_id, provider, final_disposition,
    number_role_result, has_postal_conflict, evaluated_target_count,
    original_snapshot
  )
  select
    new_run_id, decision.company_id, decision.evidence_id, decision.provider,
    decision.final_disposition, decision.number_role_result,
    decision.has_postal_conflict, decision.evaluated_target_count,
    decision.original_snapshot
  from pg_temp.cpo_egd_v5_gap_evidence_decisions_v2 decision;

  update public.complete_power_outage_company_evidence evidence
  set match_level = case decision.final_disposition
        when 'verified' then 'exact_address'
        else 'unresolved'
      end,
      confidence = least(
        evidence.confidence,
        case decision.final_disposition
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
          'classification', case decision.final_disposition
            when 'verified' then 'exact_address'
            when 'needs_review' then 'needs_external_verification'
            else 'address_conflict'
          end,
          'automaticConfirmationAllowed', decision.final_disposition = 'verified',
          'reasonCodes', case decision.final_disposition
            when 'verified' then jsonb_build_array('building_number_roles_match')
            when 'needs_review' then jsonb_build_array('building_number_roles_unresolved')
            else jsonb_build_array(
              case when decision.has_postal_conflict
                then 'postal_code_mismatch'
                else 'building_number_roles_mismatch'
              end
            )
          end,
          'numberRoleResult', decision.number_role_result,
          'finalDisposition', decision.final_disposition,
          'repairContract', 'complete-egd-v5-gap-production-reconciliation-v2',
          'appliedAt', now()
        )
      ),
      updated_at = now()
  from pg_temp.cpo_egd_v5_gap_evidence_decisions_v2 decision
  where evidence.id = decision.evidence_id
    and evidence.company_id = decision.company_id
    and evidence.provider <> 'google';

  update public.complete_power_outage_companies company
  set candidate_status = case decision.final_disposition
        when 'verified' then 'confirmed'
        when 'needs_review' then 'needs_review'
        else 'stale'
      end,
      confidence = least(
        company.confidence,
        case decision.final_disposition
          when 'verified' then 0.98
          when 'needs_review' then 0.68
          else 0.20
        end
      ),
      evaluation_version = case
        when decision.final_disposition = 'conflict'
          then company.evaluation_version
        else 0
      end,
      evaluation_reasons = array[
        'complete_address_match_v5',
        case decision.final_disposition
          when 'verified' then 'egd_address_verified'
          when 'needs_review' then 'egd_address_needs_review'
          else 'egd_address_conflict'
        end
      ]::text[],
      evaluated_at = now(),
      metadata = company.metadata || jsonb_build_object(
        'addressMatchV5', jsonb_build_object(
          'contract', 'complete-egd-v5-gap-production-reconciliation-v2',
          'matcherContract', 'complete-address-match-v5',
          'version', 5,
          'finalDisposition', decision.final_disposition,
          'evaluatedTargetCount', decision.evaluated_target_count,
          'evidenceCount', decision.evidence_count,
          'postalConflict', decision.has_postal_conflict,
          'appliedAt', now()
        )
      ),
      updated_at = now()
  from pg_temp.cpo_egd_v5_gap_company_decisions_v2 decision
  where company.id = decision.company_id
    and company.resolved_by is null;

  return new_run_id;
end
$$;

revoke all on function public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()
  from public, anon, authenticated;
revoke all on function public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation()
  from public, anon, authenticated;
grant execute on function public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()
  to service_role;
grant execute on function public.prevent_complete_power_outage_egd_v5_gap_reconciliation_v2_mutation()
  to service_role;

select public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2();

commit;
