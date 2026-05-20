create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence
  add column if not exists last_route text,
  add column if not exists last_section text,
  add column if not exists last_action text,
  add column if not exists last_action_at timestamptz;

alter table public.user_presence enable row level security;

drop policy if exists "Users can insert own presence" on public.user_presence;
create policy "Users can insert own presence"
  on public.user_presence
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own presence" on public.user_presence;
create policy "Users can update own presence"
  on public.user_presence
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read all presence" on public.user_presence;
create policy "Admins can read all presence"
  on public.user_presence
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

create table if not exists public.user_activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  route text,
  section text,
  action text,
  created_at timestamptz not null default now()
);

create index if not exists user_activity_log_user_id_created_at_idx
  on public.user_activity_log (user_id, created_at desc);

create index if not exists user_activity_log_created_at_idx
  on public.user_activity_log (created_at desc);

alter table public.user_activity_log enable row level security;

drop policy if exists "Users can insert own activity log" on public.user_activity_log;
create policy "Users can insert own activity log"
  on public.user_activity_log
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Admins can read all activity logs" on public.user_activity_log;
create policy "Admins can read all activity logs"
  on public.user_activity_log
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "No client update activity log" on public.user_activity_log;
create policy "No client update activity log"
  on public.user_activity_log
  for update
  using (false)
  with check (false);

drop policy if exists "No client delete activity log" on public.user_activity_log;
create policy "No client delete activity log"
  on public.user_activity_log
  for delete
  using (false);

create or replace function public.cleanup_user_activity_log()
returns void
language plpgsql
security definer
as $$
begin
  delete from public.user_activity_log
  where created_at < now() - interval '30 days';
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    null;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup_user_activity_log_daily';

    perform cron.schedule(
      'cleanup_user_activity_log_daily',
      '15 3 * * *',
      $job$select public.cleanup_user_activity_log();$job$
    );
  end if;
end
$$;
