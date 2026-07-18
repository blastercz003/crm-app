create extension if not exists "pgcrypto";

create table if not exists public.dispatcher_job_calendar_feeds (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  enabled boolean not null default true,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dispatcher_job_calendar_items (
  job_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  uid text not null,
  sequence integer not null default 1,
  is_cancelled boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists dispatcher_job_calendar_items_user_id_idx
  on public.dispatcher_job_calendar_items (user_id, is_cancelled, updated_at desc);

create table if not exists public.dispatcher_job_google_calendar_integrations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  google_sub text,
  google_email text,
  refresh_token text not null,
  calendar_id text,
  calendar_name text not null default 'B-ENERGY VSECHNY ZAKAZKY',
  enabled boolean not null default true,
  disabled_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists dispatcher_job_google_calendar_integrations_google_sub_idx
  on public.dispatcher_job_google_calendar_integrations (google_sub)
  where google_sub is not null;

create unique index if not exists dispatcher_job_google_calendar_integrations_calendar_id_idx
  on public.dispatcher_job_google_calendar_integrations (calendar_id)
  where calendar_id is not null;

create table if not exists public.dispatcher_job_google_calendar_items (
  job_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  sequence integer not null default 1,
  is_cancelled boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

create index if not exists dispatcher_job_google_calendar_items_user_id_idx
  on public.dispatcher_job_google_calendar_items (user_id, is_cancelled, updated_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dispatcher_job_calendar_feeds_touch_updated_at
  on public.dispatcher_job_calendar_feeds;
create trigger dispatcher_job_calendar_feeds_touch_updated_at
before update on public.dispatcher_job_calendar_feeds
for each row execute function public.touch_updated_at();

drop trigger if exists dispatcher_job_calendar_items_touch_updated_at
  on public.dispatcher_job_calendar_items;
create trigger dispatcher_job_calendar_items_touch_updated_at
before update on public.dispatcher_job_calendar_items
for each row execute function public.touch_updated_at();

drop trigger if exists dispatcher_job_google_calendar_integrations_touch_updated_at
  on public.dispatcher_job_google_calendar_integrations;
create trigger dispatcher_job_google_calendar_integrations_touch_updated_at
before update on public.dispatcher_job_google_calendar_integrations
for each row execute function public.touch_updated_at();

drop trigger if exists dispatcher_job_google_calendar_items_touch_updated_at
  on public.dispatcher_job_google_calendar_items;
create trigger dispatcher_job_google_calendar_items_touch_updated_at
before update on public.dispatcher_job_google_calendar_items
for each row execute function public.touch_updated_at();

alter table public.dispatcher_job_calendar_feeds enable row level security;
alter table public.dispatcher_job_calendar_items enable row level security;
alter table public.dispatcher_job_google_calendar_integrations enable row level security;
alter table public.dispatcher_job_google_calendar_items enable row level security;

drop policy if exists "Users can read their own dispatcher calendar feed"
  on public.dispatcher_job_calendar_feeds;
create policy "Users can read their own dispatcher calendar feed"
on public.dispatcher_job_calendar_feeds
for select
using (user_id = auth.uid());

drop policy if exists "Users can read their own dispatcher calendar items"
  on public.dispatcher_job_calendar_items;
create policy "Users can read their own dispatcher calendar items"
on public.dispatcher_job_calendar_items
for select
using (user_id = auth.uid());

drop policy if exists "Users can read their own dispatcher Google calendar integration"
  on public.dispatcher_job_google_calendar_integrations;
create policy "Users can read their own dispatcher Google calendar integration"
on public.dispatcher_job_google_calendar_integrations
for select
using (user_id = auth.uid());

drop policy if exists "Users can read their own dispatcher Google calendar items"
  on public.dispatcher_job_google_calendar_items;
create policy "Users can read their own dispatcher Google calendar items"
on public.dispatcher_job_google_calendar_items
for select
using (user_id = auth.uid());
