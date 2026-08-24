-- Databázový základ pracovní plochy Obchodní aktivita.
-- Rozšiřuje ruční aktivity o výsledek, připomínku a měkké smazání.

begin;

alter table public.activities
  add column if not exists completion_result text,
  add column if not exists reminder_enabled boolean not null default false,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_skipped_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

comment on column public.activities.completion_result is
  'Volitelný výsledek zadaný při dokončení naplánované ruční aktivity.';
comment on column public.activities.reminder_enabled is
  'Určuje, zda má být uživatel upozorněn 15 minut před plánovaným termínem.';
comment on column public.activities.reminder_sent_at is
  'Čas úspěšného vytvoření notifikace k plánované aktivitě.';
comment on column public.activities.reminder_skipped_at is
  'Čas označení připomínky jako zmeškané; používá se u termínů starších než 60 minut.';
comment on column public.activities.deleted_at is
  'Čas měkkého odstranění ruční aktivity. Záznam zůstává dostupný pro audit a report.';
comment on column public.activities.deleted_by is
  'Uživatel, který ruční aktivitu měkce odstranil.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.activities'::regclass
      and conname = 'activities_deleted_by_fkey'
  ) then
    alter table public.activities
      add constraint activities_deleted_by_fkey
      foreign key (deleted_by) references public.profiles(id) on delete set null;
  end if;
end
$$;

alter table public.activities
  drop constraint if exists activities_completion_result_length_check,
  drop constraint if exists activities_completion_result_state_check,
  drop constraint if exists activities_reminder_enabled_state_check,
  drop constraint if exists activities_automatic_reminder_check,
  drop constraint if exists activities_reminder_processing_check,
  drop constraint if exists activities_soft_delete_manual_only_check,
  drop constraint if exists activities_deleted_by_requires_deleted_at_check;

alter table public.activities
  add constraint activities_completion_result_length_check
    check (completion_result is null or char_length(completion_result) <= 5000),
  add constraint activities_completion_result_state_check
    check (completion_result is null or (origin = 'manual' and status = 'completed')),
  add constraint activities_reminder_enabled_state_check
    check (
      reminder_enabled = false
      or (
        origin = 'manual'
        and status = 'planned'
        and scheduled_for is not null
        and deleted_at is null
      )
    ),
  add constraint activities_automatic_reminder_check
    check (
      origin <> 'automatic'
      or (
        reminder_enabled = false
        and reminder_sent_at is null
        and reminder_skipped_at is null
      )
    ),
  add constraint activities_reminder_processing_check
    check (not (reminder_sent_at is not null and reminder_skipped_at is not null)),
  add constraint activities_soft_delete_manual_only_check
    check (deleted_at is null or origin = 'manual'),
  add constraint activities_deleted_by_requires_deleted_at_check
    check (deleted_at is not null or deleted_by is null);

create index if not exists activities_manual_planned_user_idx
  on public.activities (user_id, scheduled_for asc)
  where origin = 'manual' and status = 'planned' and deleted_at is null;

create index if not exists activities_manual_logged_user_idx
  on public.activities (user_id, occurred_at desc)
  where origin = 'manual'
    and status in ('logged', 'completed')
    and deleted_at is null;

create index if not exists activities_pending_reminders_idx
  on public.activities (scheduled_for asc)
  where origin = 'manual'
    and status = 'planned'
    and reminder_enabled = true
    and reminder_sent_at is null
    and reminder_skipped_at is null
    and deleted_at is null;

create index if not exists activities_deleted_at_idx
  on public.activities (deleted_at desc)
  where deleted_at is not null;

drop policy if exists "Activities users insert own manual" on public.activities;
create policy "Activities users insert own manual"
  on public.activities
  for insert
  to authenticated
  with check (
    public.current_user_can_view_activities()
    and origin = 'manual'
    and user_id = auth.uid()
    and created_by = auth.uid()
    and status in ('logged', 'planned')
    and completed_at is null
    and completion_result is null
    and deleted_at is null
    and deleted_by is null
    and reminder_sent_at is null
    and reminder_skipped_at is null
    and (client_id is null or public.current_user_can_view_client(client_id))
  );

drop policy if exists "Activities users update own manual" on public.activities;
create policy "Activities users update own manual"
  on public.activities
  for update
  to authenticated
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
    and (deleted_by is null or deleted_by = auth.uid())
    and (client_id is null or public.current_user_can_view_client(client_id))
  );

drop policy if exists "Activities users delete own manual" on public.activities;
revoke delete on table public.activities from authenticated;

create or replace function public.profiles_protect_activities_access_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.can_view_activities is distinct from new.can_view_activities
     and auth.uid() is not null
     and not public.current_user_is_admin() then
    raise exception 'Oprávnění k sekci Aktivity může měnit pouze administrátor.';
  end if;

  return new;
end;
$$;

revoke all on function public.profiles_protect_activities_access_flag()
  from public, anon, authenticated;

drop trigger if exists profiles_protect_activities_access_flag on public.profiles;
create trigger profiles_protect_activities_access_flag
before update of can_view_activities on public.profiles
for each row execute function public.profiles_protect_activities_access_flag();

commit;
