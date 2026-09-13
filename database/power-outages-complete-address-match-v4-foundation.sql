begin;

-- Oprava adresniho matcheru KOMPLETNI, etapa 1.
-- Instalace je pouze SHADOW: nemeni existujici adresy, firmy, dukazy ani
-- komunikaci, nevytvari frontu/cron a nevola ARES, RUIAN, Mapy ani jiny HTTP zdroj.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outages') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outages');
  end if;
  if to_regclass('public.complete_power_outage_addresses') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_addresses');
  end if;
  if to_regclass('public.complete_power_outage_companies') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_companies');
  end if;
  if to_regclass('public.complete_power_outage_company_evidence') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_company_evidence');
  end if;
  if to_regclass('public.complete_power_outage_company_assignments') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_company_assignments');
  end if;
  if to_regclass('public.complete_power_outage_communication_states') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_communication_states');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro SHADOW adresni matcher KOMPLETNI v4: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_address_match_state (
  singleton boolean primary key default true check (singleton),
  contract text not null default 'complete-address-match-v4',
  production_match_version integer not null default 3,
  shadow_match_version integer not null default 4,
  runtime_mode text not null default 'shadow',
  revalidation_enabled boolean not null default false,
  external_validation_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_address_match_state_contract_check check (
    contract = 'complete-address-match-v4'
  ),
  constraint cpo_address_match_state_versions_check check (
    production_match_version = 3 and shadow_match_version = 4
  ),
  constraint cpo_address_match_state_shadow_check check (
    runtime_mode = 'shadow'
    and not revalidation_enabled
    and not external_validation_enabled
  ),
  constraint cpo_address_match_state_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.complete_power_outage_address_match_state (
  singleton,
  metadata
) values (
  true,
  jsonb_build_object(
    'contract', 'complete-address-match-v4',
    'stage', 1,
    'foundationOnly', true,
    'productionMatcherUnchanged', true,
    'currentDataMutationAllowed', false,
    'externalRequestsAllowed', false,
    'installedAt', now()
  )
)
on conflict (singleton) do nothing;

-- Prazdna, oddelena projekce pro budouci davkovy prepocet. Etapa 1 do ni
-- zadne adresy nevklada; pouze uzamyka datovy kontrakt noveho matcheru.
create table if not exists public.complete_power_outage_address_match_v4_targets (
  id uuid primary key default gen_random_uuid(),
  outage_address_id uuid not null
    references public.complete_power_outage_addresses(id) on delete cascade,
  source text not null,
  municipality text not null,
  municipality_code text,
  town_part text,
  street text,
  street_is_meaningful boolean not null,
  house_number text,
  orientation_number text,
  building_number_pairs jsonb not null default '[]'::jsonb,
  postal_code text,
  ruian_address_id bigint,
  latitude double precision,
  longitude double precision,
  target_fingerprint text not null,
  projection_status text not null default 'prepared',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_address_match_v4_targets_source_check check (
    source in ('cez', 'egd', 'pre')
  ),
  constraint cpo_address_match_v4_targets_municipality_check check (
    btrim(municipality) <> ''
  ),
  constraint cpo_address_match_v4_targets_postal_check check (
    postal_code is null or postal_code ~ '^[0-9]{5}$'
  ),
  constraint cpo_address_match_v4_targets_number_pairs_check check (
    jsonb_typeof(building_number_pairs) = 'array'
  ),
  constraint cpo_address_match_v4_targets_ruian_check check (
    ruian_address_id is null or ruian_address_id > 0
  ),
  constraint cpo_address_match_v4_targets_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint cpo_address_match_v4_targets_fingerprint_check check (
    target_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_address_match_v4_targets_status_check check (
    projection_status in ('prepared', 'evaluated', 'needs_external_verification', 'complete')
  ),
  constraint cpo_address_match_v4_targets_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_address_match_v4_targets_address_unique unique (outage_address_id)
);

create index if not exists cpo_address_match_v4_targets_status_idx
  on public.complete_power_outage_address_match_v4_targets (
    projection_status,
    source,
    created_at,
    outage_address_id
  );

create table if not exists public.complete_power_outage_address_match_snapshots (
  id uuid primary key default gen_random_uuid(),
  contract text not null default 'complete-address-match-v4',
  snapshot_kind text not null,
  current_address_count bigint not null,
  current_company_count bigint not null,
  current_confirmed_company_count bigint not null,
  current_evidence_count bigint not null,
  current_ares_exact_count bigint not null,
  current_egd_ares_exact_count bigint not null,
  current_egd_postal_conflict_count bigint not null,
  protected_company_count bigint not null,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_address_match_snapshots_contract_check check (
    contract = 'complete-address-match-v4'
  ),
  constraint cpo_address_match_snapshots_kind_check check (
    snapshot_kind in ('foundation', 'pre_revalidation', 'post_revalidation')
  ),
  constraint cpo_address_match_snapshots_counts_check check (
    current_address_count >= 0
    and current_company_count >= 0
    and current_confirmed_company_count >= 0
    and current_evidence_count >= 0
    and current_ares_exact_count >= 0
    and current_egd_ares_exact_count >= 0
    and current_egd_postal_conflict_count >= 0
    and protected_company_count >= 0
  ),
  constraint cpo_address_match_snapshots_metrics_check check (
    jsonb_typeof(metrics) = 'object'
  ),
  constraint cpo_address_match_snapshots_contract_kind_unique unique (
    contract,
    snapshot_kind
  )
);

create or replace function public.prevent_complete_power_outage_address_match_snapshot_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie auditu adresniho matcheru KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_address_match_snapshots_immutable
  on public.complete_power_outage_address_match_snapshots;
create trigger cpo_address_match_snapshots_immutable
before update or delete
on public.complete_power_outage_address_match_snapshots
for each row execute function public.prevent_complete_power_outage_address_match_snapshot_mutation();

create or replace function public.capture_complete_power_outage_address_match_snapshot_v1(
  requested_snapshot_kind text default 'foundation'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_snapshot_kind text := lower(btrim(coalesce(requested_snapshot_kind, '')));
  existing_snapshot_id uuid;
  snapshot_id uuid := gen_random_uuid();
  v_current_address_count bigint;
  v_current_company_count bigint;
  v_current_confirmed_company_count bigint;
  v_current_evidence_count bigint;
  v_current_ares_exact_count bigint;
  v_current_egd_ares_exact_count bigint;
  v_current_egd_postal_conflict_count bigint;
  v_protected_company_count bigint;
begin
  if safe_snapshot_kind not in ('foundation', 'pre_revalidation', 'post_revalidation') then
    raise exception 'Neplatny druh snapshotu adresniho matcheru.' using errcode = '22023';
  end if;

  select snapshot.id
  into existing_snapshot_id
  from public.complete_power_outage_address_match_snapshots snapshot
  where snapshot.contract = 'complete-address-match-v4'
    and snapshot.snapshot_kind = safe_snapshot_kind;

  if existing_snapshot_id is not null then
    return existing_snapshot_id;
  end if;

  with current_addresses as (
    select address.id
    from public.complete_power_outage_addresses address
    join public.complete_power_outages outage on outage.id = address.outage_id
    where outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
  )
  select count(*) into v_current_address_count from current_addresses;

  with current_companies as (
    select company.id, company.candidate_status
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    where outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
  )
  select
    count(*),
    count(*) filter (where candidate_status = 'confirmed')
  into v_current_company_count, v_current_confirmed_company_count
  from current_companies;

  with current_evidence as (
    select
      evidence.id,
      evidence.provider,
      evidence.match_level,
      outage.source
    from public.complete_power_outage_company_evidence evidence
    join public.complete_power_outage_companies company on company.id = evidence.company_id
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    where outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
  )
  select
    count(*),
    count(*) filter (where provider = 'ares' and match_level = 'exact_address'),
    count(*) filter (
      where source = 'egd' and provider = 'ares' and match_level = 'exact_address'
    )
  into v_current_evidence_count, v_current_ares_exact_count, v_current_egd_ares_exact_count
  from current_evidence;

  select count(distinct company.id)
  into v_current_egd_postal_conflict_count
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  join public.complete_power_outage_company_evidence evidence
    on evidence.company_id = company.id
   and evidence.provider = 'ares'
   and evidence.match_level = 'exact_address'
  cross join lateral (
    select regexp_replace(coalesce(address.postal_code, ''), '[^0-9]', '', 'g') as value
  ) target_postal
  cross join lateral (
    select regexp_replace(
      coalesce(substring(evidence.display_address from '[0-9]{3}[[:space:]]?[0-9]{2}'), ''),
      '[^0-9]',
      '',
      'g'
    ) as value
  ) candidate_postal
  where outage.source = 'egd'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
    and length(target_postal.value) = 5
    and length(candidate_postal.value) = 5
    and target_postal.value <> candidate_postal.value;

  select count(distinct company.id)
  into v_protected_company_count
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
    and (
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
    );

  insert into public.complete_power_outage_address_match_snapshots (
    id,
    snapshot_kind,
    current_address_count,
    current_company_count,
    current_confirmed_company_count,
    current_evidence_count,
    current_ares_exact_count,
    current_egd_ares_exact_count,
    current_egd_postal_conflict_count,
    protected_company_count,
    metrics
  ) values (
    snapshot_id,
    safe_snapshot_kind,
    v_current_address_count,
    v_current_company_count,
    v_current_confirmed_company_count,
    v_current_evidence_count,
    v_current_ares_exact_count,
    v_current_egd_ares_exact_count,
    v_current_egd_postal_conflict_count,
    v_protected_company_count,
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'productionMatcherVersion', 3,
      'shadowMatcherVersion', 4,
      'scope', 'current_and_future_complete_outages',
      'automaticConfirmationRequiresStrongLocalityIdentity', true,
      'postalConflictForcesRevalidation', true,
      'ambiguousStreetEqualsMunicipalityIsIgnored', true,
      'protectedCommunicationWillBePreserved', true,
      'currentDataMutated', false,
      'externalRequestMade', false,
      'capturedAt', now()
    )
  );

  return snapshot_id;
end;
$$;

alter table public.complete_power_outage_address_match_state enable row level security;
alter table public.complete_power_outage_address_match_v4_targets enable row level security;
alter table public.complete_power_outage_address_match_snapshots enable row level security;

revoke all on table public.complete_power_outage_address_match_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_match_v4_targets
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_match_snapshots
  from public, anon, authenticated;
grant select, insert, update, delete on table public.complete_power_outage_address_match_state
  to service_role;
grant select, insert, update, delete on table public.complete_power_outage_address_match_v4_targets
  to service_role;
grant select, insert on table public.complete_power_outage_address_match_snapshots
  to service_role;

revoke all on function public.prevent_complete_power_outage_address_match_snapshot_mutation()
  from public, anon, authenticated;
revoke all on function public.capture_complete_power_outage_address_match_snapshot_v1(text)
  from public, anon, authenticated;
grant execute on function public.capture_complete_power_outage_address_match_snapshot_v1(text)
  to service_role;

select public.capture_complete_power_outage_address_match_snapshot_v1('foundation');

commit;
