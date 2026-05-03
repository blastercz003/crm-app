create table if not exists public.global_search_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('query', 'click')),
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null,
  latency_ms integer,
  visible_sections text[] not null default '{}',
  result_counts jsonb not null default '{}'::jsonb,
  clicked_section text,
  clicked_item_id text,
  clicked_item_href text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists global_search_logs_created_at_idx
  on public.global_search_logs (created_at desc);

create index if not exists global_search_logs_user_idx
  on public.global_search_logs (user_id, created_at desc);

alter table public.global_search_logs enable row level security;

drop policy if exists "Admins can read global search logs" on public.global_search_logs;
create policy "Admins can read global search logs"
  on public.global_search_logs
  for select
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Authenticated users can insert own global search logs" on public.global_search_logs;
create policy "Authenticated users can insert own global search logs"
  on public.global_search_logs
  for insert
  with check (auth.uid() = user_id);

revoke all on table public.global_search_logs from public;
revoke all on table public.global_search_logs from anon;
grant insert, select on public.global_search_logs to authenticated;
