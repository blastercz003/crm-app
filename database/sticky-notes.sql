-- Soukromé Lístečky pracovní plochy Obchodní aktivita.

begin;

create extension if not exists "pgcrypto";

create table if not exists public.sticky_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text,
  content text not null default '',
  color text not null default 'yellow'
    check (color in ('yellow', 'blue', 'green', 'pink', 'purple', 'gray')),
  is_pinned boolean not null default false,
  reminder_enabled boolean not null default false,
  reminder_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_skipped_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticky_notes_title_check
    check (title is null or char_length(btrim(title)) between 1 and 120),
  constraint sticky_notes_content_length_check
    check (char_length(content) <= 1000),
  constraint sticky_notes_reminder_state_check
    check (
      reminder_enabled = false
      or (reminder_at is not null and archived_at is null and deleted_at is null)
    ),
  constraint sticky_notes_reminder_processing_check
    check (not (reminder_sent_at is not null and reminder_skipped_at is not null))
);

create table if not exists public.sticky_note_conversions (
  id uuid primary key default gen_random_uuid(),
  sticky_note_id uuid not null references public.sticky_notes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('task', 'activity')),
  target_id uuid not null,
  target_title text not null
    check (char_length(btrim(target_title)) between 1 and 240),
  target_path text not null check (left(target_path, 1) = '/'),
  created_at timestamptz not null default now()
);

create unique index if not exists sticky_note_conversions_target_unique_idx
  on public.sticky_note_conversions (sticky_note_id, target_type, target_id);
create index if not exists sticky_notes_active_user_idx
  on public.sticky_notes (user_id, is_pinned desc, updated_at desc)
  where archived_at is null and deleted_at is null;
create index if not exists sticky_notes_reminders_idx
  on public.sticky_notes (reminder_at asc)
  where reminder_enabled = true
    and reminder_sent_at is null
    and reminder_skipped_at is null
    and archived_at is null
    and deleted_at is null;
create index if not exists sticky_notes_archive_user_idx
  on public.sticky_notes (user_id, archived_at desc)
  where archived_at is not null and deleted_at is null;
create index if not exists sticky_notes_trash_user_idx
  on public.sticky_notes (user_id, deleted_at desc)
  where deleted_at is not null;
create index if not exists sticky_notes_client_idx
  on public.sticky_notes (client_id, updated_at desc)
  where client_id is not null and deleted_at is null;
create index if not exists sticky_note_conversions_note_idx
  on public.sticky_note_conversions (sticky_note_id, created_at desc);
create index if not exists sticky_note_conversions_user_idx
  on public.sticky_note_conversions (user_id, created_at desc);

create or replace function public.sticky_notes_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sticky_notes_touch_updated_at on public.sticky_notes;
create trigger sticky_notes_touch_updated_at
before update on public.sticky_notes
for each row execute function public.sticky_notes_touch_updated_at();

create or replace function public.sticky_note_conversions_set_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  note_owner_id uuid;
begin
  select sticky_notes.user_id
  into note_owner_id
  from public.sticky_notes
  where sticky_notes.id = new.sticky_note_id;

  if note_owner_id is null then
    raise exception 'Lísteček nebyl nalezen.';
  end if;

  new.user_id := note_owner_id;
  return new;
end;
$$;

revoke all on function public.sticky_note_conversions_set_owner()
  from public, anon, authenticated;
drop trigger if exists sticky_note_conversions_set_owner
  on public.sticky_note_conversions;
create trigger sticky_note_conversions_set_owner
before insert or update of sticky_note_id on public.sticky_note_conversions
for each row execute function public.sticky_note_conversions_set_owner();

alter table public.sticky_notes enable row level security;
alter table public.sticky_note_conversions enable row level security;
revoke all on table public.sticky_notes from public, anon, authenticated;
revoke all on table public.sticky_note_conversions from public, anon, authenticated;
grant select, insert, update, delete on table public.sticky_notes to authenticated;
grant select, insert, delete on table public.sticky_note_conversions to authenticated;

drop policy if exists "Sticky notes users read own" on public.sticky_notes;
create policy "Sticky notes users read own"
  on public.sticky_notes for select to authenticated
  using (public.current_user_can_view_activities() and user_id = auth.uid());
drop policy if exists "Sticky notes users insert own" on public.sticky_notes;
create policy "Sticky notes users insert own"
  on public.sticky_notes for insert to authenticated
  with check (
    public.current_user_can_view_activities()
    and user_id = auth.uid()
    and (client_id is null or public.current_user_can_view_client(client_id))
  );
drop policy if exists "Sticky notes users update own" on public.sticky_notes;
create policy "Sticky notes users update own"
  on public.sticky_notes for update to authenticated
  using (public.current_user_can_view_activities() and user_id = auth.uid())
  with check (
    public.current_user_can_view_activities()
    and user_id = auth.uid()
    and (client_id is null or public.current_user_can_view_client(client_id))
  );
drop policy if exists "Sticky notes users delete own" on public.sticky_notes;
create policy "Sticky notes users delete own"
  on public.sticky_notes for delete to authenticated
  using (public.current_user_can_view_activities() and user_id = auth.uid());

drop policy if exists "Sticky note conversions users read own"
  on public.sticky_note_conversions;
create policy "Sticky note conversions users read own"
  on public.sticky_note_conversions for select to authenticated
  using (public.current_user_can_view_activities() and user_id = auth.uid());
drop policy if exists "Sticky note conversions users insert own"
  on public.sticky_note_conversions;
create policy "Sticky note conversions users insert own"
  on public.sticky_note_conversions for insert to authenticated
  with check (
    public.current_user_can_view_activities()
    and user_id = auth.uid()
    and exists (
      select 1
      from public.sticky_notes note
      where note.id = sticky_note_id
        and note.user_id = auth.uid()
        and note.deleted_at is null
    )
  );
drop policy if exists "Sticky note conversions users delete own"
  on public.sticky_note_conversions;
create policy "Sticky note conversions users delete own"
  on public.sticky_note_conversions for delete to authenticated
  using (public.current_user_can_view_activities() and user_id = auth.uid());

create or replace function public.publish_sticky_notes_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  if tg_op = 'INSERT' then
    recipient_ids := array[new.user_id];
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.user_id];
  else
    recipient_ids := array[old.user_id, new.user_id];
  end if;

  perform public.publish_app_data_change('sticky_notes', recipient_ids);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.publish_sticky_notes_app_change()
  from public, anon, authenticated;
drop trigger if exists sticky_notes_publish_app_change on public.sticky_notes;
create trigger sticky_notes_publish_app_change
after insert or update or delete on public.sticky_notes
for each row execute function public.publish_sticky_notes_app_change();
drop trigger if exists sticky_note_conversions_publish_app_change
  on public.sticky_note_conversions;
create trigger sticky_note_conversions_publish_app_change
after insert or delete on public.sticky_note_conversions
for each row execute function public.publish_sticky_notes_app_change();

create or replace function public.purge_deleted_sticky_notes()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed_count integer;
begin
  delete from public.sticky_notes
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;

revoke all on function public.purge_deleted_sticky_notes()
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'purge_deleted_sticky_notes_daily';
  perform cron.schedule(
    'purge_deleted_sticky_notes_daily',
    '25 3 * * *',
    $job$select public.purge_deleted_sticky_notes();$job$
  );
end
$$;

commit;
