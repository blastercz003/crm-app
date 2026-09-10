begin;

-- Stinovy zaklad pro prisnejsi TOP VYBER. Tento krok zamerne nemeni
-- existujici skore, znamky A/B/C ani soucasny filtr TOP KANDIDATI v UI.
do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_company_scores') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regprocedure('public.current_user_can_view_power_outages()') is null
     or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybi zavislosti pro stinovy TOP VYBER.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_top_selection_state (
  singleton boolean primary key default true check (singleton),
  shadow_enabled boolean not null default false,
  ui_enabled boolean not null default false,
  rules_version integer not null default 1 check (rules_version > 0),
  candidate_grade text not null default 'A' check (candidate_grade = 'A'),
  last_evaluation_at timestamptz,
  last_processed_count integer not null default 0 check (last_processed_count >= 0),
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.complete_power_outage_top_selection_state (
  singleton,
  shadow_enabled,
  ui_enabled,
  rules_version,
  candidate_grade,
  metadata
)
values (
  true,
  false,
  false,
  1,
  'A',
  jsonb_build_object(
    'contract', 'complete-top-selection-shadow-v1-draft',
    'candidateUniverse', 'current-visible-grade-a',
    'industryEvidence', 'primary-nace-only',
    'minimumOutageHours', 3,
    'requiredGates', jsonb_build_array(
      'operationally_relevant_primary_nace',
      'active_company',
      'not_natural_person_registered_office_only',
      'not_noncommercial_association_firefighter_or_hunting_entity',
      'not_true_mass_or_virtual_office',
      'minimum_three_hour_outage'
    ),
    'excludedInputs', jsonb_build_array(
      'repeat_outages',
      'distance',
      'transport_economics',
      'contact_history',
      'client_relationship',
      'company_age',
      'last_change',
      'institutional_sector',
      'employee_count',
      'enrichment_completeness'
    )
  )
)
on conflict (singleton) do nothing;

-- Vysledek je oddeleny od bezneho score. Dokud nebude aktivovan stinovy
-- evaluator, tabulka zustane prazdna a zadny existujici vystup se nezmeni.
create table if not exists public.complete_power_outage_company_top_selections (
  candidate_id uuid primary key
    references public.complete_power_outage_companies(id) on delete cascade,
  evaluation_status text not null default 'pending',
  top_eligible boolean not null default false,
  rules_version integer not null default 0,
  primary_nace_code text,
  reason_codes text[] not null default '{}'::text[],
  exclusion_codes text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  calculation_input_hash text,
  evaluated_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_top_selection_status_check check (
    evaluation_status in ('pending', 'eligible', 'excluded', 'needs_review', 'error')
  ),
  constraint cpo_top_selection_eligibility_check check (
    top_eligible = (evaluation_status = 'eligible')
  ),
  constraint cpo_top_selection_version_check check (rules_version >= 0),
  constraint cpo_top_selection_primary_nace_check check (
    primary_nace_code is null or primary_nace_code ~ '^[0-9]{2,6}$'
  ),
  constraint cpo_top_selection_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint cpo_top_selection_hash_check check (
    calculation_input_hash is null or calculation_input_hash ~ '^[a-f0-9]{64}$'
  )
);

create index if not exists cpo_company_top_selections_filter_idx
  on public.complete_power_outage_company_top_selections (
    top_eligible,
    evaluation_status,
    candidate_id
  );

create index if not exists cpo_company_top_selections_audit_idx
  on public.complete_power_outage_company_top_selections (
    rules_version,
    primary_nace_code,
    evaluated_at desc
  );

drop trigger if exists cpo_top_selection_state_set_updated_at
  on public.complete_power_outage_top_selection_state;
create trigger cpo_top_selection_state_set_updated_at
before update on public.complete_power_outage_top_selection_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_top_selections_set_updated_at
  on public.complete_power_outage_company_top_selections;
create trigger cpo_company_top_selections_set_updated_at
before update on public.complete_power_outage_company_top_selections
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_top_selection_state enable row level security;
alter table public.complete_power_outage_company_top_selections enable row level security;

drop policy if exists cpo_top_selection_state_authorized_read
  on public.complete_power_outage_top_selection_state;
create policy cpo_top_selection_state_authorized_read
  on public.complete_power_outage_top_selection_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_top_selections_authorized_read
  on public.complete_power_outage_company_top_selections;
create policy cpo_company_top_selections_authorized_read
  on public.complete_power_outage_company_top_selections
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_top_selection_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_top_selections
  from public, anon, authenticated;

grant select on table public.complete_power_outage_top_selection_state to authenticated;
grant select on table public.complete_power_outage_company_top_selections to authenticated;
grant all on table public.complete_power_outage_top_selection_state to service_role;
grant all on table public.complete_power_outage_company_top_selections to service_role;

notify pgrst, 'reload schema';

commit;
