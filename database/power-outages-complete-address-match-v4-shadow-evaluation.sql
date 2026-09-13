begin;

-- Oprava adresniho matcheru KOMPLETNI, etapa 2.
-- Lokalni SHADOW projekce EG.D a vyhodnoceni jiz ulozenych dukazu. Soubor nevola
-- externi sluzby a nemeni produkcni adresy, firmy, dukazy ani komunikaci.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_address_match_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'address matcher state v4');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_targets') is null then
    missing_dependencies := array_append(missing_dependencies, 'address matcher SHADOW targets v4');
  end if;
  if to_regclass('public.complete_power_outage_address_match_snapshots') is null then
    missing_dependencies := array_append(missing_dependencies, 'address matcher snapshots v4');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    missing_dependencies := array_append(missing_dependencies, 'extensions.digest(text,text)');
  end if;
  if to_regprocedure('public.unaccent(text)') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.unaccent(text)');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro lokalni SHADOW vyhodnoceni adres v4: %.',
      array_to_string(missing_dependencies, ', ');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.production_match_version = 3
      and state_row.shadow_match_version = 4
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
  ) then
    raise exception 'Adresni matcher v4 neni v bezpecnem SHADOW stavu etapy 1.';
  end if;
end
$$;

create or replace function public.normalize_complete_power_outage_address_match_text_v4(
  value text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(public.unaccent(value)), '[^a-z0-9]+', ' ', 'g'),
    '[[:space:]]+',
    ' ',
    'g'
  ));
$$;

create or replace function public.complete_power_outage_postal_code_v4(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(substring(value from '[0-9]{3}[[:space:]]?[0-9]{2}'), '') = '' then null
    else regexp_replace(
      substring(value from '[0-9]{3}[[:space:]]?[0-9]{2}'),
      '[^0-9]',
      '',
      'g'
    )
  end;
$$;

create or replace function public.complete_power_outage_building_number_v4(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(lower(btrim(coalesce(value, ''))), '^0+', ''), '');
$$;

create or replace function public.complete_power_outage_address_contains_token_v4(
  normalized_value text,
  normalized_token text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    ' ' || normalized_value || ' ' like '% ' || normalized_token || ' %',
    false
  );
$$;

create or replace function public.evaluate_complete_power_outage_address_match_v4(
  target_municipality text,
  target_town_part text,
  target_street text,
  target_house_number text,
  target_orientation_number text,
  target_postal_code text,
  target_ruian_address_id bigint,
  target_latitude double precision,
  target_longitude double precision,
  candidate_display_address text,
  candidate_ruian_address_id bigint,
  candidate_latitude double precision,
  candidate_longitude double precision,
  recorded_distance_meters integer default null
)
returns table (
  classification text,
  automatic_confirmation_allowed boolean,
  confidence_ceiling numeric,
  reason_codes text[],
  distance_meters integer,
  normalized_target_postal_code text,
  normalized_candidate_postal_code text,
  meaningful_street text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_candidate text := public.normalize_complete_power_outage_address_match_text_v4(
    coalesce(candidate_display_address, '')
  );
  normalized_municipality text := public.normalize_complete_power_outage_address_match_text_v4(
    coalesce(target_municipality, '')
  );
  normalized_town_part text := public.normalize_complete_power_outage_address_match_text_v4(
    coalesce(target_town_part, '')
  );
  normalized_street text := public.normalize_complete_power_outage_address_match_text_v4(
    coalesce(target_street, '')
  );
  target_postal text := public.complete_power_outage_postal_code_v4(target_postal_code);
  candidate_postal text := public.complete_power_outage_postal_code_v4(candidate_display_address);
  target_house text := public.complete_power_outage_building_number_v4(target_house_number);
  target_orientation text := public.complete_power_outage_building_number_v4(target_orientation_number);
  candidate_without_postal text;
  normalized_candidate_without_postal text;
  house_matches boolean := false;
  orientation_matches boolean := false;
  building_result text;
  calculated_distance integer;
  has_strong_locality boolean;
begin
  meaningful_street := case
    when normalized_street = ''
      or normalized_street = normalized_municipality
      or normalized_street = normalized_town_part
    then null
    else normalized_street
  end;
  normalized_target_postal_code := target_postal;
  normalized_candidate_postal_code := candidate_postal;

  if recorded_distance_meters is not null then
    calculated_distance := recorded_distance_meters;
  elsif target_latitude between -90 and 90
    and target_longitude between -180 and 180
    and candidate_latitude between -90 and 90
    and candidate_longitude between -180 and 180 then
    calculated_distance := round(6371000 * acos(least(1.0, greatest(-1.0,
      sin(radians(target_latitude)) * sin(radians(candidate_latitude))
      + cos(radians(target_latitude)) * cos(radians(candidate_latitude))
        * cos(radians(candidate_longitude - target_longitude))
    ))))::integer;
  else
    calculated_distance := null;
  end if;
  distance_meters := calculated_distance;

  if target_ruian_address_id is not null and candidate_ruian_address_id is not null then
    if target_ruian_address_id = candidate_ruian_address_id then
      classification := 'exact_address';
      automatic_confirmation_allowed := true;
      confidence_ceiling := 0.98;
      reason_codes := array['ruian_address_id_match']::text[];
    else
      classification := 'address_conflict';
      automatic_confirmation_allowed := false;
      confidence_ceiling := 0.20;
      reason_codes := array['ruian_address_id_mismatch']::text[];
    end if;
    return next;
    return;
  end if;

  if target_postal is not null and candidate_postal is not null
    and target_postal <> candidate_postal then
    classification := 'address_conflict';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.20;
    reason_codes := array['postal_code_mismatch']::text[];
    return next;
    return;
  end if;

  if normalized_candidate = '' then
    classification := 'needs_external_verification';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.68;
    reason_codes := array['candidate_address_missing']::text[];
    return next;
    return;
  end if;

  if normalized_municipality = '' or not public.complete_power_outage_address_contains_token_v4(
    normalized_candidate,
    normalized_municipality
  ) then
    classification := 'address_conflict';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.20;
    reason_codes := array['municipality_mismatch']::text[];
    return next;
    return;
  end if;

  if meaningful_street is not null and not public.complete_power_outage_address_contains_token_v4(
    normalized_candidate,
    meaningful_street
  ) then
    classification := 'address_conflict';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.20;
    reason_codes := array['street_mismatch']::text[];
    return next;
    return;
  end if;

  if calculated_distance is not null and calculated_distance > 500 then
    classification := 'address_conflict';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.20;
    reason_codes := array['coordinate_distance_too_large']::text[];
    return next;
    return;
  end if;

  if target_house is null and target_orientation is null then
    classification := 'needs_external_verification';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.68;
    reason_codes := array['building_number_missing_target']::text[];
    return next;
    return;
  end if;

  candidate_without_postal := regexp_replace(
    coalesce(candidate_display_address, ''),
    '(^|[^0-9])[0-9]{3}[[:space:]]?[0-9]{2}([^0-9]|$)',
    ' ',
    'g'
  );
  normalized_candidate_without_postal := public.normalize_complete_power_outage_address_match_text_v4(
    candidate_without_postal
  );
  if normalized_candidate_without_postal !~ '[0-9]' then
    classification := 'needs_external_verification';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.68;
    reason_codes := array['building_number_missing_candidate']::text[];
    return next;
    return;
  end if;

  house_matches := target_house is not null
    and public.complete_power_outage_address_contains_token_v4(
      normalized_candidate_without_postal,
      target_house
    );
  orientation_matches := target_orientation is not null
    and public.complete_power_outage_address_contains_token_v4(
      normalized_candidate_without_postal,
      target_orientation
    );

  if target_house is not null and target_orientation is not null then
    building_result := case
      when house_matches and orientation_matches then 'exact'
      when house_matches then 'same_building'
      else 'conflict'
    end;
  else
    building_result := case
      when house_matches or orientation_matches then 'exact'
      else 'conflict'
    end;
  end if;

  if building_result = 'conflict' then
    classification := 'address_conflict';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.20;
    reason_codes := array['building_number_mismatch']::text[];
    return next;
    return;
  end if;

  has_strong_locality := (
    target_postal is not null
    and candidate_postal is not null
    and target_postal = candidate_postal
  ) or (calculated_distance is not null and calculated_distance <= 150);

  if not has_strong_locality then
    classification := 'needs_external_verification';
    automatic_confirmation_allowed := false;
    confidence_ceiling := 0.68;
    reason_codes := case
      when target_postal is not null
        then array['candidate_postal_code_missing']::text[]
      else array['strong_locality_identity_missing']::text[]
    end;
    return next;
    return;
  end if;

  classification := case when building_result = 'same_building'
    then 'same_building' else 'exact_address' end;
  automatic_confirmation_allowed := true;
  confidence_ceiling := case when building_result = 'same_building' then 0.92 else 0.98 end;
  reason_codes := case
    when meaningful_street is null then array_remove(array[
      'numbered_locality_match',
      case when target_postal is not null then 'postal_code_match' else 'coordinate_match' end
    ], null)::text[]
    else array_remove(array[
      'municipality_match',
      'street_match',
      'building_number_match',
      case when target_postal is not null then 'postal_code_match' else 'coordinate_match' end
    ], null)::text[]
  end;
  return next;
end;
$$;

alter table public.complete_power_outage_address_match_v4_targets
  add column if not exists building_number_pairs jsonb not null default '[]'::jsonb;
alter table public.complete_power_outage_address_match_v4_targets
  drop constraint if exists cpo_address_match_v4_targets_number_pairs_check;
alter table public.complete_power_outage_address_match_v4_targets
  add constraint cpo_address_match_v4_targets_number_pairs_check check (
    jsonb_typeof(building_number_pairs) = 'array'
  );

create table if not exists public.complete_power_outage_address_match_v4_evaluations (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null
    references public.complete_power_outage_address_match_v4_targets(id) on delete cascade,
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  evidence_id uuid not null
    references public.complete_power_outage_company_evidence(id) on delete cascade,
  provider text not null,
  original_candidate_status text not null,
  original_match_level text not null,
  classification text not null,
  automatic_confirmation_allowed boolean not null,
  confidence_ceiling numeric(5,4) not null,
  reason_codes text[] not null,
  distance_meters integer,
  normalized_target_postal_code text,
  normalized_candidate_postal_code text,
  meaningful_street text,
  protected_record boolean not null default false,
  input_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cpo_address_match_v4_evaluations_provider_check check (
    provider in ('ares', 'res', 'mapy', 'google')
  ),
  constraint cpo_address_match_v4_evaluations_status_check check (
    original_candidate_status in ('new', 'confirmed', 'needs_review', 'dismissed', 'stale')
  ),
  constraint cpo_address_match_v4_evaluations_level_check check (
    original_match_level in ('exact_address', 'same_building', 'nearby', 'unresolved')
  ),
  constraint cpo_address_match_v4_evaluations_classification_check check (
    classification in (
      'exact_address',
      'same_building',
      'needs_external_verification',
      'address_conflict'
    )
  ),
  constraint cpo_address_match_v4_evaluations_confirmation_check check (
    automatic_confirmation_allowed = (
      classification in ('exact_address', 'same_building')
    )
  ),
  constraint cpo_address_match_v4_evaluations_confidence_check check (
    confidence_ceiling between 0 and 1
  ),
  constraint cpo_address_match_v4_evaluations_reasons_check check (
    cardinality(reason_codes) > 0 and array_position(reason_codes, null) is null
  ),
  constraint cpo_address_match_v4_evaluations_distance_check check (
    distance_meters is null or distance_meters >= 0
  ),
  constraint cpo_address_match_v4_evaluations_postal_check check (
    (normalized_target_postal_code is null or normalized_target_postal_code ~ '^[0-9]{5}$')
    and (normalized_candidate_postal_code is null or normalized_candidate_postal_code ~ '^[0-9]{5}$')
  ),
  constraint cpo_address_match_v4_evaluations_fingerprint_check check (
    input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_address_match_v4_evaluations_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_address_match_v4_evaluations_evidence_unique unique (evidence_id)
);

create index if not exists cpo_address_match_v4_evaluations_result_idx
  on public.complete_power_outage_address_match_v4_evaluations (
    classification,
    protected_record,
    provider,
    evaluated_at,
    evidence_id
  );

create index if not exists cpo_address_match_v4_evaluations_company_idx
  on public.complete_power_outage_address_match_v4_evaluations (company_id, classification);

create index if not exists cpo_address_match_v4_evaluations_target_idx
  on public.complete_power_outage_address_match_v4_evaluations (target_id, evidence_id);

create table if not exists public.complete_power_outage_address_match_v4_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null default 'local_shadow_evaluation',
  target_count bigint not null,
  evidence_count bigint not null,
  exact_count bigint not null,
  same_building_count bigint not null,
  external_verification_count bigint not null,
  conflict_count bigint not null,
  protected_count bigint not null,
  postal_conflict_count bigint not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_address_match_v4_runs_kind_check check (
    run_kind = 'local_shadow_evaluation'
  ),
  constraint cpo_address_match_v4_runs_counts_check check (
    target_count >= 0
    and evidence_count >= 0
    and exact_count >= 0
    and same_building_count >= 0
    and external_verification_count >= 0
    and conflict_count >= 0
    and protected_count >= 0
    and postal_conflict_count >= 0
    and exact_count + same_building_count + external_verification_count + conflict_count = evidence_count
  ),
  constraint cpo_address_match_v4_runs_metrics_check check (
    jsonb_typeof(metrics) = 'object'
  )
);

create or replace function public.prevent_complete_power_outage_address_match_v4_run_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie lokalnich SHADOW vyhodnoceni adres KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_address_match_v4_runs_immutable
  on public.complete_power_outage_address_match_v4_runs;
create trigger cpo_address_match_v4_runs_immutable
before update or delete
on public.complete_power_outage_address_match_v4_runs
for each row execute function public.prevent_complete_power_outage_address_match_v4_run_mutation();

-- Revize 2 opravuje projekci EG.D tak, aby pouzivala svazane dvojice
-- domovnich/orientacnich cisel z normalizatoru. Predchozi chybne vysledky
-- odstranime pouze ze SHADOW pracovnich tabulek; nemenna historie behu zustava.
do $$
begin
  if coalesce((
    select state_row.metadata ->> 'localShadowProjectionRevision'
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
  ), '0') <> '2' then
    delete from public.complete_power_outage_address_match_v4_evaluations;
    delete from public.complete_power_outage_address_match_v4_targets;

    update public.complete_power_outage_address_match_state
    set metadata = metadata || jsonb_build_object(
          'stage', 2,
          'localShadowProjectionRevision', 2,
          'localShadowSource', 'egd',
          'localShadowProjectionReady', false,
          'localShadowRemainingCount', null,
          'supersededRunHistoryPreserved', true,
          'projectionCorrectedAt', now(),
          'currentDataMutationAllowed', false,
          'externalRequestsAllowed', false
        ),
        updated_at = now()
    where singleton;
  end if;
end
$$;

-- Pokud puvodni jednorazovy skript po timeoutu presto dobehl na serveru,
-- odstranime jeho bezparametrickou variantu. Davkova varianta niz je jedina
-- podporovana cesta a vzdy dostava explicitni limit.
drop function if exists public.refresh_complete_power_outage_address_match_v4_shadow_v1();

create or replace function public.refresh_complete_power_outage_address_match_v4_shadow_v1(
  requested_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_target_count bigint;
  v_evidence_count bigint;
  v_exact_count bigint;
  v_same_building_count bigint;
  v_external_verification_count bigint;
  v_conflict_count bigint;
  v_protected_count bigint;
  v_postal_conflict_count bigint;
  v_processed_count bigint := 0;
  v_remaining_count bigint := 0;
  safe_limit integer := least(2000, greatest(1, coalesce(requested_limit, 500)));
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_match_v4_shadow')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
  ) then
    raise exception 'Lokalni projekci lze spustit pouze v neaktivnim SHADOW rezimu.';
  end if;

  insert into public.complete_power_outage_address_match_v4_targets as shadow_target (
    outage_address_id,
    source,
    municipality,
    municipality_code,
    town_part,
    street,
    street_is_meaningful,
    house_number,
    orientation_number,
    building_number_pairs,
    postal_code,
    ruian_address_id,
    latitude,
    longitude,
    target_fingerprint,
    projection_status,
    metadata,
    updated_at
  )
  select
    address.id,
    outage.source,
    coalesce(nullif(btrim(address.municipality), ''), btrim(outage.municipality)),
    coalesce(address.municipality_code, outage.municipality_code),
    nullif(btrim(address.town_part), ''),
    nullif(btrim(address.street), ''),
    normalized.street_value <> ''
      and normalized.street_value <> normalized.municipality_value
      and normalized.street_value <> normalized.town_part_value,
    nullif(btrim(address.house_number), ''),
    nullif(btrim(address.orientation_number), ''),
    number_pairs.value,
    public.complete_power_outage_postal_code_v4(address.postal_code),
    address.ruian_address_id,
    address.latitude,
    address.longitude,
    encode(extensions.digest(concat_ws('|',
      'complete-address-match-v4',
      address.id::text,
      outage.source,
      normalized.municipality_value,
      coalesce(address.municipality_code, outage.municipality_code, ''),
      normalized.town_part_value,
      normalized.street_value,
      coalesce(address.house_number, ''),
      coalesce(address.orientation_number, ''),
      number_pairs.value::text,
      coalesce(public.complete_power_outage_postal_code_v4(address.postal_code), ''),
      coalesce(address.ruian_address_id::text, ''),
      coalesce(address.latitude::text, ''),
      coalesce(address.longitude::text, '')
    ), 'sha256'), 'hex'),
    'prepared',
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'stage', 2,
      'sourceAddressScope', address.address_scope,
      'localProjectionOnly', true,
      'externalRequestMade', false
    ),
    now()
  from public.complete_power_outage_addresses address
  join public.complete_power_outages outage on outage.id = address.outage_id
  cross join lateral (
    select
      public.normalize_complete_power_outage_address_match_text_v4(
        coalesce(nullif(btrim(address.municipality), ''), btrim(outage.municipality))
      ) as municipality_value,
      public.normalize_complete_power_outage_address_match_text_v4(
        coalesce(address.town_part, '')
      ) as town_part_value,
      public.normalize_complete_power_outage_address_match_text_v4(
        coalesce(address.street, '')
      ) as street_value
  ) normalized
  cross join lateral (
    select case
      when jsonb_typeof(address.metadata -> 'buildingNumberPairs') = 'array'
        and jsonb_array_length(address.metadata -> 'buildingNumberPairs') > 0
      then address.metadata -> 'buildingNumberPairs'
      when nullif(btrim(address.house_number), '') is not null
        or nullif(btrim(address.orientation_number), '') is not null
      then jsonb_build_array(jsonb_build_object(
        'houseNumber', nullif(btrim(address.house_number), ''),
        'orientationNumber', nullif(btrim(address.orientation_number), '')
      ))
      else '[]'::jsonb
    end as value
  ) number_pairs
  where outage.ends_at >= now()
    and outage.source = 'egd'
    and outage.source_status in ('scheduled', 'active')
    and coalesce(nullif(btrim(address.municipality), ''), nullif(btrim(outage.municipality), ''))
      is not null
  on conflict (outage_address_id) do update
  set source = excluded.source,
      municipality = excluded.municipality,
      municipality_code = excluded.municipality_code,
      town_part = excluded.town_part,
      street = excluded.street,
      street_is_meaningful = excluded.street_is_meaningful,
      house_number = excluded.house_number,
      orientation_number = excluded.orientation_number,
      building_number_pairs = excluded.building_number_pairs,
      postal_code = excluded.postal_code,
      ruian_address_id = excluded.ruian_address_id,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      target_fingerprint = excluded.target_fingerprint,
      projection_status = excluded.projection_status,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at;

  delete from public.complete_power_outage_address_match_v4_targets shadow_target
  where not exists (
    select 1
    from public.complete_power_outage_addresses address
    join public.complete_power_outages outage on outage.id = address.outage_id
    where address.id = shadow_target.outage_address_id
      and outage.ends_at >= now()
      and outage.source = 'egd'
      and outage.source_status in ('scheduled', 'active')
      and coalesce(
        nullif(btrim(address.municipality), ''),
        nullif(btrim(outage.municipality), '')
      ) is not null
  );

  -- Hodnoceni se doplnuje po malych, opakovatelnych davkach. Produkcni
  -- tabulky se pouze ctou a jiz vyhodnoceny dukaz se znovu nezpracovava.

  insert into public.complete_power_outage_address_match_v4_evaluations (
    target_id,
    company_id,
    evidence_id,
    provider,
    original_candidate_status,
    original_match_level,
    classification,
    automatic_confirmation_allowed,
    confidence_ceiling,
    reason_codes,
    distance_meters,
    normalized_target_postal_code,
    normalized_candidate_postal_code,
    meaningful_street,
    protected_record,
    input_fingerprint,
    metadata
  )
  select
    shadow_target.id,
    company.id,
    evidence.id,
    evidence.provider,
    company.candidate_status,
    evidence.match_level,
    evaluation.classification,
    evaluation.automatic_confirmation_allowed,
    evaluation.confidence_ceiling,
    evaluation.reason_codes,
    evaluation.distance_meters,
    evaluation.normalized_target_postal_code,
    evaluation.normalized_candidate_postal_code,
    evaluation.meaningful_street,
    protection.is_protected,
    encode(extensions.digest(concat_ws('|',
      shadow_target.target_fingerprint,
      company.id::text,
      evidence.id::text,
      evidence.provider,
      evidence.match_level,
      coalesce(evidence.display_address, ''),
      coalesce(candidate_identity.ruian_address_id::text, ''),
      coalesce(candidate_identity.latitude::text, ''),
      coalesce(candidate_identity.longitude::text, ''),
      coalesce(evidence.distance_meters::text, ''),
      coalesce(evidence.updated_at::text, '')
    ), 'sha256'), 'hex'),
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'stage', 2,
      'localEvidenceOnly', true,
      'productionCandidateStatusChanged', false,
      'productionEvidenceChanged', false,
      'externalRequestMade', false
    )
  from public.complete_power_outage_address_match_v4_targets shadow_target
  join public.complete_power_outage_companies company
    on company.outage_address_id = shadow_target.outage_address_id
  join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = company.id
  cross join lateral (
    select
      case
        when coalesce(evidence.metadata ->> 'ruianAddressId', '') ~ '^[0-9]{1,18}$'
          then (evidence.metadata ->> 'ruianAddressId')::bigint
        when evidence.provider = 'ares' then company.ruian_address_id
        else null
      end as ruian_address_id,
      case when evidence.provider in ('mapy', 'google') then company.latitude else null end
        as latitude,
      case when evidence.provider in ('mapy', 'google') then company.longitude else null end
        as longitude
  ) candidate_identity
  cross join lateral (
    select (
      exists (
        select 1
        from public.complete_power_outage_company_assignments assignment
        where assignment.candidate_id = company.id
      )
      or exists (
        select 1
        from public.complete_power_outage_communication_states communication_state
        where communication_state.candidate_id = company.id
          and communication_state.communication_status <> 'not_contacted'
      )
    ) as is_protected
  ) protection
  cross join lateral (
    select candidate_evaluation.*
    from jsonb_array_elements(
      case
        when jsonb_array_length(shadow_target.building_number_pairs) > 0
          then shadow_target.building_number_pairs
        else jsonb_build_array(jsonb_build_object(
          'houseNumber', shadow_target.house_number,
          'orientationNumber', shadow_target.orientation_number
        ))
      end
    ) number_pair(value)
    cross join lateral public.evaluate_complete_power_outage_address_match_v4(
      shadow_target.municipality,
      shadow_target.town_part,
      shadow_target.street,
      coalesce(number_pair.value ->> 'houseNumber', shadow_target.house_number),
      coalesce(number_pair.value ->> 'orientationNumber', shadow_target.orientation_number),
      shadow_target.postal_code,
      shadow_target.ruian_address_id,
      shadow_target.latitude,
      shadow_target.longitude,
      evidence.display_address,
      candidate_identity.ruian_address_id,
      candidate_identity.latitude,
      candidate_identity.longitude,
      evidence.distance_meters
    ) candidate_evaluation
    order by case candidate_evaluation.classification
      when 'exact_address' then 1
      when 'same_building' then 2
      when 'needs_external_verification' then 3
      else 4
    end,
    candidate_evaluation.confidence_ceiling desc
    limit 1
  ) evaluation
  where not exists (
    select 1
    from public.complete_power_outage_address_match_v4_evaluations existing_evaluation
    where existing_evaluation.evidence_id = evidence.id
  )
  order by evidence.id
  limit safe_limit;

  get diagnostics v_processed_count = row_count;

  select count(*)
  into v_remaining_count
  from public.complete_power_outage_company_evidence evidence
  join public.complete_power_outage_companies company on company.id = evidence.company_id
  join public.complete_power_outage_address_match_v4_targets shadow_target
    on shadow_target.outage_address_id = company.outage_address_id
  where not exists (
    select 1
    from public.complete_power_outage_address_match_v4_evaluations existing_evaluation
    where existing_evaluation.evidence_id = evidence.id
  );

  if v_remaining_count = 0 then
    update public.complete_power_outage_address_match_v4_targets shadow_target
    set projection_status = 'evaluated',
        metadata = shadow_target.metadata || jsonb_build_object(
          'evaluatedAt', now(),
          'evaluationCount', (
            select count(*)
            from public.complete_power_outage_address_match_v4_evaluations evaluation
            where evaluation.target_id = shadow_target.id
          )
        ),
        updated_at = now();
  end if;

  select count(*)
  into v_target_count
  from public.complete_power_outage_address_match_v4_targets;

  select
    count(*),
    count(*) filter (where classification = 'exact_address'),
    count(*) filter (where classification = 'same_building'),
    count(*) filter (where classification = 'needs_external_verification'),
    count(*) filter (where classification = 'address_conflict'),
    count(*) filter (where protected_record),
    count(*) filter (where 'postal_code_mismatch' = any(reason_codes))
  into
    v_evidence_count,
    v_exact_count,
    v_same_building_count,
    v_external_verification_count,
    v_conflict_count,
    v_protected_count,
    v_postal_conflict_count
  from public.complete_power_outage_address_match_v4_evaluations;

  insert into public.complete_power_outage_address_match_v4_runs (
    id,
    target_count,
    evidence_count,
    exact_count,
    same_building_count,
    external_verification_count,
    conflict_count,
    protected_count,
    postal_conflict_count,
    metrics
  ) values (
    v_run_id,
    v_target_count,
    v_evidence_count,
    v_exact_count,
    v_same_building_count,
    v_external_verification_count,
    v_conflict_count,
    v_protected_count,
    v_postal_conflict_count,
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'stage', 2,
      'scope', 'current_and_future_egd_outages',
      'source', 'egd',
      'localEvidenceOnly', true,
      'processedInBatch', v_processed_count,
      'remainingAfterBatch', v_remaining_count,
      'batchComplete', v_remaining_count = 0,
      'productionDataMutated', false,
      'externalRequestMade', false,
      'completedAt', now()
    )
  );

  update public.complete_power_outage_address_match_state
  set metadata = metadata || jsonb_build_object(
        'stage', 2,
        'latestLocalShadowRunId', v_run_id,
        'latestLocalShadowRunAt', now(),
        'localShadowSource', 'egd',
        'localShadowProjectionReady', v_remaining_count = 0,
        'localShadowRemainingCount', v_remaining_count,
        'currentDataMutationAllowed', false,
        'externalRequestsAllowed', false
      ),
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'status', case when v_remaining_count = 0 then 'complete' else 'pending' end,
    'runId', v_run_id,
    'processedCount', v_processed_count,
    'remainingCount', v_remaining_count,
    'targetCount', v_target_count,
    'evidenceCount', v_evidence_count,
    'exactCount', v_exact_count,
    'sameBuildingCount', v_same_building_count,
    'externalVerificationCount', v_external_verification_count,
    'conflictCount', v_conflict_count,
    'protectedCount', v_protected_count,
    'postalConflictCount', v_postal_conflict_count
  );
end;
$$;

do $$
declare
  open_gate_classification text;
  open_gate_automatic boolean;
  valid_exact_classification text;
  valid_exact_automatic boolean;
begin
  select result.classification, result.automatic_confirmation_allowed
  into open_gate_classification, open_gate_automatic
  from public.evaluate_complete_power_outage_address_match_v4(
    'Babice', 'Babice', 'Babice', '5', null, '675 44', null,
    49.1242343, 15.7688553,
    'Na Navsi 5, 251 01 Babice-Ricany u Prahy',
    null, null, null, null
  ) result;

  if open_gate_classification <> 'address_conflict' or open_gate_automatic then
    raise exception 'Regresni kontrola OPEN GATE neprosla.';
  end if;

  select result.classification, result.automatic_confirmation_allowed
  into valid_exact_classification, valid_exact_automatic
  from public.evaluate_complete_power_outage_address_match_v4(
    'Praha', null, 'Na Prikope', '12', null, '110 00', null,
    null, null,
    'Na Prikope 12, 110 00 Praha',
    null, null, null, null
  ) result;

  if valid_exact_classification <> 'exact_address' or not valid_exact_automatic then
    raise exception 'Regresni kontrola platne presne adresy neprosla.';
  end if;
end
$$;

alter table public.complete_power_outage_address_match_v4_evaluations
  enable row level security;
alter table public.complete_power_outage_address_match_v4_runs
  enable row level security;

revoke all on table public.complete_power_outage_address_match_v4_evaluations
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_match_v4_runs
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.complete_power_outage_address_match_v4_evaluations
  to service_role;
grant select, insert
  on table public.complete_power_outage_address_match_v4_runs
  to service_role;

revoke all on function public.normalize_complete_power_outage_address_match_text_v4(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_postal_code_v4(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_building_number_v4(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_address_contains_token_v4(text,text)
  from public, anon, authenticated;
revoke all on function public.evaluate_complete_power_outage_address_match_v4(
  text,text,text,text,text,text,bigint,double precision,double precision,
  text,bigint,double precision,double precision,integer
) from public, anon, authenticated;
revoke all on function public.prevent_complete_power_outage_address_match_v4_run_mutation()
  from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_address_match_v4_shadow_v1(integer)
  from public, anon, authenticated;

grant execute on function public.normalize_complete_power_outage_address_match_text_v4(text)
  to service_role;
grant execute on function public.complete_power_outage_postal_code_v4(text)
  to service_role;
grant execute on function public.complete_power_outage_building_number_v4(text)
  to service_role;
grant execute on function public.complete_power_outage_address_contains_token_v4(text,text)
  to service_role;
grant execute on function public.evaluate_complete_power_outage_address_match_v4(
  text,text,text,text,text,text,bigint,double precision,double precision,
  text,bigint,double precision,double precision,integer
) to service_role;
grant execute on function public.refresh_complete_power_outage_address_match_v4_shadow_v1(integer)
  to service_role;

commit;
