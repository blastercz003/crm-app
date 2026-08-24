-- Opakování plánovaných ručních aktivit.
-- Další výskyt vzniká aplikačně až po dokončení předchozího výskytu.

begin;

alter table public.activities
  add column if not exists recurrence_unit text,
  add column if not exists recurrence_interval integer,
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_parent_id uuid,
  add column if not exists recurrence_anchor_at timestamptz,
  add column if not exists recurrence_sequence integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.activities'::regclass
      and conname = 'activities_recurrence_parent_fkey'
  ) then
    alter table public.activities
      add constraint activities_recurrence_parent_fkey
      foreign key (recurrence_parent_id)
      references public.activities(id)
      on delete restrict;
  end if;
end
$$;

alter table public.activities
  drop constraint if exists activities_recurrence_interval_check,
  drop constraint if exists activities_recurrence_metadata_check,
  drop constraint if exists activities_recurrence_state_check,
  drop constraint if exists activities_automatic_recurrence_check;

alter table public.activities
  add constraint activities_recurrence_interval_check
    check (
      recurrence_interval is null
      or recurrence_interval between 1 and 365
    ),
  add constraint activities_recurrence_metadata_check
    check (
      (recurrence_unit is null and recurrence_interval is null)
      or (
        recurrence_unit in ('day', 'week', 'month')
        and recurrence_interval is not null
        and recurrence_series_id is not null
        and recurrence_anchor_at is not null
      )
    ),
  add constraint activities_recurrence_state_check
    check (
      recurrence_unit is null
      or (
        origin = 'manual'
        and status = 'planned'
        and scheduled_for is not null
        and deleted_at is null
      )
    ),
  add constraint activities_automatic_recurrence_check
    check (
      origin <> 'automatic'
      or (
        recurrence_unit is null
        and recurrence_interval is null
        and recurrence_series_id is null
        and recurrence_parent_id is null
        and recurrence_anchor_at is null
        and recurrence_sequence = 0
      )
    );

create unique index if not exists activities_recurrence_series_sequence_uidx
  on public.activities (recurrence_series_id, recurrence_sequence)
  where recurrence_series_id is not null;

create unique index if not exists activities_recurrence_parent_uidx
  on public.activities (recurrence_parent_id)
  where recurrence_parent_id is not null;

create index if not exists activities_pending_recurrence_idx
  on public.activities (user_id, scheduled_for asc)
  where origin = 'manual'
    and status = 'planned'
    and recurrence_unit is not null
    and deleted_at is null;

create or replace function public.validate_activity_recurrence_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_activity public.activities%rowtype;
begin
  if new.recurrence_parent_id is null then
    return new;
  end if;

  select * into parent_activity
  from public.activities
  where id = new.recurrence_parent_id;

  if not found
     or parent_activity.origin <> 'manual'
     or new.origin <> 'manual'
     or parent_activity.user_id <> new.user_id
     or parent_activity.created_by <> new.created_by
     or parent_activity.recurrence_series_id is distinct from new.recurrence_series_id
     or new.recurrence_sequence <= parent_activity.recurrence_sequence then
    raise exception 'Neplatná vazba opakované aktivity.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_activity_recurrence_link()
  from public, anon, authenticated;

drop trigger if exists activities_validate_recurrence_link on public.activities;
create trigger activities_validate_recurrence_link
before insert or update of recurrence_parent_id, recurrence_series_id, recurrence_sequence, user_id, created_by, origin
on public.activities
for each row execute function public.validate_activity_recurrence_link();

commit;
