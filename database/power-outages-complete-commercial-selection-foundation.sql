begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null then
    raise exception 'Nejdříve musí být nasazena tabulka public.complete_power_outage_companies.';
  end if;
  if to_regprocedure('public.current_user_can_view_power_outages()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.current_user_can_view_power_outages().';
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.set_power_outage_updated_at().';
  end if;
end
$$;

-- Globální pojistka nové vrstvy. Samotná migrace nesmí spustit enrichment,
-- skórování ani změnit výpis současné tabulky KOMPLETNÍ.
create table if not exists public.complete_power_outage_commercial_selection_state (
  singleton boolean primary key default true check (singleton),
  res_enrichment_enabled boolean not null default false,
  scoring_enabled boolean not null default false,
  ui_enabled boolean not null default false,
  scoring_version integer not null default 0 check (scoring_version >= 0),
  last_enrichment_activity_at timestamptz,
  last_scoring_activity_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_commercial_selection_activation_check check (
    not ui_enabled or scoring_enabled
  )
);

insert into public.complete_power_outage_commercial_selection_state (
  singleton,
  res_enrichment_enabled,
  scoring_enabled,
  ui_enabled,
  scoring_version
)
values (true, false, false, false, 0)
on conflict (singleton) do nothing;

-- Jeden sdílený profil pro jedno unikátní IČO. Neobsahuje vazbu na MARKETY
-- a jeho existence nemění kandidáta ani jeho současný stav.
create table if not exists public.complete_power_outage_company_profiles (
  id uuid primary key default gen_random_uuid(),
  ico text not null unique,
  official_name text not null,
  legal_form text,
  primary_nace_code text,
  nace_codes text[] not null default '{}'::text[],
  subject_status text,
  is_in_liquidation boolean not null default false,
  is_terminated boolean not null default false,
  source_registries text[] not null default '{}'::text[],
  fetched_at timestamptz not null,
  expires_at timestamptz,
  payload_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_company_profiles_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_company_profiles_name_check check (btrim(official_name) <> ''),
  constraint cpo_company_profiles_primary_nace_check check (
    primary_nace_code is null or primary_nace_code ~ '^[0-9]{2,6}$'
  ),
  constraint cpo_company_profiles_nace_check check (
    cardinality(nace_codes) = 0
    or (
      array_position(nace_codes, null) is null
      and array_to_string(nace_codes, ',') ~ '^[0-9]{2,6}(,[0-9]{2,6})*$'
    )
  ),
  constraint cpo_company_profiles_expiry_check check (
    expires_at is null or expires_at > fetched_at
  ),
  constraint cpo_company_profiles_hash_check check (
    payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_company_profiles_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_company_profiles_primary_nace_idx
  on public.complete_power_outage_company_profiles (primary_nace_code, ico);
create index if not exists cpo_company_profiles_expiry_idx
  on public.complete_power_outage_company_profiles (expires_at, ico)
  where expires_at is not null;

-- Kontakty jsou pouze veřejně vrácené údaje s dohledatelným zdrojem.
-- Jejich uložení samo o sobě nepředstavuje souhlas s obchodním oslovením.
create table if not exists public.complete_power_outage_company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null
    references public.complete_power_outage_company_profiles(id) on delete cascade,
  contact_type text not null,
  contact_value text not null,
  normalized_value text not null,
  source_registry text not null,
  source_reference text,
  source_url text,
  is_public_at_source boolean not null default true,
  source_validity_status text not null default 'unknown',
  outreach_permission_status text not null default 'unknown',
  fetched_at timestamptz not null,
  last_verified_at timestamptz not null,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_company_contacts_type_check check (contact_type in ('email', 'phone')),
  constraint cpo_company_contacts_value_check check (
    btrim(contact_value) <> '' and btrim(normalized_value) <> ''
  ),
  constraint cpo_company_contacts_source_check check (
    source_registry in ('ares_res', 'ares_ros', 'ares_nrpzs', 'ares_other_public')
  ),
  constraint cpo_company_contacts_public_check check (is_public_at_source),
  constraint cpo_company_contacts_validity_check check (
    source_validity_status in ('unknown', 'valid', 'invalid', 'expired')
  ),
  constraint cpo_company_contacts_permission_check check (
    outreach_permission_status in ('unknown', 'allowed', 'blocked')
  ),
  constraint cpo_company_contacts_dates_check check (
    last_verified_at >= fetched_at and (expires_at is null or expires_at > fetched_at)
  ),
  constraint cpo_company_contacts_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_company_contacts_profile_value_unique
    unique (company_profile_id, contact_type, normalized_value)
);

create index if not exists cpo_company_contacts_profile_idx
  on public.complete_power_outage_company_contacts (company_profile_id, contact_type);

-- Neaktivní podklad budoucí fronty. V tomto kroku nevzniká claim funkce,
-- endpoint ani CRON a migrace do fronty nevloží žádná IČO.
create table if not exists public.complete_power_outage_company_enrichment_queue (
  ico text primary key,
  queue_status text not null default 'pending',
  priority integer not null default 100,
  requested_sources text[] not null default array['res']::text[],
  company_profile_id uuid
    references public.complete_power_outage_company_profiles(id) on delete set null,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 6,
  next_attempt_at timestamptz,
  processing_token uuid,
  processing_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_company_enrichment_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_company_enrichment_status_check check (
    queue_status in ('pending', 'processing', 'ready', 'not_found', 'error', 'skipped')
  ),
  constraint cpo_company_enrichment_priority_check check (priority between 0 and 1000),
  constraint cpo_company_enrichment_sources_check check (
    cardinality(requested_sources) > 0
    and array_position(requested_sources, null) is null
    and requested_sources <@ array['res', 'ros', 'nrpzs']::text[]
  ),
  constraint cpo_company_enrichment_attempts_check check (
    attempt_count >= 0 and max_attempt_count between 1 and 20
      and attempt_count <= max_attempt_count
  ),
  constraint cpo_company_enrichment_processing_check check (
    queue_status <> 'processing'
    or (processing_token is not null and processing_expires_at is not null and started_at is not null)
  ),
  constraint cpo_company_enrichment_finished_check check (
    queue_status not in ('ready', 'not_found', 'skipped') or finished_at is not null
  ),
  constraint cpo_company_enrichment_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_company_enrichment_queue_idx
  on public.complete_power_outage_company_enrichment_queue (
    queue_status,
    priority desc,
    next_attempt_at,
    created_at
  )
  where queue_status in ('pending', 'error');

-- Skóre je samostatný odvozený záznam. Nemění candidate_status,
-- business_relevance_status ani žádný zdrojový záznam odstávky.
create table if not exists public.complete_power_outage_company_scores (
  candidate_id uuid primary key
    references public.complete_power_outage_companies(id) on delete cascade,
  company_profile_id uuid
    references public.complete_power_outage_company_profiles(id) on delete set null,
  score_status text not null default 'pending',
  score smallint,
  grade text,
  selection_eligible boolean not null default false,
  data_completeness text not null default 'preliminary',
  industry_points smallint not null default 0,
  outage_points smallint not null default 0,
  establishment_points smallint not null default 0,
  penalty_points smallint not null default 0,
  primary_nace_code text,
  reason_codes text[] not null default '{}'::text[],
  penalty_codes text[] not null default '{}'::text[],
  breakdown jsonb not null default '{}'::jsonb,
  scoring_version integer not null default 0,
  calculation_input_hash text,
  calculated_at timestamptz,
  next_recalculation_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_company_scores_status_check check (
    score_status in ('pending', 'preliminary', 'complete', 'stale', 'error')
  ),
  constraint cpo_company_scores_score_check check (score is null or score between 0 and 100),
  constraint cpo_company_scores_grade_check check (grade is null or grade in ('A', 'B', 'C')),
  constraint cpo_company_scores_score_grade_check check (
    (score is null and grade is null) or (score is not null and grade is not null)
  ),
  constraint cpo_company_scores_completeness_check check (
    data_completeness in ('preliminary', 'complete')
  ),
  constraint cpo_company_scores_components_check check (
    industry_points between 0 and 70
    and outage_points between 0 and 25
    and establishment_points between 0 and 5
    and penalty_points between 0 and 100
  ),
  constraint cpo_company_scores_primary_nace_check check (
    primary_nace_code is null or primary_nace_code ~ '^[0-9]{2,6}$'
  ),
  constraint cpo_company_scores_version_check check (scoring_version >= 0),
  constraint cpo_company_scores_hash_check check (
    calculation_input_hash is null or calculation_input_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_company_scores_breakdown_check check (jsonb_typeof(breakdown) = 'object')
);

create index if not exists cpo_company_scores_selection_idx
  on public.complete_power_outage_company_scores (
    selection_eligible,
    grade,
    score desc,
    candidate_id
  )
  where score_status in ('preliminary', 'complete');
create index if not exists cpo_company_scores_recalculation_idx
  on public.complete_power_outage_company_scores (score_status, next_recalculation_at, candidate_id)
  where score_status in ('pending', 'stale', 'error');

drop trigger if exists cpo_commercial_selection_state_set_updated_at
  on public.complete_power_outage_commercial_selection_state;
create trigger cpo_commercial_selection_state_set_updated_at
before update on public.complete_power_outage_commercial_selection_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_profiles_set_updated_at
  on public.complete_power_outage_company_profiles;
create trigger cpo_company_profiles_set_updated_at
before update on public.complete_power_outage_company_profiles
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_contacts_set_updated_at
  on public.complete_power_outage_company_contacts;
create trigger cpo_company_contacts_set_updated_at
before update on public.complete_power_outage_company_contacts
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_enrichment_queue_set_updated_at
  on public.complete_power_outage_company_enrichment_queue;
create trigger cpo_company_enrichment_queue_set_updated_at
before update on public.complete_power_outage_company_enrichment_queue
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_scores_set_updated_at
  on public.complete_power_outage_company_scores;
create trigger cpo_company_scores_set_updated_at
before update on public.complete_power_outage_company_scores
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_commercial_selection_state enable row level security;
alter table public.complete_power_outage_company_profiles enable row level security;
alter table public.complete_power_outage_company_contacts enable row level security;
alter table public.complete_power_outage_company_enrichment_queue enable row level security;
alter table public.complete_power_outage_company_scores enable row level security;

drop policy if exists cpo_commercial_selection_state_authorized_read
  on public.complete_power_outage_commercial_selection_state;
create policy cpo_commercial_selection_state_authorized_read
  on public.complete_power_outage_commercial_selection_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_profiles_authorized_read
  on public.complete_power_outage_company_profiles;
create policy cpo_company_profiles_authorized_read
  on public.complete_power_outage_company_profiles
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_contacts_authorized_read
  on public.complete_power_outage_company_contacts;
create policy cpo_company_contacts_authorized_read
  on public.complete_power_outage_company_contacts
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_enrichment_queue_authorized_read
  on public.complete_power_outage_company_enrichment_queue;
create policy cpo_company_enrichment_queue_authorized_read
  on public.complete_power_outage_company_enrichment_queue
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_scores_authorized_read
  on public.complete_power_outage_company_scores;
create policy cpo_company_scores_authorized_read
  on public.complete_power_outage_company_scores
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_commercial_selection_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_profiles
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_contacts
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_enrichment_queue
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_scores
  from public, anon, authenticated;

grant select on table public.complete_power_outage_commercial_selection_state to authenticated;
grant select on table public.complete_power_outage_company_profiles to authenticated;
grant select on table public.complete_power_outage_company_contacts to authenticated;
grant select on table public.complete_power_outage_company_enrichment_queue to authenticated;
grant select on table public.complete_power_outage_company_scores to authenticated;

grant all on table public.complete_power_outage_commercial_selection_state to service_role;
grant all on table public.complete_power_outage_company_profiles to service_role;
grant all on table public.complete_power_outage_company_contacts to service_role;
grant all on table public.complete_power_outage_company_enrichment_queue to service_role;
grant all on table public.complete_power_outage_company_scores to service_role;

commit;
