create extension if not exists "pgcrypto";

create table if not exists public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  file_name text not null,
  display_name text not null,
  storage_bucket text not null default 'job-attachments',
  storage_path text not null unique,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes >= 0 and file_size_bytes <= 5242880),
  category text not null default 'jine' check (category in ('predavaci_protokol', 'foto', 'jine')),
  note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_attachments_job_id_created_at_idx
  on public.job_attachments (job_id, created_at desc);

create index if not exists job_attachments_uploaded_by_created_at_idx
  on public.job_attachments (uploaded_by, created_at desc);

create index if not exists job_attachments_category_idx
  on public.job_attachments (category, created_at desc);

alter table public.job_attachments enable row level security;

drop policy if exists "Admins can read job attachments" on public.job_attachments;
create policy "Admins can read job attachments"
  on public.job_attachments
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can create job attachments" on public.job_attachments;
create policy "Admins can create job attachments"
  on public.job_attachments
  for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update job attachments" on public.job_attachments;
create policy "Admins can update job attachments"
  on public.job_attachments
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can delete job attachments" on public.job_attachments;
create policy "Admins can delete job attachments"
  on public.job_attachments
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
