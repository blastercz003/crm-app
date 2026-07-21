create or replace function public.publish_task_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  if tg_op = 'INSERT' then
    recipient_ids := array[new.created_by, new.assigned_to];
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.created_by, old.assigned_to];
  else
    recipient_ids := array[
      old.created_by,
      old.assigned_to,
      new.created_by,
      new.assigned_to
    ];
  end if;

  perform public.publish_app_data_change('tasks', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.publish_meeting_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
  admin_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into admin_ids
  from public.profiles
  where profiles.role = 'admin';

  if tg_op = 'INSERT' then
    recipient_ids := array[new.assigned_user_id] || admin_ids;
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.assigned_user_id] || admin_ids;
  else
    recipient_ids := array[old.assigned_user_id, new.assigned_user_id] || admin_ids;
  end if;

  perform public.publish_app_data_change('meetings', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.publish_offer_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
  admin_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into admin_ids
  from public.profiles
  where profiles.role = 'admin';

  if tg_op = 'INSERT' then
    recipient_ids := array[new.created_by] || admin_ids;
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.created_by] || admin_ids;
  else
    recipient_ids := array[old.created_by, new.created_by] || admin_ids;
  end if;

  perform public.publish_app_data_change('offers', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.publish_offer_progress_note_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_offer_ids uuid[];
  recipient_ids uuid[];
  admin_ids uuid[];
begin
  if tg_op = 'INSERT' then
    affected_offer_ids := array[new.offer_id];
  elsif tg_op = 'DELETE' then
    affected_offer_ids := array[old.offer_id];
  else
    affected_offer_ids := array[old.offer_id, new.offer_id];
  end if;

  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into admin_ids
  from public.profiles
  where profiles.role = 'admin';

  select coalesce(array_agg(offers.created_by), array[]::uuid[])
  into recipient_ids
  from public.offers
  where offers.id = any(affected_offer_ids);

  perform public.publish_app_data_change('offers', recipient_ids || admin_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.publish_task_app_change() from public, anon, authenticated;
revoke all on function public.publish_meeting_app_change() from public, anon, authenticated;
revoke all on function public.publish_offer_app_change() from public, anon, authenticated;
revoke all on function public.publish_offer_progress_note_app_change()
  from public, anon, authenticated;

drop trigger if exists tasks_publish_app_change on public.tasks;
create trigger tasks_publish_app_change
after insert or update or delete on public.tasks
for each row execute function public.publish_task_app_change();

drop trigger if exists meetings_publish_app_change on public.meetings;
create trigger meetings_publish_app_change
after insert or update or delete on public.meetings
for each row execute function public.publish_meeting_app_change();

drop trigger if exists offers_publish_app_change on public.offers;
create trigger offers_publish_app_change
after insert or update or delete on public.offers
for each row execute function public.publish_offer_app_change();

drop trigger if exists offer_progress_notes_publish_app_change
  on public.offer_progress_notes;
create trigger offer_progress_notes_publish_app_change
after insert or update or delete on public.offer_progress_notes
for each row execute function public.publish_offer_progress_note_app_change();

create or replace function public.publish_job_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or profiles.can_view_jobs = true
     or profiles.dashboard_calendar = true;

  perform public.publish_app_data_change('jobs', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.publish_job_app_change()
  from public, anon, authenticated;

comment on function public.publish_task_app_change() is
  'Publishes task refresh signals to the current and previous task owners.';
comment on function public.publish_meeting_app_change() is
  'Publishes meeting refresh signals to assignees and dashboard admins.';
comment on function public.publish_offer_app_change() is
  'Publishes offer refresh signals to offer owners and dashboard admins.';
