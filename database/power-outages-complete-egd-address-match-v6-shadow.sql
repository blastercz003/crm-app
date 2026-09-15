begin;

-- EG.D / KOMPLETNI only. Installs the v6 number-role decision and captures a
-- read-only SHADOW reconciliation in bounded batches. No provider request,
-- candidate mutation, email mutation, CEZ/PRE/MARKET reference is allowed.

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
  if to_regprocedure(
    'public.evaluate_complete_power_outage_address_match_v4(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)'
  ) is null then
    missing := array_append(missing, 'evaluate_complete_power_outage_address_match_v4');
  end if;
  if cardinality(missing) > 0 then
    raise exception 'Chybi zavislosti pro EG.D matcher v6: %', array_to_string(missing, ', ');
  end if;
end
$$;

create or replace function public.complete_power_outage_number_role_result_v6(
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
  target_number text;
  value_match boolean := false;
  incomplete_pair_match boolean := false;
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
    if target_house is null and target_orientation is null then continue; end if;

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

      -- A full pair stays indivisible and role-aware.
      if target_house is not null and target_orientation is not null then
        if candidate_roles_reliable
          and candidate_house = target_house
          and candidate_orientation = target_orientation then
          return 'exact_role';
        end if;
        if not candidate_roles_reliable
          and (candidate_house = target_house or candidate_house = target_orientation) then
          incomplete_pair_match := true;
        end if;
        continue;
      end if;

      target_number := coalesce(target_house, target_orientation);
      if candidate_roles_reliable then
        if (target_house is not null and candidate_house = target_number)
          or (target_orientation is not null and candidate_orientation = target_number) then
          return 'exact_role';
        end if;
        if candidate_house = target_number or candidate_orientation = target_number then
          value_match := true;
        end if;
      elsif candidate_house = target_number then
        value_match := true;
      end if;
    end loop;
  end loop;

  if value_match then return 'exact_value'; end if;
  return case when incomplete_pair_match then 'unresolved' else 'conflict' end;
end
$$;

create table if not exists public.complete_power_outage_egd_v6_shadow_runs (
  id uuid primary key default gen_random_uuid(),
  contract text not null default 'complete-egd-address-match-v6-shadow-v1',
  status text not null default 'preparing',
  planned_count bigint not null default 0,
  processed_count bigint not null default 0,
  confirmed_count bigint not null default 0,
  needs_review_count bigint not null default 0,
  stale_count bigint not null default 0,
  changed_count bigint not null default 0,
  promoted_from_review_count bigint not null default 0,
  promoted_from_stale_count bigint not null default 0,
  protected_count bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cpo_egd_v6_shadow_contract_check check (
    contract = 'complete-egd-address-match-v6-shadow-v1'
  ),
  constraint cpo_egd_v6_shadow_status_check check (
    status in ('preparing', 'running', 'complete', 'failed')
  ),
  constraint cpo_egd_v6_shadow_counts_check check (
    planned_count >= 0 and processed_count >= 0
    and confirmed_count >= 0 and needs_review_count >= 0 and stale_count >= 0
    and changed_count >= 0 and promoted_from_review_count >= 0
    and promoted_from_stale_count >= 0 and protected_count >= 0
  ),
  constraint cpo_egd_v6_shadow_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.complete_power_outage_egd_v6_shadow_items (
  run_id uuid not null references public.complete_power_outage_egd_v6_shadow_runs(id) on delete restrict,
  outage_id uuid not null,
  outage_address_id uuid not null,
  company_id uuid not null,
  company_name text not null,
  ico text,
  original_candidate_status text not null,
  final_disposition text not null,
  proposed_candidate_status text not null,
  decision_reason text not null,
  protected_record boolean not null,
  evaluated_target_count integer not null,
  evidence_count integer not null,
  has_postal_conflict boolean not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, company_id),
  constraint cpo_egd_v6_shadow_original_check check (
    original_candidate_status in ('needs_review', 'stale')
  ),
  constraint cpo_egd_v6_shadow_disposition_check check (
    final_disposition in ('verified', 'needs_review', 'conflict')
  ),
  constraint cpo_egd_v6_shadow_proposed_check check (
    proposed_candidate_status in ('confirmed', 'needs_review', 'stale')
  ),
  constraint cpo_egd_v6_shadow_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists cpo_egd_v6_shadow_items_result_idx
  on public.complete_power_outage_egd_v6_shadow_items (
    run_id, original_candidate_status, proposed_candidate_status, company_id
  );

alter table public.complete_power_outage_egd_v6_shadow_runs enable row level security;
alter table public.complete_power_outage_egd_v6_shadow_items enable row level security;
revoke all on table public.complete_power_outage_egd_v6_shadow_runs from public, anon, authenticated;
revoke all on table public.complete_power_outage_egd_v6_shadow_items from public, anon, authenticated;
grant all on table public.complete_power_outage_egd_v6_shadow_runs to service_role;
grant all on table public.complete_power_outage_egd_v6_shadow_items to service_role;

create or replace function public.prevent_complete_power_outage_egd_v6_shadow_item_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'EG.D v6 SHADOW polozky jsou nemenne.';
end
$$;

drop trigger if exists cpo_egd_v6_shadow_items_immutable
  on public.complete_power_outage_egd_v6_shadow_items;
create trigger cpo_egd_v6_shadow_items_immutable
before update or delete on public.complete_power_outage_egd_v6_shadow_items
for each row execute function public.prevent_complete_power_outage_egd_v6_shadow_item_mutation();

create or replace function public.prepare_complete_power_outage_egd_v6_shadow_v1()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_run_id uuid;
  new_run_id uuid := gen_random_uuid();
  planned bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete-egd-address-match-v6-shadow-v1')
  );

  select id into active_run_id
  from public.complete_power_outage_egd_v6_shadow_runs
  where status in ('preparing', 'running')
  order by started_at desc limit 1;
  if active_run_id is not null then return active_run_id; end if;

  select count(*) into planned
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address on address.outage_id = outage.id
  join public.complete_power_outage_companies company on company.outage_address_id = address.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and (
      company.candidate_status = 'needs_review'
      or (
        company.candidate_status = 'stale'
        and (
          company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
          or company.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
          or 'egd_address_conflict' = any(company.evaluation_reasons)
        )
      )
    );

  insert into public.complete_power_outage_egd_v6_shadow_runs (
    id, status, planned_count, metadata
  ) values (
    new_run_id,
    case when planned = 0 then 'complete' else 'running' end,
    planned,
    jsonb_build_object(
      'sourceRestrictedToEgd', true,
      'scopeRestrictedToComplete', true,
      'candidateScope', jsonb_build_array('needs_review', 'narrow_stale_number_role_conflict'),
      'currentAndFutureOnly', true,
      'externalRequestMade', false,
      'productionMutationMade', false,
      'emailRuntimeChanged', false,
      'batchSize', 250
    )
  );
  return new_run_id;
end
$$;

create or replace function public.process_complete_power_outage_egd_v6_shadow_batch_v1(
  requested_limit integer default 250
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(500, greatest(1, coalesce(requested_limit, 250)));
  active_run_id uuid;
  inserted_now bigint := 0;
  processed_total bigint := 0;
  expected_total bigint := 0;
  remaining bigint := 0;
  next_status text;
  existing_job record;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete-egd-address-match-v6-shadow-v1')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  select id, planned_count into active_run_id, expected_total
  from public.complete_power_outage_egd_v6_shadow_runs
  where status = 'running'
  order by started_at desc limit 1
  for update;
  if active_run_id is null then
    return jsonb_build_object('status', 'complete', 'processedCount', 0, 'remainingCount', 0);
  end if;

  create temporary table if not exists pg_temp.cpo_egd_v6_scope (
    outage_id uuid,
    outage_address_id uuid,
    municipality text,
    town_part text,
    street text,
    postal_code text,
    ruian_address_id bigint,
    address_latitude double precision,
    address_longitude double precision,
    company_id uuid primary key,
    company_name text,
    ico text,
    original_candidate_status text,
    company_latitude double precision,
    company_longitude double precision,
    company_ruian_address_id bigint,
    resolved_by uuid,
    evaluation_reasons text[],
    company_metadata jsonb
  ) on commit drop;
  truncate table pg_temp.cpo_egd_v6_scope;

  insert into pg_temp.cpo_egd_v6_scope
  select
    outage.id, address.id, address.municipality, address.town_part, address.street,
    address.postal_code, address.ruian_address_id, address.latitude, address.longitude,
    company.id, company.company_name, company.ico, company.candidate_status,
    company.latitude, company.longitude, company.ruian_address_id, company.resolved_by,
    company.evaluation_reasons, company.metadata
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address on address.outage_id = outage.id
  join public.complete_power_outage_companies company on company.outage_address_id = address.id
  left join public.complete_power_outage_egd_v6_shadow_items item
    on item.run_id = active_run_id and item.company_id = company.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and item.company_id is null
    and (
      company.candidate_status = 'needs_review'
      or (
        company.candidate_status = 'stale'
        and (
          company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
          or company.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
          or 'egd_address_conflict' = any(company.evaluation_reasons)
        )
      )
    )
  order by company.id
  limit safe_limit;

  with targets as (
    select
      scope.*,
      target.id as target_id,
      coalesce(
        nullif(target.metadata ->> 'houseNumber', ''),
        case when nullif(target.metadata ->> 'orientationNumber', '') is null
          then target.number_token else null end
      ) as target_house_number,
      nullif(target.metadata ->> 'orientationNumber', '') as target_orientation_number,
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
    from pg_temp.cpo_egd_v6_scope scope
    join public.complete_power_outage_address_targets target
      on target.outage_address_id = scope.outage_address_id
     and target.target_kind = 'exact_number'
  ), evaluated as (
    select
      target.*,
      evidence.id as evidence_id,
      evidence.provider,
      evidence.display_address,
      evidence.metadata as evidence_metadata,
      base.classification as base_classification,
      base.automatic_confirmation_allowed as base_confirmation_allowed,
      base.reason_codes as base_reason_codes,
      public.complete_power_outage_number_role_result_v6(
        target.target_number_pair, evidence.display_address, evidence.metadata
      ) as number_result,
      (
        target.ruian_address_id is not null
        and target.ruian_address_id = case
          when coalesce(
            nullif(evidence.metadata ->> 'ruianAddressId', ''),
            nullif(evidence.metadata #>> '{structuredAddress,ruianAddressId}', ''),
            case when evidence.provider = 'ares'
              then target.company_ruian_address_id::text else null end
          ) ~ '^[0-9]+$'
          then coalesce(
            nullif(evidence.metadata ->> 'ruianAddressId', ''),
            nullif(evidence.metadata #>> '{structuredAddress,ruianAddressId}', ''),
            case when evidence.provider = 'ares'
              then target.company_ruian_address_id::text else null end
          )::bigint
          else null
        end
      ) as same_ruian,
      (
        btrim(coalesce(target.street, '')) <> ''
        and lower(btrim(target.street)) <> lower(btrim(target.municipality))
        and lower(btrim(target.street)) <> lower(btrim(coalesce(target.town_part, '')))
        and regexp_replace(coalesce(target.postal_code, ''), '[^0-9]', '', 'g') ~ '^[0-9]{5}$'
        and regexp_replace(coalesce(target.postal_code, ''), '[^0-9]', '', 'g') =
          regexp_replace(coalesce(
            nullif(evidence.metadata #>> '{structuredAddress,postalCode}', ''),
            substring(evidence.display_address from '[0-9]{3}[[:space:]]?[0-9]{2}'),
            ''
          ), '[^0-9]', '', 'g')
      ) as same_postal_street
    from targets target
    join public.complete_power_outage_company_evidence evidence
      on evidence.company_id = target.company_id and evidence.provider in ('ares', 'mapy')
    left join lateral public.evaluate_complete_power_outage_address_match_v4(
      target.municipality,
      target.town_part,
      target.street,
      target.target_house_number,
      target.target_orientation_number,
      target.postal_code,
      target.ruian_address_id,
      target.target_latitude,
      target.target_longitude,
      evidence.display_address,
      case
        when coalesce(
          evidence.metadata ->> 'ruianAddressId',
          evidence.metadata #>> '{structuredAddress,ruianAddressId}',
          case when evidence.provider = 'ares'
            then target.company_ruian_address_id::text else null end
        ) ~ '^[0-9]+$'
        then coalesce(
          evidence.metadata ->> 'ruianAddressId',
          evidence.metadata #>> '{structuredAddress,ruianAddressId}',
          case when evidence.provider = 'ares'
            then target.company_ruian_address_id::text else null end
        )::bigint else null
      end,
      target.company_latitude,
      target.company_longitude,
      evidence.distance_meters
    ) base on true
  ), dispositions as (
    select
      evaluated.*,
      case
        when base_classification = 'address_conflict'
          and base_reason_codes = array['coordinate_distance_too_large']::text[]
          and number_result in ('exact_role', 'exact_value')
          and (same_ruian or same_postal_street)
          then 'verified'
        when base_classification = 'address_conflict' then 'conflict'
        when not base_confirmation_allowed then 'needs_review'
        when number_result = 'exact_role' then 'verified'
        when number_result = 'exact_value' and (same_ruian or same_postal_street) then 'verified'
        when number_result in ('exact_value', 'unresolved') then 'needs_review'
        else 'conflict'
      end as disposition
    from evaluated
  ), decisions as (
    select
      scope.outage_id,
      scope.outage_address_id,
      scope.company_id,
      scope.company_name,
      scope.ico,
      scope.original_candidate_status,
      scope.resolved_by,
      scope.evaluation_reasons,
      scope.company_metadata,
      count(distinct disposition.target_id)::integer as target_count,
      count(distinct disposition.evidence_id)::integer as evidence_count,
      coalesce(bool_or('postal_code_mismatch' = any(disposition.base_reason_codes)), false) as postal_conflict,
      case
        when count(disposition.evidence_id) = 0
          and scope.original_candidate_status = 'needs_review' then 'needs_review'
        when count(disposition.evidence_id) = 0 then 'conflict'
        when bool_or(disposition.disposition = 'verified') then 'verified'
        when bool_or(disposition.disposition = 'needs_review') then 'needs_review'
        else 'conflict'
      end as final_disposition,
      case
        when count(disposition.evidence_id) = 0 then 'address_evidence_missing'
        when bool_or(
          disposition.disposition = 'verified'
          and disposition.base_reason_codes = array['coordinate_distance_too_large']::text[]
        ) then 'egd_street_center_distance_ignored'
        when bool_or(disposition.disposition = 'verified' and disposition.number_result = 'exact_value')
          then 'egd_single_number_value_match'
        when bool_or(disposition.disposition = 'verified') then 'building_number_roles_match'
        when bool_or(disposition.disposition = 'needs_review') then 'address_evidence_insufficient'
        else 'address_conflict'
      end as decision_reason
    from pg_temp.cpo_egd_v6_scope scope
    left join dispositions disposition on disposition.company_id = scope.company_id
    group by
      scope.outage_id, scope.outage_address_id, scope.company_id, scope.company_name,
      scope.ico, scope.original_candidate_status, scope.resolved_by,
      scope.evaluation_reasons, scope.company_metadata
  )
  insert into public.complete_power_outage_egd_v6_shadow_items (
    run_id, outage_id, outage_address_id, company_id, company_name, ico,
    original_candidate_status, final_disposition, proposed_candidate_status,
    decision_reason, protected_record, evaluated_target_count, evidence_count,
    has_postal_conflict, snapshot
  )
  select
    active_run_id, decision.outage_id, decision.outage_address_id,
    decision.company_id, decision.company_name, decision.ico,
    decision.original_candidate_status, decision.final_disposition,
    case decision.final_disposition
      when 'verified' then 'confirmed'
      when 'needs_review' then 'needs_review'
      else 'stale'
    end,
    decision.decision_reason,
    decision.resolved_by is not null
      or exists (
        select 1 from public.complete_power_outage_company_assignments assignment
        where assignment.candidate_id = decision.company_id
      )
      or exists (
        select 1 from public.complete_power_outage_communication_states communication_state
        where communication_state.candidate_id = decision.company_id
          and communication_state.communication_status <> 'not_contacted'
      ),
    decision.target_count, decision.evidence_count, decision.postal_conflict,
    jsonb_build_object(
      'candidateStatus', decision.original_candidate_status,
      'evaluationReasons', decision.evaluation_reasons,
      'metadata', decision.company_metadata
    )
  from decisions decision
  on conflict (run_id, company_id) do nothing;
  get diagnostics inserted_now = row_count;

  select count(*) into processed_total
  from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id;
  select count(*) into remaining
  from public.complete_power_outages outage
  join public.complete_power_outage_addresses address on address.outage_id = outage.id
  join public.complete_power_outage_companies company on company.outage_address_id = address.id
  left join public.complete_power_outage_egd_v6_shadow_items item
    on item.run_id = active_run_id and item.company_id = company.id
  where outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and outage.missing_since is null
    and outage.ends_at >= now()
    and item.company_id is null
    and (
      company.candidate_status = 'needs_review'
      or (
        company.candidate_status = 'stale'
        and (
          company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
          or company.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
          or 'egd_address_conflict' = any(company.evaluation_reasons)
        )
      )
    );
  next_status := case when remaining = 0 then 'complete' else 'running' end;

  update public.complete_power_outage_egd_v6_shadow_runs run
  set status = next_status,
      processed_count = processed_total,
      confirmed_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and proposed_candidate_status = 'confirmed'),
      needs_review_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and proposed_candidate_status = 'needs_review'),
      stale_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and proposed_candidate_status = 'stale'),
      changed_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and original_candidate_status <> proposed_candidate_status),
      promoted_from_review_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and original_candidate_status = 'needs_review' and proposed_candidate_status = 'confirmed'),
      promoted_from_stale_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and original_candidate_status = 'stale' and proposed_candidate_status = 'confirmed'),
      protected_count = (select count(*) from public.complete_power_outage_egd_v6_shadow_items where run_id = active_run_id and protected_record),
      metadata = run.metadata || jsonb_build_object(
        'remainingCount', remaining,
        'latestBatchAt', now()
      ),
      finished_at = case when remaining = 0 then now() else null end,
      updated_at = now()
  where run.id = active_run_id;

  if remaining = 0 then
    for existing_job in
      select jobid from cron.job where jobname = 'complete-egd-address-match-v6-shadow'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
  end if;

  return jsonb_build_object(
    'status', next_status,
    'insertedCount', inserted_now,
    'processedCount', processed_total,
    'plannedCount', expected_total,
    'remainingCount', remaining
  );
exception when others then
  if active_run_id is not null then
    update public.complete_power_outage_egd_v6_shadow_runs
    set status = 'failed', metadata = metadata || jsonb_build_object(
      'errorCode', sqlstate, 'errorMessage', sqlerrm, 'failedAt', now()
    ), updated_at = now()
    where id = active_run_id;
  end if;
  raise;
end
$$;

revoke all on function public.complete_power_outage_number_role_result_v6(jsonb,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.prevent_complete_power_outage_egd_v6_shadow_item_mutation()
  from public, anon, authenticated;
revoke all on function public.prepare_complete_power_outage_egd_v6_shadow_v1()
  from public, anon, authenticated;
revoke all on function public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_number_role_result_v6(jsonb,text,jsonb) to service_role;
grant execute on function public.prepare_complete_power_outage_egd_v6_shadow_v1() to service_role;
grant execute on function public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer) to service_role;

select public.prepare_complete_power_outage_egd_v6_shadow_v1();

do $$
declare
  existing_job record;
  current_run_status text;
begin
  select status into current_run_status
  from public.complete_power_outage_egd_v6_shadow_runs
  order by started_at desc limit 1;

  for existing_job in
    select jobid from cron.job where jobname = 'complete-egd-address-match-v6-shadow'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  if current_run_status = 'running' then
    perform cron.schedule(
      'complete-egd-address-match-v6-shadow',
      '* * * * *',
      'select public.process_complete_power_outage_egd_v6_shadow_batch_v1(250);'
    );
  end if;
end
$$;

commit;

select
  id as run_id,
  status,
  planned_count,
  processed_count,
  changed_count,
  promoted_from_review_count,
  promoted_from_stale_count,
  protected_count,
  metadata ->> 'remainingCount' as remaining_count
from public.complete_power_outage_egd_v6_shadow_runs
order by started_at desc
limit 1;
