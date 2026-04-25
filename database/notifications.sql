create extension if not exists "pgcrypto";

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  category text not null check (category in ('tasks', 'meetings', 'offers', 'system')),
  type text not null,
  title text not null,
  message text,
  entity_type text,
  entity_id uuid,
  href text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  dedupe_key text,
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notifications_dedupe_key_unique
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, read_at, archived_at, created_at desc);

create index if not exists notifications_category_idx
  on public.notifications (category, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "Users can read their notifications" on public.notifications;
create policy "Users can read their notifications"
  on public.notifications
  for select
  using (
    auth.uid() = recipient_user_id
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications"
  on public.notifications
  for update
  using (
    auth.uid() = recipient_user_id
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    auth.uid() = recipient_user_id
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Authenticated users can create notifications" on public.notifications;
create policy "Authenticated users can create notifications"
  on public.notifications
  for insert
  with check (auth.uid() is not null);

drop policy if exists "Admins can delete notifications" on public.notifications;
create policy "Admins can delete notifications"
  on public.notifications
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
