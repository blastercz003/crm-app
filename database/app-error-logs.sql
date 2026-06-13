create table if not exists public.app_error_logs (
  id uuid primary key default gen_random_uuid(),
  error_code text not null,
  error_type text not null,
  message text not null,
  stack text,
  digest text,
  route text,
  section text,
  user_id uuid references public.profiles (id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists app_error_logs_error_code_idx
  on public.app_error_logs (error_code);

create index if not exists app_error_logs_created_at_idx
  on public.app_error_logs (created_at desc);

create index if not exists app_error_logs_user_id_created_at_idx
  on public.app_error_logs (user_id, created_at desc);

create index if not exists app_error_logs_route_created_at_idx
  on public.app_error_logs (route, created_at desc);

alter table public.app_error_logs enable row level security;

drop policy if exists "Admins can read all app error logs" on public.app_error_logs;
create policy "Admins can read all app error logs"
  on public.app_error_logs
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

revoke all on table public.app_error_logs from public;
revoke all on table public.app_error_logs from anon;
grant select on public.app_error_logs to authenticated;
