create extension if not exists "pgcrypto";

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  role text,
  note text,
  is_primary boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists client_contacts_primary_contact_unique
  on public.client_contacts (client_id)
  where is_primary = true;

create index if not exists client_contacts_client_idx
  on public.client_contacts (client_id, is_primary desc, name asc);

create index if not exists client_contacts_created_by_idx
  on public.client_contacts (created_by, created_at desc);

insert into public.client_contacts (
  client_id,
  name,
  phone,
  email,
  is_primary,
  created_by
)
select
  clients.id,
  trim(clients.contact_person),
  nullif(trim(coalesce(clients.contact_phone, '')), ''),
  nullif(trim(coalesce(clients.contact_email, '')), ''),
  true,
  clients.created_by
from public.clients
where clients.contact_person is not null
  and trim(clients.contact_person) <> ''
  and not exists (
    select 1
    from public.client_contacts
    where client_contacts.client_id = clients.id
      and client_contacts.is_primary = true
  );

alter table public.meetings
  add column if not exists client_contact_id uuid references public.client_contacts(id) on delete set null;

alter table public.tasks
  add column if not exists client_contact_id uuid references public.client_contacts(id) on delete set null;

alter table public.offers
  add column if not exists client_contact_id uuid references public.client_contacts(id) on delete set null;

alter table public.jobs
  add column if not exists client_contact_id uuid references public.client_contacts(id) on delete set null;

create index if not exists meetings_client_contact_idx
  on public.meetings (client_contact_id, meeting_datetime desc);

create index if not exists tasks_client_contact_idx
  on public.tasks (client_contact_id, created_at desc);

create index if not exists offers_client_contact_idx
  on public.offers (client_contact_id, created_at desc);

create index if not exists jobs_client_contact_idx
  on public.jobs (client_contact_id, start_at desc);

update public.meetings
set client_contact_id = client_contacts.id
from public.client_contacts
where meetings.client_contact_id is null
  and meetings.client_id = client_contacts.client_id
  and meetings.contact_person is not null
  and lower(trim(meetings.contact_person)) = lower(trim(client_contacts.name));

update public.tasks
set client_contact_id = client_contacts.id
from public.client_contacts
where tasks.client_contact_id is null
  and tasks.client_id = client_contacts.client_id
  and tasks.contact_person is not null
  and lower(trim(tasks.contact_person)) = lower(trim(client_contacts.name));

update public.offers
set client_contact_id = client_contacts.id
from public.client_contacts
where offers.client_contact_id is null
  and offers.client_id = client_contacts.client_id
  and offers.contact_person is not null
  and lower(trim(offers.contact_person)) = lower(trim(client_contacts.name));

update public.jobs
set client_contact_id = client_contacts.id
from public.client_contacts
where jobs.client_contact_id is null
  and jobs.client_id = client_contacts.client_id
  and jobs.contact_person is not null
  and lower(trim(jobs.contact_person)) = lower(trim(client_contacts.name));

alter table public.client_contacts enable row level security;

drop policy if exists "Users can read contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can read contacts for their clients and admins all contacts"
  on public.client_contacts
  for select
  using (
    exists (
      select 1
      from public.clients
      where clients.id = client_contacts.client_id
        and clients.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Users can create contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can create contacts for their clients and admins all contacts"
  on public.client_contacts
  for insert
  with check (
    created_by = auth.uid()
    and (
      exists (
        select 1
        from public.clients
        where clients.id = client_contacts.client_id
          and clients.created_by = auth.uid()
      )
      or exists (
        select 1
        from public.profiles
        where profiles.id = auth.uid()
          and profiles.role = 'admin'
      )
    )
  );

drop policy if exists "Users can update contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can update contacts for their clients and admins all contacts"
  on public.client_contacts
  for update
  using (
    exists (
      select 1
      from public.clients
      where clients.id = client_contacts.client_id
        and clients.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.clients
      where clients.id = client_contacts.client_id
        and clients.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Users can delete contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can delete contacts for their clients and admins all contacts"
  on public.client_contacts
  for delete
  using (
    exists (
      select 1
      from public.clients
      where clients.id = client_contacts.client_id
        and clients.created_by = auth.uid()
    )
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
