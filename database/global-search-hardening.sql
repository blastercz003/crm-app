-- Global search hardening
-- Safe to run multiple times.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Optional helper function for accent-insensitive normalization in future ranking.
create or replace function public.global_search_normalize(value text)
returns text
language sql
immutable
as $$
  select lower(unaccent(coalesce(value, '')))
$$;

-- Clients
create index if not exists clients_name_trgm_idx
  on public.clients using gin (name gin_trgm_ops);
create index if not exists clients_ico_trgm_idx
  on public.clients using gin (ico gin_trgm_ops);
create index if not exists clients_contact_person_trgm_idx
  on public.clients using gin (contact_person gin_trgm_ops);
create index if not exists clients_contact_email_trgm_idx
  on public.clients using gin (contact_email gin_trgm_ops);

-- Tasks
create index if not exists tasks_title_trgm_idx
  on public.tasks using gin (title gin_trgm_ops);
create index if not exists tasks_note_trgm_idx
  on public.tasks using gin (note gin_trgm_ops);
create index if not exists tasks_company_name_trgm_idx
  on public.tasks using gin (company_name gin_trgm_ops);
create index if not exists tasks_contact_person_trgm_idx
  on public.tasks using gin (contact_person gin_trgm_ops);

-- Meetings
create index if not exists meetings_company_name_trgm_idx
  on public.meetings using gin (company_name gin_trgm_ops);
create index if not exists meetings_contact_person_trgm_idx
  on public.meetings using gin (contact_person gin_trgm_ops);
create index if not exists meetings_title_trgm_idx
  on public.meetings using gin (title gin_trgm_ops);
create index if not exists meetings_search_notes_trgm_idx
  on public.meetings using gin ((coalesce(pre_meeting_note, '') || ' ' || coalesce(result_note, '') || ' ' || coalesce(follow_up_task, '')) gin_trgm_ops);

-- Offers
create index if not exists offers_title_trgm_idx
  on public.offers using gin (title gin_trgm_ops);
create index if not exists offers_offer_number_trgm_idx
  on public.offers using gin (offer_number gin_trgm_ops);

-- Jobs
create index if not exists jobs_company_name_trgm_idx
  on public.jobs using gin (company_name gin_trgm_ops);
create index if not exists jobs_job_number_trgm_idx
  on public.jobs using gin (job_number gin_trgm_ops);
create index if not exists jobs_contact_person_trgm_idx
  on public.jobs using gin (contact_person gin_trgm_ops);
create index if not exists jobs_site_address_trgm_idx
  on public.jobs using gin (site_address gin_trgm_ops);
create index if not exists jobs_store_number_trgm_idx
  on public.jobs using gin (store_number gin_trgm_ops);
create index if not exists jobs_technician_name_trgm_idx
  on public.jobs using gin (technician_name gin_trgm_ops);
create index if not exists jobs_generator_name_trgm_idx
  on public.jobs using gin (generator_name gin_trgm_ops);

alter table public.jobs
  add column if not exists company_name_search text generated always as (public.global_search_normalize(company_name)) stored,
  add column if not exists technician_name_search text generated always as (public.global_search_normalize(technician_name)) stored,
  add column if not exists site_address_search text generated always as (public.global_search_normalize(site_address)) stored,
  add column if not exists generator_name_search text generated always as (public.global_search_normalize(generator_name)) stored,
  add column if not exists contact_person_search text generated always as (public.global_search_normalize(contact_person)) stored,
  add column if not exists job_number_search text generated always as (public.global_search_normalize(job_number)) stored,
  add column if not exists store_number_search text generated always as (public.global_search_normalize(store_number)) stored;

create index if not exists jobs_company_name_search_trgm_idx
  on public.jobs using gin (company_name_search gin_trgm_ops);
create index if not exists jobs_technician_name_search_trgm_idx
  on public.jobs using gin (technician_name_search gin_trgm_ops);
create index if not exists jobs_site_address_search_trgm_idx
  on public.jobs using gin (site_address_search gin_trgm_ops);
create index if not exists jobs_generator_name_search_trgm_idx
  on public.jobs using gin (generator_name_search gin_trgm_ops);
create index if not exists jobs_contact_person_search_trgm_idx
  on public.jobs using gin (contact_person_search gin_trgm_ops);
create index if not exists jobs_job_number_search_trgm_idx
  on public.jobs using gin (job_number_search gin_trgm_ops);
create index if not exists jobs_store_number_search_trgm_idx
  on public.jobs using gin (store_number_search gin_trgm_ops);

-- Finance / notifications
create index if not exists job_finances_invoice_number_trgm_idx
  on public.job_finances using gin (invoice_number gin_trgm_ops);
create index if not exists notifications_title_trgm_idx
  on public.notifications using gin (title gin_trgm_ops);
create index if not exists notifications_message_trgm_idx
  on public.notifications using gin (message gin_trgm_ops);
