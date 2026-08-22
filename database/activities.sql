create extension if not exists "pgcrypto";

-- Přístup do sekce Aktivity je povolen administrátorům nebo uživatelům
-- s tímto výslovným oprávněním.
alter table public.profiles
  add column if not exists can_view_activities boolean not null default false;

comment on column public.profiles.can_view_activities is
  'Povoluje uživateli přístup do sekce Aktivity. Administrátor má přístup vždy.';

-- První povolení pro dohodnuté uživatele. Překlad odstraní českou diakritiku,
-- takže fungují varianty Lída/Lida a Jiří/Jiri.
update public.profiles
set can_view_activities = true
where translate(
  lower(btrim(coalesce(name, ''))),
  'áčďéěíňóřšťúůýž',
  'acdeeinorstuuyz'
) in ('michal', 'lida', 'jiri');

create or replace function public.current_user_can_view_activities()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or profiles.can_view_activities = true
      )
  )
$$;

revoke all on function public.current_user_can_view_activities() from public;
revoke all on function public.current_user_can_view_activities() from anon;
grant execute on function public.current_user_can_view_activities() to authenticated;

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),

  -- Uživatel, do jehož pracovní evidence aktivita patří.
  user_id uuid not null references public.profiles(id) on delete restrict,

  -- Uživatel, který záznam skutečně vytvořil. U automatických záznamů
  -- se může později lišit od user_id například při delegované práci.
  created_by uuid not null references public.profiles(id) on delete restrict,

  client_id uuid references public.clients(id) on delete set null,

  origin text not null default 'manual'
    check (origin in ('manual', 'automatic')),

  -- Otevřený textový identifikátor, např. phone_call, email, work_log,
  -- meeting_created, task_completed nebo offer_comment_added.
  activity_type text not null
    check (
      char_length(btrim(activity_type)) between 1 and 64
      and activity_type = lower(activity_type)
    ),

  title text not null
    check (char_length(btrim(title)) between 1 and 240),
  description text,

  status text not null default 'logged'
    check (status in ('logged', 'planned', 'completed', 'cancelled')),

  -- Čas uskutečněné/evidované události a volitelný termín plánované práce.
  occurred_at timestamptz not null default now(),
  scheduled_for timestamptz,
  completed_at timestamptz,

  -- Obecná vazba zachová historický log i po odstranění zdrojového záznamu.
  source_type text
    check (source_type is null or source_type in ('meeting', 'task', 'offer')),
  source_id uuid,
  source_event_key text,
  source_path text,

  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint activities_planned_requires_date_check
    check (status <> 'planned' or scheduled_for is not null),

  constraint activities_completed_requires_date_check
    check (status <> 'completed' or completed_at is not null),

  constraint activities_source_path_check
    check (source_path is null or left(source_path, 1) = '/'),

  constraint activities_origin_source_check
    check (
      (
        origin = 'manual'
        and source_type is null
        and source_id is null
        and source_event_key is null
        and source_path is null
      )
      or
      (
        origin = 'automatic'
        and status = 'logged'
        and source_type is not null
        and source_id is not null
        and source_event_key is not null
        and char_length(btrim(source_event_key)) between 1 and 160
        and source_path is not null
      )
    )
);

comment on table public.activities is
  'Trvalý CRM log ručních a automatických obchodních aktivit uživatelů.';

comment on column public.activities.source_event_key is
  'Stabilní identifikátor konkrétní automatické události použitý proti duplicitám.';

create index if not exists activities_user_occurred_at_idx
  on public.activities (user_id, occurred_at desc);

create index if not exists activities_client_occurred_at_idx
  on public.activities (client_id, occurred_at desc)
  where client_id is not null;

create index if not exists activities_status_scheduled_for_idx
  on public.activities (status, scheduled_for asc)
  where status = 'planned';

create index if not exists activities_origin_occurred_at_idx
  on public.activities (origin, occurred_at desc);

create index if not exists activities_source_idx
  on public.activities (source_type, source_id, occurred_at desc)
  where source_id is not null;

-- Jeden automatický děj smí být pro jednoho sledovaného uživatele uložen jen jednou.
create unique index if not exists activities_automatic_event_unique_idx
  on public.activities (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic';

create or replace function public.activities_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activities_touch_updated_at on public.activities;
create trigger activities_touch_updated_at
before update on public.activities
for each row
execute function public.activities_touch_updated_at();

alter table public.activities enable row level security;

revoke all on table public.activities from public;
revoke all on table public.activities from anon;
grant select, insert, update, delete on table public.activities to authenticated;

-- Uživatel vidí jen vlastní záznamy. Administrátor vidí všechny záznamy.
drop policy if exists "Activities users read own and admins all" on public.activities;
create policy "Activities users read own and admins all"
  on public.activities
  for select
  using (
    public.current_user_can_view_activities()
    and (
      user_id = auth.uid()
      or public.current_user_is_admin()
    )
  );

-- Přímým insertem lze vytvořit pouze vlastní ruční aktivitu. Automatické
-- záznamy bude v kroku 3 zapisovat samostatná zabezpečená serverová funkce.
drop policy if exists "Activities users insert own manual" on public.activities;
create policy "Activities users insert own manual"
  on public.activities
  for insert
  with check (
    public.current_user_can_view_activities()
    and origin = 'manual'
    and user_id = auth.uid()
    and created_by = auth.uid()
    and (
      client_id is null
      or public.current_user_can_view_client(client_id)
    )
  );

drop policy if exists "Activities users update own manual" on public.activities;
create policy "Activities users update own manual"
  on public.activities
  for update
  using (
    public.current_user_can_view_activities()
    and origin = 'manual'
    and user_id = auth.uid()
    and created_by = auth.uid()
  )
  with check (
    public.current_user_can_view_activities()
    and origin = 'manual'
    and user_id = auth.uid()
    and created_by = auth.uid()
    and (
      client_id is null
      or public.current_user_can_view_client(client_id)
    )
  );

drop policy if exists "Activities users delete own manual" on public.activities;
create policy "Activities users delete own manual"
  on public.activities
  for delete
  using (
    public.current_user_can_view_activities()
    and origin = 'manual'
    and user_id = auth.uid()
    and created_by = auth.uid()
  );

-- Kontrolní výpis po spuštění migrace.
select id, name, role, can_view_activities
from public.profiles
where role = 'admin'
   or can_view_activities = true
order by name nulls last;
