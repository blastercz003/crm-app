-- KROK 3: Automatický CRM log z Nabídek, Úkolů a Schůzek.
-- Vyžaduje předchozí spuštění database/activities.sql.

create or replace function public.activities_write_automatic_event(
  p_client_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_source_event_key text,
  p_activity_type text,
  p_title text,
  p_description text default null,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_user_id uuid := auth.uid();
  normalized_source_path text;
begin
  -- Automatický log nesmí narušit práci uživatelů bez přístupu do Aktivit.
  if actor_user_id is null or not public.current_user_can_view_activities() then
    return;
  end if;

  if p_source_type not in ('meeting', 'task', 'offer') then
    raise exception 'Nepodporovaný zdroj automatické aktivity.';
  end if;

  normalized_source_path := case p_source_type
    when 'meeting' then '/meetings/' || p_source_id::text
    when 'task' then '/tasks/' || p_source_id::text
    when 'offer' then '/offers/' || p_source_id::text
  end;

  insert into public.activities (
    user_id,
    created_by,
    client_id,
    origin,
    activity_type,
    title,
    description,
    status,
    occurred_at,
    scheduled_for,
    completed_at,
    source_type,
    source_id,
    source_event_key,
    source_path,
    metadata
  )
  values (
    actor_user_id,
    actor_user_id,
    p_client_id,
    'automatic',
    lower(left(btrim(p_activity_type), 64)),
    left(btrim(p_title), 240),
    nullif(btrim(p_description), ''),
    'logged',
    coalesce(p_occurred_at, now()),
    null,
    null,
    p_source_type,
    p_source_id,
    left(btrim(p_source_event_key), 160),
    normalized_source_path,
    case
      when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
        then coalesce(p_metadata, '{}'::jsonb)
      else '{}'::jsonb
    end
  )
  on conflict (user_id, source_type, source_id, source_event_key)
    where origin = 'automatic'
  do nothing;
end;
$$;

-- Funkce je interní: spouštějí ji pouze níže definované triggery.
revoke all on function public.activities_write_automatic_event(
  uuid, text, uuid, text, text, text, text, timestamptz, jsonb
) from public, anon, authenticated;

create or replace function public.activities_log_offer_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_at timestamptz := clock_timestamp();
  status_label text;
begin
  if tg_op = 'INSERT' then
    perform public.activities_write_automatic_event(
      new.client_id,
      'offer',
      new.id,
      'created',
      'offer_created',
      'Vytvořena nabídka ' || new.offer_number || ': ' || new.title,
      null,
      event_at,
      jsonb_build_object(
        'offer_number', new.offer_number,
        'offer_title', new.title,
        'status', new.status
      )
    );

    return new;
  end if;

  if old.status is distinct from new.status then
    status_label := case new.status
      when 'draft' then 'Rozpracováno'
      when 'submitted' then 'Ke schválení'
      when 'changes_requested' then 'Vráceno k úpravě'
      when 'approved' then 'Schváleno'
      when 'sent_to_client' then 'Odesláno klientovi'
      when 'in_progress' then 'V řešení'
      when 'ordered' then 'Objednáno'
      when 'rejected' then 'Zamítnuto'
      when 'realizace' then 'Realizace'
      else new.status
    end;

    perform public.activities_write_automatic_event(
      new.client_id,
      'offer',
      new.id,
      'status:' || old.status || ':' || new.status || ':' || gen_random_uuid()::text,
      'offer_status_changed',
      'Nabídka ' || new.offer_number || ' změnila stav na ' || status_label,
      case
        when new.status = 'rejected' and nullif(btrim(new.rejection_comment), '') is not null
          then new.rejection_comment
        when new.status = 'changes_requested' and nullif(btrim(new.rejection_comment), '') is not null
          then new.rejection_comment
        else null
      end,
      event_at,
      jsonb_build_object(
        'offer_number', new.offer_number,
        'offer_title', new.title,
        'previous_status', old.status,
        'status', new.status,
        'status_label', status_label
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists activities_offer_event_log on public.offers;
create trigger activities_offer_event_log
after insert or update of status on public.offers
for each row
execute function public.activities_log_offer_event();

create or replace function public.activities_log_offer_comment_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  offer_row record;
begin
  select offers.client_id, offers.offer_number, offers.title
  into offer_row
  from public.offers
  where offers.id = new.offer_id;

  if not found then
    return new;
  end if;

  perform public.activities_write_automatic_event(
    offer_row.client_id,
    'offer',
    new.offer_id,
    'comment:' || new.id::text,
    'offer_comment_added',
    'Přidán komentář k nabídce ' || offer_row.offer_number,
    new.note,
    coalesce(new.created_at, clock_timestamp()),
    jsonb_build_object(
      'offer_number', offer_row.offer_number,
      'offer_title', offer_row.title,
      'comment_id', new.id
    )
  );

  return new;
end;
$$;

drop trigger if exists activities_offer_comment_event_log on public.offer_progress_notes;
create trigger activities_offer_comment_event_log
after insert on public.offer_progress_notes
for each row
execute function public.activities_log_offer_comment_event();

create or replace function public.activities_log_task_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_at timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    perform public.activities_write_automatic_event(
      new.client_id,
      'task',
      new.id,
      'created',
      'task_created',
      'Vytvořen úkol: ' || new.title,
      new.note,
      event_at,
      jsonb_build_object(
        'task_title', new.title,
        'status', new.status,
        'due_date', new.due_date
      )
    );

    return new;
  end if;

  if old.status is distinct from new.status then
    perform public.activities_write_automatic_event(
      new.client_id,
      'task',
      new.id,
      'status:' || old.status || ':' || new.status || ':' || gen_random_uuid()::text,
      case when new.status = 'done' then 'task_completed' else 'task_reopened' end,
      case
        when new.status = 'done' then 'Dokončen úkol: ' || new.title
        else 'Znovu otevřen úkol: ' || new.title
      end,
      null,
      event_at,
      jsonb_build_object(
        'task_title', new.title,
        'previous_status', old.status,
        'status', new.status,
        'due_date', new.due_date
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists activities_task_event_log on public.tasks;
create trigger activities_task_event_log
after insert or update of status on public.tasks
for each row
execute function public.activities_log_task_event();

create or replace function public.activities_log_meeting_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_at timestamptz := clock_timestamp();
  meeting_label text;
begin
  meeting_label := coalesce(
    nullif(btrim(new.title), ''),
    nullif(btrim(new.company_name), ''),
    'Bez názvu'
  );

  if tg_op = 'INSERT' then
    perform public.activities_write_automatic_event(
      new.client_id,
      'meeting',
      new.id,
      'created',
      'meeting_created',
      'Domluvena schůzka: ' || meeting_label,
      new.pre_meeting_note,
      event_at,
      jsonb_build_object(
        'meeting_title', meeting_label,
        'company_name', new.company_name,
        'meeting_datetime', new.meeting_datetime,
        'status', new.status
      )
    );

    return new;
  end if;

  if old.status is distinct from new.status then
    perform public.activities_write_automatic_event(
      new.client_id,
      'meeting',
      new.id,
      'status:' || old.status || ':' || new.status || ':' || gen_random_uuid()::text,
      case when new.status = 'completed' then 'meeting_completed' else 'meeting_reopened' end,
      case
        when new.status = 'completed' then 'Dokončena schůzka: ' || meeting_label
        else 'Schůzka vrácena mezi plánované: ' || meeting_label
      end,
      case when new.status = 'completed' then new.result_note else null end,
      event_at,
      jsonb_build_object(
        'meeting_title', meeting_label,
        'company_name', new.company_name,
        'previous_status', old.status,
        'status', new.status,
        'meeting_datetime', new.meeting_datetime
      )
    );
  end if;

  if old.meeting_datetime is distinct from new.meeting_datetime then
    perform public.activities_write_automatic_event(
      new.client_id,
      'meeting',
      new.id,
      'rescheduled:' || gen_random_uuid()::text,
      'meeting_rescheduled',
      'Změněn termín schůzky: ' || meeting_label,
      null,
      event_at,
      jsonb_build_object(
        'meeting_title', meeting_label,
        'company_name', new.company_name,
        'previous_meeting_datetime', old.meeting_datetime,
        'meeting_datetime', new.meeting_datetime
      )
    );
  end if;

  if old.result_note is distinct from new.result_note
     and nullif(btrim(new.result_note), '') is not null then
    perform public.activities_write_automatic_event(
      new.client_id,
      'meeting',
      new.id,
      'result:' || gen_random_uuid()::text,
      'meeting_result_added',
      'Doplněn výsledek schůzky: ' || meeting_label,
      new.result_note,
      event_at,
      jsonb_build_object(
        'meeting_title', meeting_label,
        'company_name', new.company_name,
        'meeting_datetime', new.meeting_datetime
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists activities_meeting_event_log on public.meetings;
create trigger activities_meeting_event_log
after insert or update of status, meeting_datetime, result_note on public.meetings
for each row
execute function public.activities_log_meeting_event();

-- Kontrola instalace triggerů.
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
  and trigger_name in (
    'activities_offer_event_log',
    'activities_offer_comment_event_log',
    'activities_task_event_log',
    'activities_meeting_event_log'
  )
order by table_name, trigger_name, event_manipulation;
