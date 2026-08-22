-- KROK 4: Jednorázový a opakovatelný import historických CRM aktivit.
-- Vyžaduje database/activities.sql a database/activities-automatic-events.sql.

begin;

-- Vytvořené nabídky. Klíč "created" je stejný jako u živého triggeru,
-- takže nabídky vzniklé po jeho zapnutí nebudou vloženy podruhé.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  offers.created_by,
  offers.created_by,
  offers.client_id,
  'automatic',
  'offer_created',
  left('Vytvořena nabídka ' || offers.offer_number || ': ' || offers.title, 240),
  null,
  'logged',
  offers.created_at,
  'offer',
  offers.id,
  'created',
  '/offers/' || offers.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'offer_number', offers.offer_number,
    'offer_title', offers.title,
    'status', offers.status
  ),
  offers.created_at,
  offers.created_at
from public.offers
join public.profiles actor on actor.id = offers.created_by
where actor.role = 'admin'
   or actor.can_view_activities = true
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

-- Vytvořené úkoly. Používáme pouze skutečného created_by, nikoli assigned_to,
-- protože přiřazený uživatel nemusel být tím, kdo úkol založil.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  tasks.created_by,
  tasks.created_by,
  tasks.client_id,
  'automatic',
  'task_created',
  left('Vytvořen úkol: ' || tasks.title, 240),
  nullif(btrim(tasks.note), ''),
  'logged',
  tasks.created_at,
  'task',
  tasks.id,
  'created',
  '/tasks/' || tasks.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'task_title', tasks.title,
    'status', tasks.status,
    'due_date', tasks.due_date
  ),
  tasks.created_at,
  tasks.created_at
from public.tasks
join public.profiles actor on actor.id = tasks.created_by
where actor.role = 'admin'
   or actor.can_view_activities = true
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

-- Vytvořené schůzky. Historické dokončení samostatně nevkládáme, protože
-- tabulka neobsahuje spolehlivý údaj o uživateli, který stav změnil.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  meetings.created_by,
  meetings.created_by,
  meetings.client_id,
  'automatic',
  'meeting_created',
  left(
    'Domluvena schůzka: ' || coalesce(
      nullif(btrim(meetings.title), ''),
      nullif(btrim(meetings.company_name), ''),
      'Bez názvu'
    ),
    240
  ),
  nullif(btrim(meetings.pre_meeting_note), ''),
  'logged',
  meetings.created_at,
  'meeting',
  meetings.id,
  'created',
  '/meetings/' || meetings.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'meeting_title', coalesce(
      nullif(btrim(meetings.title), ''),
      nullif(btrim(meetings.company_name), ''),
      'Bez názvu'
    ),
    'company_name', meetings.company_name,
    'meeting_datetime', meetings.meeting_datetime,
    'status', meetings.status
  ),
  meetings.created_at,
  meetings.created_at
from public.meetings
join public.profiles actor on actor.id = meetings.created_by
where actor.role = 'admin'
   or actor.can_view_activities = true
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

-- Historické průběžné komentáře k nabídkám mají autora i přesný čas.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  notes.author_user_id,
  notes.author_user_id,
  offers.client_id,
  'automatic',
  'offer_comment_added',
  left('Přidán komentář k nabídce ' || offers.offer_number, 240),
  notes.note,
  'logged',
  notes.created_at,
  'offer',
  offers.id,
  'comment:' || notes.id::text,
  '/offers/' || offers.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'offer_number', offers.offer_number,
    'offer_title', offers.title,
    'comment_id', notes.id
  ),
  notes.created_at,
  notes.created_at
from public.offer_progress_notes notes
join public.offers on offers.id = notes.offer_id
join public.profiles actor on actor.id = notes.author_user_id
where actor.role = 'admin'
   or actor.can_view_activities = true
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

-- Schválení nabídky lze bezpečně připsat uloženému schvalovateli.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  offers.approver_user_id,
  offers.approver_user_id,
  offers.client_id,
  'automatic',
  'offer_status_changed',
  left('Nabídka ' || offers.offer_number || ' změnila stav na Schváleno', 240),
  null,
  'logged',
  offers.approved_at,
  'offer',
  offers.id,
  'backfill:approved',
  '/offers/' || offers.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'offer_number', offers.offer_number,
    'offer_title', offers.title,
    'status', 'approved',
    'status_label', 'Schváleno'
  ),
  offers.approved_at,
  offers.approved_at
from public.offers
join public.profiles actor on actor.id = offers.approver_user_id
where offers.approved_at is not null
  and (actor.role = 'admin' or actor.can_view_activities = true)
  and not exists (
    select 1
    from public.activities existing
    where existing.user_id = offers.approver_user_id
      and existing.source_type = 'offer'
      and existing.source_id = offers.id
      and existing.activity_type = 'offer_status_changed'
      and existing.metadata ->> 'status' = 'approved'
  )
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

-- rejected_at v současné aplikaci vzniká při vrácení nabídky k úpravě a
-- approver_user_id označuje uživatele, který tuto operaci provedl.
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
  source_type,
  source_id,
  source_event_key,
  source_path,
  metadata,
  created_at,
  updated_at
)
select
  offers.approver_user_id,
  offers.approver_user_id,
  offers.client_id,
  'automatic',
  'offer_status_changed',
  left('Nabídka ' || offers.offer_number || ' změnila stav na Vráceno k úpravě', 240),
  nullif(btrim(offers.rejection_comment), ''),
  'logged',
  offers.rejected_at,
  'offer',
  offers.id,
  'backfill:changes-requested',
  '/offers/' || offers.id::text,
  jsonb_build_object(
    'backfill_version', 'step4-v1',
    'offer_number', offers.offer_number,
    'offer_title', offers.title,
    'status', 'changes_requested',
    'status_label', 'Vráceno k úpravě'
  ),
  offers.rejected_at,
  offers.rejected_at
from public.offers
join public.profiles actor on actor.id = offers.approver_user_id
where offers.rejected_at is not null
  and (actor.role = 'admin' or actor.can_view_activities = true)
  and not exists (
    select 1
    from public.activities existing
    where existing.user_id = offers.approver_user_id
      and existing.source_type = 'offer'
      and existing.source_id = offers.id
      and existing.activity_type = 'offer_status_changed'
      and existing.metadata ->> 'status' = 'changes_requested'
  )
on conflict (user_id, source_type, source_id, source_event_key)
  where origin = 'automatic'
do nothing;

commit;

-- Kontrolní výpis importovaných záznamů podle uživatele a typu.
select
  profiles.name as user_name,
  activities.source_type,
  activities.activity_type,
  count(*)::integer as imported_count,
  min(activities.occurred_at) as oldest_activity,
  max(activities.occurred_at) as newest_activity
from public.activities
join public.profiles on profiles.id = activities.user_id
where activities.metadata ->> 'backfill_version' = 'step4-v1'
group by profiles.id, profiles.name, activities.source_type, activities.activity_type
order by profiles.name, activities.source_type, activities.activity_type;

-- Tento výpis musí vrátit nulu.
select count(*)::integer as duplicate_automatic_events
from (
  select user_id, source_type, source_id, source_event_key
  from public.activities
  where origin = 'automatic'
  group by user_id, source_type, source_id, source_event_key
  having count(*) > 1
) duplicates;
