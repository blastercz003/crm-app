begin;

-- Krok 1: pouze vypnuty datovy zaklad dohledavani verejnych kontaktu.
-- Migrace nevytvari frontu, worker, CRON, HTTP pozadavek ani odesilani e-mailu.
do $$
begin
  if to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_company_contacts') is null
     or to_regclass('public.complete_power_outage_top_selection_versions') is null
     or to_regprocedure('public.current_user_can_view_power_outages()') is null
     or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybi zavislosti pro zaklad dohledavani kontaktu v KOMPLETNI.';
  end if;
end
$$;

-- Vybery jsou datovy registr, nikoli pevny enum. Budouci filtr tak lze pridat
-- novym zaznamem a adapterem bez prepisovani historie kontaktu.
create table if not exists public.complete_power_outage_contact_discovery_selectors (
  selector_key text primary key,
  display_name text not null,
  commercial_filter text not null,
  selection_version_key text
    references public.complete_power_outage_top_selection_versions(version_key) on delete restrict,
  lifecycle_status text not null default 'active',
  selector_contract jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_selectors_key_check check (
    selector_key ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
  constraint cpo_contact_selectors_name_check check (btrim(display_name) <> ''),
  constraint cpo_contact_selectors_filter_check check (btrim(commercial_filter) <> ''),
  constraint cpo_contact_selectors_status_check check (
    lifecycle_status in ('draft', 'active', 'archived')
  ),
  constraint cpo_contact_selectors_contract_check check (
    jsonb_typeof(selector_contract) = 'object'
  ),
  constraint cpo_contact_selectors_top_version_check check (
    commercial_filter <> 'top' or selection_version_key is not null
  )
);

insert into public.complete_power_outage_contact_discovery_selectors (
  selector_key,
  display_name,
  commercial_filter,
  selection_version_key,
  lifecycle_status,
  selector_contract
)
values
  (
    'top_v1',
    'TOP VÝBĚR',
    'top',
    'top-v1-2026-09-11',
    'active',
    jsonb_build_object(
      'contract', 'complete-contact-selector-v1',
      'candidateStatus', 'confirmed',
      'source', 'published-top-selection',
      'versionKey', 'top-v1-2026-09-11'
    )
  ),
  (
    'grade_a',
    'POUZE A',
    'grade_a',
    null,
    'active',
    jsonb_build_object(
      'contract', 'complete-contact-selector-v1',
      'candidateStatus', 'confirmed',
      'source', 'commercial-score',
      'grade', 'A'
    )
  ),
  (
    'grade_b',
    'POUZE B',
    'grade_b',
    null,
    'active',
    jsonb_build_object(
      'contract', 'complete-contact-selector-v1',
      'candidateStatus', 'confirmed',
      'source', 'commercial-score',
      'grade', 'B'
    )
  ),
  (
    'all_confirmed',
    'VŠECHNY POTVRZENÉ',
    'all',
    null,
    'active',
    jsonb_build_object(
      'contract', 'complete-contact-selector-v1',
      'candidateStatus', 'confirmed',
      'source', 'complete-candidates'
    )
  )
on conflict (selector_key) do nothing;

create table if not exists public.complete_power_outage_contact_discovery_state (
  singleton boolean primary key default true check (singleton),
  selected_selector_key text not null default 'top_v1'
    references public.complete_power_outage_contact_discovery_selectors(selector_key) on delete restrict,
  discovery_enabled boolean not null default false,
  website_lookup_enabled boolean not null default false,
  contact_extraction_enabled boolean not null default false,
  ui_enabled boolean not null default false,
  email_planning_enabled boolean not null default false,
  email_dispatch_enabled boolean not null default false,
  foundation_version integer not null default 1 check (foundation_version > 0),
  last_activity_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_discovery_state_activation_check check (
    (not website_lookup_enabled or discovery_enabled)
    and (not contact_extraction_enabled or website_lookup_enabled)
    and (not ui_enabled or discovery_enabled)
    and (not email_planning_enabled or contact_extraction_enabled)
    and (not email_dispatch_enabled or email_planning_enabled)
  ),
  constraint cpo_contact_discovery_state_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.complete_power_outage_contact_discovery_state (
  singleton,
  selected_selector_key,
  discovery_enabled,
  website_lookup_enabled,
  contact_extraction_enabled,
  ui_enabled,
  email_planning_enabled,
  email_dispatch_enabled,
  foundation_version,
  metadata
)
values (
  true,
  'top_v1',
  false,
  false,
  false,
  false,
  false,
  false,
  1,
  jsonb_build_object(
    'contract', 'complete-contact-discovery-foundation-v1',
    'sourcePolicy', 'verified-official-websites-only',
    'externalRequests', false,
    'emailSending', false
  )
)
on conflict (singleton) do nothing;

-- Ověreny web je samostatny dukaz. Kontakt nesmi byt oznacen jako pochazejici
-- z oficialniho webu bez vazby na tento zaznam.
create table if not exists public.complete_power_outage_company_websites (
  id uuid primary key default gen_random_uuid(),
  company_profile_id uuid not null
    references public.complete_power_outage_company_profiles(id) on delete cascade,
  website_url text not null,
  normalized_url text not null,
  normalized_domain text not null,
  website_scope text not null default 'company',
  discovery_source text not null,
  source_reference text,
  source_url text,
  verification_status text not null default 'pending',
  verification_methods text[] not null default '{}'::text[],
  confidence numeric(5,4) not null default 0,
  fetched_at timestamptz not null,
  last_verified_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_company_websites_url_check check (
    website_url ~* '^https?://' and normalized_url ~* '^https?://'
  ),
  constraint cpo_company_websites_domain_check check (
    normalized_domain = lower(btrim(normalized_domain))
    and normalized_domain !~ '[\\/[:space:]]'
    and position('.' in normalized_domain) > 1
  ),
  constraint cpo_company_websites_scope_check check (
    website_scope in ('company', 'establishment')
  ),
  constraint cpo_company_websites_source_check check (
    discovery_source in ('search_api', 'official_registry', 'manual')
  ),
  constraint cpo_company_websites_status_check check (
    verification_status in ('pending', 'verified', 'needs_review', 'rejected', 'expired')
  ),
  constraint cpo_company_websites_confidence_check check (
    confidence >= 0 and confidence <= 1
  ),
  constraint cpo_company_websites_dates_check check (
    (last_verified_at is null or last_verified_at >= fetched_at)
    and (expires_at is null or expires_at > fetched_at)
  ),
  constraint cpo_company_websites_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_company_websites_profile_domain_unique
    unique (company_profile_id, normalized_domain)
);

create index if not exists cpo_company_websites_verification_idx
  on public.complete_power_outage_company_websites (
    verification_status,
    last_verified_at,
    company_profile_id
  );

alter table public.complete_power_outage_company_contacts
  add column if not exists company_website_id uuid
    references public.complete_power_outage_company_websites(id) on delete set null,
  add column if not exists contact_scope text not null default 'unknown',
  add column if not exists contact_role text not null default 'unknown',
  add column if not exists is_personal boolean not null default false,
  add column if not exists discovery_confidence numeric(5,4) not null default 0;

alter table public.complete_power_outage_company_contacts
  drop constraint if exists cpo_company_contacts_source_check,
  add constraint cpo_company_contacts_source_check check (
    source_registry in (
      'ares_res',
      'ares_ros',
      'ares_nrpzs',
      'ares_other_public',
      'official_website',
      'official_branch_website'
    )
  ),
  drop constraint if exists cpo_company_contacts_scope_check,
  add constraint cpo_company_contacts_scope_check check (
    contact_scope in ('company', 'establishment', 'person', 'unknown')
  ),
  drop constraint if exists cpo_company_contacts_role_check,
  add constraint cpo_company_contacts_role_check check (
    contact_role in ('general', 'operations', 'branch', 'customer_service', 'personal', 'unknown')
  ),
  drop constraint if exists cpo_company_contacts_confidence_check,
  add constraint cpo_company_contacts_confidence_check check (
    discovery_confidence >= 0 and discovery_confidence <= 1
  ),
  drop constraint if exists cpo_company_contacts_website_evidence_check,
  add constraint cpo_company_contacts_website_evidence_check check (
    source_registry not in ('official_website', 'official_branch_website')
    or company_website_id is not null
  );

create index if not exists cpo_company_contacts_website_idx
  on public.complete_power_outage_company_contacts (company_website_id, contact_type)
  where company_website_id is not null;

create index if not exists cpo_company_contacts_automation_review_idx
  on public.complete_power_outage_company_contacts (
    outreach_permission_status,
    source_validity_status,
    is_personal,
    contact_type
  );

drop trigger if exists cpo_contact_discovery_selectors_set_updated_at
  on public.complete_power_outage_contact_discovery_selectors;
create trigger cpo_contact_discovery_selectors_set_updated_at
before update on public.complete_power_outage_contact_discovery_selectors
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_contact_discovery_state_set_updated_at
  on public.complete_power_outage_contact_discovery_state;
create trigger cpo_contact_discovery_state_set_updated_at
before update on public.complete_power_outage_contact_discovery_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_company_websites_set_updated_at
  on public.complete_power_outage_company_websites;
create trigger cpo_company_websites_set_updated_at
before update on public.complete_power_outage_company_websites
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_discovery_selectors enable row level security;
alter table public.complete_power_outage_contact_discovery_state enable row level security;
alter table public.complete_power_outage_company_websites enable row level security;

drop policy if exists cpo_contact_discovery_selectors_authorized_read
  on public.complete_power_outage_contact_discovery_selectors;
create policy cpo_contact_discovery_selectors_authorized_read
  on public.complete_power_outage_contact_discovery_selectors
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_contact_discovery_state_authorized_read
  on public.complete_power_outage_contact_discovery_state;
create policy cpo_contact_discovery_state_authorized_read
  on public.complete_power_outage_contact_discovery_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_company_websites_authorized_read
  on public.complete_power_outage_company_websites;
create policy cpo_company_websites_authorized_read
  on public.complete_power_outage_company_websites
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_contact_discovery_selectors
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_contact_discovery_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_websites
  from public, anon, authenticated;

grant select on table public.complete_power_outage_contact_discovery_selectors to authenticated;
grant select on table public.complete_power_outage_contact_discovery_state to authenticated;
grant select on table public.complete_power_outage_company_websites to authenticated;
grant all on table public.complete_power_outage_contact_discovery_selectors to service_role;
grant all on table public.complete_power_outage_contact_discovery_state to service_role;
grant all on table public.complete_power_outage_company_websites to service_role;

-- Stavajici tabulka kontaktu zustava pro klienta pouze pro cteni.
revoke insert, update, delete on table public.complete_power_outage_company_contacts
  from authenticated;

notify pgrst, 'reload schema';

commit;
