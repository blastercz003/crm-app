begin;

create extension if not exists "pgcrypto";

create table if not exists public.job_status_automation_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_number text,
  previous_status text not null,
  next_status text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists job_status_automation_log_job_created_idx
  on public.job_status_automation_log (job_id, created_at desc);

create index if not exists job_status_automation_log_created_idx
  on public.job_status_automation_log (created_at desc);

alter table public.job_status_automation_log enable row level security;

drop policy if exists "Admins can read automatic job status log"
  on public.job_status_automation_log;
create policy "Admins can read automatic job status log"
  on public.job_status_automation_log
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "No client inserts automatic job status log"
  on public.job_status_automation_log;
create policy "No client inserts automatic job status log"
  on public.job_status_automation_log
  for insert
  with check (false);

drop policy if exists "No client updates automatic job status log"
  on public.job_status_automation_log;
create policy "No client updates automatic job status log"
  on public.job_status_automation_log
  for update
  using (false)
  with check (false);

drop policy if exists "No client deletes automatic job status log"
  on public.job_status_automation_log;
create policy "No client deletes automatic job status log"
  on public.job_status_automation_log
  for delete
  using (false);

create or replace function public.sync_job_invoice_status_from_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_invoice_number text;
  normalized_previous_invoice_number text := '';
  next_invoice_status text;
begin
  normalized_invoice_number :=
    upper(trim(coalesce(new.invoice_number, '')));

  if tg_op = 'UPDATE' then
    normalized_previous_invoice_number :=
      upper(trim(coalesce(old.invoice_number, '')));
  end if;

  if normalized_invoice_number <> ''
     and normalized_invoice_number <> 'STORNO' then
    next_invoice_status := 'vyfakturovano';
  elsif normalized_invoice_number = 'STORNO' then
    next_invoice_status := 'bez_faktury';
  elsif tg_op = 'UPDATE'
        and normalized_previous_invoice_number <> ''
        and normalized_previous_invoice_number <> 'STORNO' then
    next_invoice_status := 'k_fakturaci';
  else
    return new;
  end if;

  update public.jobs
  set
    invoice_status = next_invoice_status,
    updated_at = now()
  where id = new.job_id
    and invoice_status is distinct from next_invoice_status;

  return new;
end;
$$;

revoke all on function public.sync_job_invoice_status_from_finance()
  from public, anon, authenticated;

drop trigger if exists job_finances_sync_job_invoice_status
  on public.job_finances;
create trigger job_finances_sync_job_invoice_status
after insert or update of invoice_number on public.job_finances
for each row execute function public.sync_job_invoice_status_from_finance();

create or replace function public.close_elapsed_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer := 0;
begin
  with changed_jobs as (
    update public.jobs
    set
      job_status = 'ukoncena',
      info_alert_enabled = false,
      updated_at = now()
    where job_status = 'realizace'
      and end_at <= now()
    returning id, job_number
  ),
  logged_changes as (
    insert into public.job_status_automation_log (
      job_id,
      job_number,
      previous_status,
      next_status,
      reason
    )
    select
      changed_jobs.id,
      changed_jobs.job_number,
      'realizace',
      'ukoncena',
      'Uplynul čas konce realizace.'
    from changed_jobs
    returning 1
  )
  select count(*)::integer
  into changed_count
  from logged_changes;

  return changed_count;
end;
$$;

revoke all on function public.close_elapsed_jobs()
  from public, anon, authenticated;

-- Backfill actual invoice states. Textual marker STORNO is not an invoice.
update public.jobs as jobs
set
  invoice_status = 'vyfakturovano',
  updated_at = now()
from public.job_finances as finances
where finances.job_id = jobs.id
  and trim(coalesce(finances.invoice_number, '')) <> ''
  and upper(trim(finances.invoice_number)) <> 'STORNO'
  and jobs.invoice_status is distinct from 'vyfakturovano';

update public.jobs as jobs
set
  invoice_status = 'bez_faktury',
  updated_at = now()
from public.job_finances as finances
where finances.job_id = jobs.id
  and upper(trim(coalesce(finances.invoice_number, ''))) = 'STORNO'
  and jobs.invoice_status is distinct from 'bez_faktury';

update public.jobs as jobs
set
  invoice_status = 'k_fakturaci',
  updated_at = now()
from public.job_finances as finances
where finances.job_id = jobs.id
  and trim(coalesce(finances.invoice_number, '')) = ''
  and jobs.invoice_status = 'vyfakturovano';

-- Close all already elapsed realizations before the recurring schedule starts.
select public.close_elapsed_jobs();

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'close_elapsed_jobs_every_five_minutes';

  perform cron.schedule(
    'close_elapsed_jobs_every_five_minutes',
    '*/5 * * * *',
    $job$select public.close_elapsed_jobs();$job$
  );
end
$$;

commit;
