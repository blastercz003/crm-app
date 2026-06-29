create table if not exists public.job_pp_requirements (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  pp_required boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint job_pp_requirements_only_false check (pp_required = false)
);

create index if not exists job_pp_requirements_updated_at_idx
  on public.job_pp_requirements (updated_at desc);

alter table public.job_pp_requirements enable row level security;

drop policy if exists "Authenticated users can read job pp requirements" on public.job_pp_requirements;
create policy "Authenticated users can read job pp requirements"
  on public.job_pp_requirements
  for select
  using (
    auth.uid() is not null
  );

drop policy if exists "Admins can insert job pp requirements" on public.job_pp_requirements;
create policy "Admins can insert job pp requirements"
  on public.job_pp_requirements
  for insert
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update job pp requirements" on public.job_pp_requirements;
create policy "Admins can update job pp requirements"
  on public.job_pp_requirements
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

drop policy if exists "Admins can delete job pp requirements" on public.job_pp_requirements;
create policy "Admins can delete job pp requirements"
  on public.job_pp_requirements
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
