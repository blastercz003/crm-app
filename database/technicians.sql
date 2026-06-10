create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists can_be_assigned_as_technician boolean not null default false,
  add column if not exists can_view_tech_jobs boolean not null default false,
  add column if not exists can_view_connection_points boolean not null default false,
  add column if not exists can_view_all_technician_handover_uploads boolean not null default false;

create index if not exists profiles_technik_name_idx
  on public.profiles (role, name);

create index if not exists profiles_assignable_technician_name_idx
  on public.profiles (can_be_assigned_as_technician, name);

update public.profiles
set can_be_assigned_as_technician = true
where role = 'TECHNIK';

create table if not exists public.job_technicians (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  technician_id uuid not null references public.profiles(id) on delete cascade,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists job_technicians_job_id_technician_id_idx
  on public.job_technicians (job_id, technician_id);

create index if not exists job_technicians_job_id_position_idx
  on public.job_technicians (job_id, position asc);

create index if not exists job_technicians_technician_id_position_idx
  on public.job_technicians (technician_id, position asc);

alter table public.job_technicians enable row level security;

drop policy if exists "Admins can read job technicians or technicians can read own assignments" on public.job_technicians;
create policy "Admins can read job technicians or technicians can read own assignments"
  on public.job_technicians
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
    or technician_id = auth.uid()
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.can_view_all_technician_handover_uploads = true
    )
  );

drop policy if exists "Admins can insert job technicians" on public.job_technicians;
create policy "Admins can insert job technicians"
  on public.job_technicians
  for insert
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_view_jobs = true
        )
    )
  );

drop policy if exists "Admins can update job technicians" on public.job_technicians;
create policy "Admins can update job technicians"
  on public.job_technicians
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_view_jobs = true
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_view_jobs = true
        )
    )
  );

drop policy if exists "Admins can delete job technicians" on public.job_technicians;
create policy "Admins can delete job technicians"
  on public.job_technicians
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_view_jobs = true
        )
    )
  );

do $$
declare
  job_row record;
  token_row record;
  matched_technician_id uuid;
begin
  for job_row in
    select id, technician_name
    from public.jobs
    where technician_name is not null
      and btrim(technician_name) <> ''
  loop
    for token_row in
      select
        btrim(token) as technician_name,
        ordinality as position
      from regexp_split_to_table(job_row.technician_name, '\s*,\s*') with ordinality as split(token, ordinality)
    loop
      if token_row.technician_name = '' then
        continue;
      end if;

      matched_technician_id := null;

      select id
        into matched_technician_id
      from public.profiles
      where can_be_assigned_as_technician = true
        and name = token_row.technician_name
      limit 1;

      if matched_technician_id is not null then
        insert into public.job_technicians (job_id, technician_id, position)
        values (job_row.id, matched_technician_id, token_row.position)
        on conflict (job_id, technician_id) do nothing;
      end if;
    end loop;
  end loop;
end $$;
