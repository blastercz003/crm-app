begin;

-- DEPRECATED: tento prvni diagnosticky SHADOW pouziva historicke v4 targety
-- a nesmi byt podkladem pro produkcni zapis. Spravny lokalni prepocet je v
-- power-outages-complete-egd-v5-gap-local-recheck-v2.sql a produkcni oprava v
-- power-outages-complete-egd-v5-gap-production-reconciliation-v2.sql.
-- Tento soubor zustava pouze kvuli auditni historii jiz zachyceneho behu.

-- Lokalni SHADOW prepocet prechodove mezery matcheru v5.
-- Rozsah: pouze aktualni/budouci EG.D v katalogu KOMPLETNI.
-- SQL nemeni kandidatni firmy, nevola externi sluzby a nesaha na CEZ, PRE ani MARKET.

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
  if to_regclass('public.complete_power_outage_companies') is null then
    missing := array_append(missing, 'complete_power_outage_companies');
  end if;
  if to_regclass('public.complete_power_outage_company_evidence') is null then
    missing := array_append(missing, 'complete_power_outage_company_evidence');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_targets') is null then
    missing := array_append(missing, 'complete_power_outage_address_match_v4_targets');
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
    raise exception 'Chybi zavislosti pro lokalni EG.D v5 SHADOW prepocet: %',
      array_to_string(missing, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_egd_v5_gap_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  contract text not null default 'complete-egd-v5-gap-shadow-v1',
  source text not null default 'egd',
  scope text not null default 'complete',
  input_fingerprint text not null unique,
  status text not null default 'complete',
  target_count bigint not null,
  verified_count bigint not null,
  needs_review_count bigint not null,
  conflict_count bigint not null,
  change_count bigint not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_egd_v5_gap_shadow_run_contract_check check (
    contract = 'complete-egd-v5-gap-shadow-v1'
  ),
  constraint cpo_egd_v5_gap_shadow_run_scope_check check (
    source = 'egd' and scope = 'complete'
  ),
  constraint cpo_egd_v5_gap_shadow_run_fingerprint_check check (
    input_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  constraint cpo_egd_v5_gap_shadow_run_status_check check (status = 'complete'),
  constraint cpo_egd_v5_gap_shadow_run_counts_check check (
    target_count >= 0
    and verified_count >= 0
    and needs_review_count >= 0
    and conflict_count >= 0
    and change_count >= 0
    and verified_count + needs_review_count + conflict_count = target_count
    and change_count <= target_count
  ),
  constraint cpo_egd_v5_gap_shadow_run_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create table if not exists public.complete_power_outage_egd_v5_gap_shadow_items (
  run_id uuid not null
    references public.complete_power_outage_egd_v5_gap_shadow_runs(id) on delete restrict,
  outage_id uuid not null
    references public.complete_power_outages(id) on delete restrict,
  outage_address_id uuid not null
    references public.complete_power_outage_addresses(id) on delete restrict,
  target_id uuid not null
    references public.complete_power_outage_address_match_v4_targets(id) on delete restrict,
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete restrict,
  original_candidate_status text not null,
  final_disposition text not null,
  proposed_candidate_status text not null,
  requires_change boolean not null,
  evidence_count integer not null,
  postal_conflict boolean not null,
  scope_reason text not null,
  decision_reasons text[] not null,
  evidence_results jsonb not null,
  original_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, company_id),
  constraint cpo_egd_v5_gap_shadow_item_original_status_check check (
    original_candidate_status in ('confirmed', 'needs_review')
  ),
  constraint cpo_egd_v5_gap_shadow_item_disposition_check check (
    final_disposition in ('verified', 'needs_review', 'conflict')
  ),
  constraint cpo_egd_v5_gap_shadow_item_proposed_status_check check (
    proposed_candidate_status in ('confirmed', 'needs_review', 'stale')
  ),
  constraint cpo_egd_v5_gap_shadow_item_mapping_check check (
    proposed_candidate_status = case final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end
  ),
  constraint cpo_egd_v5_gap_shadow_item_evidence_check check (evidence_count >= 0),
  constraint cpo_egd_v5_gap_shadow_item_reasons_check check (
    cardinality(decision_reasons) > 0
    and array_position(decision_reasons, null) is null
  ),
  constraint cpo_egd_v5_gap_shadow_item_results_check check (
    jsonb_typeof(evidence_results) = 'array'
  ),
  constraint cpo_egd_v5_gap_shadow_item_snapshot_check check (
    jsonb_typeof(original_snapshot) = 'object'
  )
);

create index if not exists cpo_egd_v5_gap_shadow_items_decision_idx
  on public.complete_power_outage_egd_v5_gap_shadow_items (
    run_id, requires_change, final_disposition, company_id
  );

alter table public.complete_power_outage_egd_v5_gap_shadow_runs enable row level security;
alter table public.complete_power_outage_egd_v5_gap_shadow_items enable row level security;

revoke all on table public.complete_power_outage_egd_v5_gap_shadow_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_egd_v5_gap_shadow_items
  from public, anon, authenticated;
grant all on table public.complete_power_outage_egd_v5_gap_shadow_runs to service_role;
grant all on table public.complete_power_outage_egd_v5_gap_shadow_items to service_role;

create or replace function public.prevent_complete_power_outage_egd_v5_gap_shadow_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'EG.D v5 SHADOW audit je nemenny.';
end;
$$;

drop trigger if exists cpo_egd_v5_gap_shadow_runs_immutable
  on public.complete_power_outage_egd_v5_gap_shadow_runs;
create trigger cpo_egd_v5_gap_shadow_runs_immutable
before update or delete on public.complete_power_outage_egd_v5_gap_shadow_runs
for each row execute function public.prevent_complete_power_outage_egd_v5_gap_shadow_mutation();

drop trigger if exists cpo_egd_v5_gap_shadow_items_immutable
  on public.complete_power_outage_egd_v5_gap_shadow_items;
create trigger cpo_egd_v5_gap_shadow_items_immutable
before update or delete on public.complete_power_outage_egd_v5_gap_shadow_items
for each row execute function public.prevent_complete_power_outage_egd_v5_gap_shadow_mutation();

create or replace function public.capture_complete_power_outage_egd_v5_gap_shadow_v1()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_run_id uuid := gen_random_uuid();
  existing_run_id uuid;
  current_fingerprint text;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_egd_v5_gap_shadow_v1')
  );

  drop table if exists pg_temp.cpo_egd_v5_gap_decisions;
  create temporary table cpo_egd_v5_gap_decisions on commit drop as
  with scoped as (
    select
      outage.id as outage_id,
      address.id as outage_address_id,
      target.id as target_id,
      target.municipality,
      target.town_part,
      target.street,
      target.house_number,
      target.orientation_number,
      target.building_number_pairs,
      target.postal_code,
      target.ruian_address_id,
      target.latitude,
      target.longitude,
      company.id as company_id,
      company.company_name,
      company.ico,
      company.candidate_status,
      company.display_address,
      company.ruian_address_id as company_ruian_address_id,
      company.latitude as company_latitude,
      company.longitude as company_longitude,
      company.evaluation_version,
      company.evaluation_reasons,
      company.resolved_by,
      company.metadata as company_metadata,
      company.updated_at as company_updated_at,
      case
        when company.candidate_status = 'confirmed' then 'confirmed_without_v5'
        else 'needs_review_number_role_conflict'
      end as scope_reason
    from public.complete_power_outages outage
    join public.complete_power_outage_addresses address
      on address.outage_id = outage.id
    join public.complete_power_outage_address_match_v4_targets target
      on target.outage_address_id = address.id
     and target.source = 'egd'
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
  ), evaluated as (
    select
      scoped.*,
      evidence.id as evidence_id,
      evidence.provider,
      evidence.display_address as evidence_display_address,
      evidence.metadata as evidence_metadata,
      evidence.distance_meters as recorded_distance_meters,
      base.classification as base_classification,
      base.automatic_confirmation_allowed as base_confirmation_allowed,
      base.reason_codes as base_reason_codes,
      base.distance_meters as calculated_distance_meters,
      base.normalized_target_postal_code,
      base.normalized_candidate_postal_code,
      public.complete_power_outage_number_role_result_v5(
        scoped.building_number_pairs,
        evidence.display_address,
        evidence.metadata
      ) as number_role_result
    from scoped
    join public.complete_power_outage_company_evidence evidence
      on evidence.company_id = scoped.company_id
     and evidence.provider <> 'google'
    left join lateral public.evaluate_complete_power_outage_address_match_v4(
      scoped.municipality,
      scoped.town_part,
      scoped.street,
      scoped.house_number,
      scoped.orientation_number,
      scoped.postal_code,
      scoped.ruian_address_id,
      scoped.latitude,
      scoped.longitude,
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
      scoped.company_latitude,
      scoped.company_longitude,
      evidence.distance_meters
    ) base on true
  ), effective as (
    select
      evaluated.*,
      case
        when base_classification = 'address_conflict' then 'conflict'
        when base_confirmation_allowed and number_role_result = 'exact' then 'verified'
        when base_confirmation_allowed and number_role_result = 'unresolved' then 'needs_review'
        when base_confirmation_allowed then 'conflict'
        -- SQL varianta v4 vznikla pred podporou vice ciselnych paru. Pokud
        -- chybi jen primarni cislo targetu, vysledek dopocitame z ulozenych
        -- building_number_pairs stejne jako produkcni TypeScript v5.
        when 'building_number_missing_target' = any(base_reason_codes)
          and number_role_result = 'conflict' then 'conflict'
        when 'building_number_missing_target' = any(base_reason_codes)
          and number_role_result = 'exact'
          and (
            (
              normalized_target_postal_code is not null
              and normalized_candidate_postal_code = normalized_target_postal_code
            )
            or calculated_distance_meters <= 150
            or (
              normalized_target_postal_code is not null
              and normalized_candidate_postal_code is null
              and calculated_distance_meters <= 500
            )
          ) then 'verified'
        else 'needs_review'
      end as evidence_disposition,
      case
        when base_classification = 'address_conflict' then base_reason_codes
        when base_confirmation_allowed and number_role_result = 'exact'
          then array_append(base_reason_codes, 'building_number_roles_match')
        when base_confirmation_allowed and number_role_result = 'unresolved'
          then array['building_number_roles_unresolved']::text[]
        when base_confirmation_allowed
          then array['building_number_roles_mismatch']::text[]
        when 'building_number_missing_target' = any(base_reason_codes)
          and number_role_result = 'conflict'
          then array['building_number_roles_mismatch']::text[]
        when 'building_number_missing_target' = any(base_reason_codes)
          and number_role_result = 'exact'
          and (
            (
              normalized_target_postal_code is not null
              and normalized_candidate_postal_code = normalized_target_postal_code
            )
            or calculated_distance_meters <= 150
            or (
              normalized_target_postal_code is not null
              and normalized_candidate_postal_code is null
              and calculated_distance_meters <= 500
            )
          )
          then array['building_number_roles_match', 'strong_locality_match']::text[]
        else base_reason_codes
      end as effective_reason_codes
    from evaluated
  ), decisions as (
    select
      scoped.outage_id,
      scoped.outage_address_id,
      scoped.target_id,
      scoped.company_id,
      min(scoped.company_name) as company_name,
      min(scoped.ico) as ico,
      min(scoped.candidate_status) as original_candidate_status,
      min(scoped.scope_reason) as scope_reason,
      min(scoped.company_updated_at) as company_updated_at,
      min(scoped.company_metadata::text)::jsonb as company_metadata,
      min(scoped.display_address) as display_address,
      min(scoped.company_ruian_address_id) as company_ruian_address_id,
      min(scoped.evaluation_version) as evaluation_version,
      min(scoped.evaluation_reasons::text)::text[] as evaluation_reasons,
      max(scoped.resolved_by::text)::uuid as resolved_by,
      count(effective.evidence_id)::integer as evidence_count,
      coalesce(bool_or(
        'postal_code_mismatch' = any(effective.effective_reason_codes)
      ), false) as postal_conflict,
      case
        when bool_or(effective.evidence_disposition = 'verified') then 'verified'
        when bool_or(effective.evidence_disposition = 'needs_review') then 'needs_review'
        else 'conflict'
      end as final_disposition,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'evidenceId', effective.evidence_id,
          'provider', effective.provider,
          'displayAddress', effective.evidence_display_address,
          'baseClassification', effective.base_classification,
          'numberRoleResult', effective.number_role_result,
          'finalDisposition', effective.evidence_disposition,
          'reasonCodes', effective.effective_reason_codes,
          'distanceMeters', effective.calculated_distance_meters
        ) order by effective.provider, effective.evidence_id
      ) filter (where effective.evidence_id is not null), '[]'::jsonb) as evidence_results
    from scoped
    left join effective
      on effective.company_id = scoped.company_id
     and effective.target_id = scoped.target_id
    group by scoped.outage_id, scoped.outage_address_id, scoped.target_id, scoped.company_id
  )
  select
    decisions.*,
    case final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end as proposed_candidate_status,
    original_candidate_status <> case final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end as requires_change,
    case final_disposition
      when 'verified' then array['complete_address_match_v5', 'egd_address_verified']::text[]
      when 'needs_review' then array['complete_address_match_v5', 'egd_address_needs_review']::text[]
      else array['complete_address_match_v5', 'egd_address_conflict']::text[]
    end as decision_reasons
  from decisions;

  select md5(coalesce(string_agg(
    company_id::text || ':' || company_updated_at::text || ':' || final_disposition,
    '|' order by company_id
  ), 'empty'))
  into current_fingerprint
  from pg_temp.cpo_egd_v5_gap_decisions;

  select run.id
  into existing_run_id
  from public.complete_power_outage_egd_v5_gap_shadow_runs run
  where run.input_fingerprint = current_fingerprint;

  if existing_run_id is not null then
    return existing_run_id;
  end if;

  insert into public.complete_power_outage_egd_v5_gap_shadow_runs (
    id,
    input_fingerprint,
    target_count,
    verified_count,
    needs_review_count,
    conflict_count,
    change_count,
    metadata
  )
  select
    new_run_id,
    current_fingerprint,
    count(*)::bigint,
    count(*) filter (where final_disposition = 'verified')::bigint,
    count(*) filter (where final_disposition = 'needs_review')::bigint,
    count(*) filter (where final_disposition = 'conflict')::bigint,
    count(*) filter (where requires_change)::bigint,
    jsonb_build_object(
      'runtimeMode', 'shadow',
      'source', 'egd',
      'scope', 'complete',
      'externalRequestMade', false,
      'productionMutationMade', false,
      'capturedAt', now()
    )
  from pg_temp.cpo_egd_v5_gap_decisions;

  insert into public.complete_power_outage_egd_v5_gap_shadow_items (
    run_id,
    outage_id,
    outage_address_id,
    target_id,
    company_id,
    original_candidate_status,
    final_disposition,
    proposed_candidate_status,
    requires_change,
    evidence_count,
    postal_conflict,
    scope_reason,
    decision_reasons,
    evidence_results,
    original_snapshot
  )
  select
    new_run_id,
    outage_id,
    outage_address_id,
    target_id,
    company_id,
    original_candidate_status,
    final_disposition,
    proposed_candidate_status,
    requires_change,
    evidence_count,
    postal_conflict,
    scope_reason,
    decision_reasons,
    evidence_results,
    jsonb_build_object(
      'companyName', company_name,
      'ico', ico,
      'candidateStatus', original_candidate_status,
      'displayAddress', display_address,
      'ruianAddressId', company_ruian_address_id,
      'evaluationVersion', evaluation_version,
      'evaluationReasons', evaluation_reasons,
      'resolvedBy', resolved_by,
      'metadata', company_metadata,
      'companyUpdatedAt', company_updated_at
    )
  from pg_temp.cpo_egd_v5_gap_decisions;

  return new_run_id;
end;
$$;

revoke all on function public.capture_complete_power_outage_egd_v5_gap_shadow_v1()
  from public, anon, authenticated;
grant execute on function public.capture_complete_power_outage_egd_v5_gap_shadow_v1()
  to service_role;

commit;

select public.capture_complete_power_outage_egd_v5_gap_shadow_v1() as run_id;
