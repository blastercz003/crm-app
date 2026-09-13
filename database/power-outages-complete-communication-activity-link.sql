begin;

-- Sprava komunikace KOMPLETNI, krok 2:
-- propojeni jednoho zdrojoveho zaznamu pripomenuti s Pracovni agendou.
-- Tento krok nepridava UI a sam nevytvari zadnou aktivitu.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.activities') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.activities');
  end if;
  if to_regclass('public.complete_power_outage_communication_states') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.complete_power_outage_communication_states'
    );
  end if;
  if to_regclass('public.complete_power_outage_communication_events') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.complete_power_outage_communication_events'
    );
  end if;
  if to_regclass('public.complete_power_outage_company_assignments') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.complete_power_outage_company_assignments'
    );
  end if;
  if to_regprocedure('public.current_user_can_view_activities()') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.current_user_can_view_activities()'
    );
  end if;
  if to_regprocedure('public.current_user_can_view_power_outages()') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.current_user_can_view_power_outages()'
    );
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro pripomenuti komunikace KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;

  if (
    select count(*)
    from information_schema.columns column_row
    where column_row.table_schema = 'public'
      and column_row.table_name = 'activities'
      and column_row.column_name in (
        'reminder_enabled',
        'reminder_sent_at',
        'reminder_skipped_at',
        'completion_result',
        'deleted_at',
        'recurrence_unit',
        'recurrence_interval',
        'recurrence_parent_id'
      )
  ) <> 8 then
    raise exception 'Pracovni agenda nema nasazeny zaklad pripomenuti, dokonceni a opakovani.';
  end if;
end
$$;

-- Krok 1 byl v nekterych prostredich nasazen pred pridanim udalosti zruseni.
alter table public.complete_power_outage_communication_events
  drop constraint if exists cpo_communication_events_kind_check;
alter table public.complete_power_outage_communication_events
  add constraint cpo_communication_events_kind_check check (
    event_kind in (
      'legacy_note',
      'manual_contact',
      'status_changed',
      'job_won',
      'job_reopened',
      'follow_up_created',
      'follow_up_rescheduled',
      'follow_up_completed',
      'follow_up_cancelled',
      'automatic_email_sent',
      'automatic_email_delivered'
    )
  );

alter table public.complete_power_outage_communication_events
  drop constraint if exists cpo_communication_events_shape_check;
alter table public.complete_power_outage_communication_events
  add constraint cpo_communication_events_shape_check check (
    (event_kind = 'legacy_note' and source_note_id is not null and body is not null)
    or (
      event_kind = 'manual_contact'
      and communication_channel is not null
      and new_status is not null
    )
    or (event_kind = 'status_changed' and new_status is not null)
    or (event_kind = 'job_won' and new_status = 'job_won')
    or (
      event_kind = 'job_reopened'
      and previous_status = 'job_won'
      and new_status is not null
      and new_status <> 'job_won'
    )
    or event_kind in (
      'follow_up_created',
      'follow_up_rescheduled',
      'follow_up_completed',
      'follow_up_cancelled',
      'automatic_email_sent',
      'automatic_email_delivered'
    )
  );

create table if not exists public.complete_power_outage_communication_activity_links (
  activity_id uuid primary key
    references public.activities(id) on delete restrict,
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  is_current boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.complete_power_outage_communication_activity_links is
  'Vazba mezi firmou na konkretni odstavce a jedinym zdrojovym zaznamem pripomenuti v Pracovni agende.';

create unique index if not exists cpo_communication_activity_one_current_idx
  on public.complete_power_outage_communication_activity_links (candidate_id)
  where is_current;

create index if not exists cpo_communication_activity_candidate_idx
  on public.complete_power_outage_communication_activity_links (
    candidate_id,
    created_at desc,
    activity_id
  );

alter table public.complete_power_outage_communication_activity_links
  enable row level security;
revoke all on table public.complete_power_outage_communication_activity_links
  from public, anon, authenticated;
grant all on table public.complete_power_outage_communication_activity_links
  to service_role;

create or replace function public.sync_cpo_communication_follow_up_activity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  link_row public.complete_power_outage_communication_activity_links%rowtype;
  actor_id uuid := auth.uid();
  actor_name text;
  timeline_kind text;
  timeline_key text;
begin
  select link.*
  into link_row
  from public.complete_power_outage_communication_activity_links link
  where link.activity_id = new.id
  for update;

  if not found then
    return new;
  end if;

  if new.recurrence_unit is not null
     or new.recurrence_interval is not null
     or new.recurrence_parent_id is not null then
    raise exception 'Propojeny dalsi krok nelze nastavit jako opakovany; po dokonceni vytvorte novy.';
  end if;

  if old.status <> 'planned' and new.status = 'planned' and not link_row.is_current then
    raise exception 'Dokoncene nebo zrusene pripomenuti nelze znovu aktivovat; vytvorte nove.';
  end if;

  if old.status = 'planned' and new.status = 'completed' then
    timeline_kind := 'follow_up_completed';
    timeline_key := 'follow-up:' || new.id::text || ':completed';
  elsif old.deleted_at is null and new.deleted_at is not null then
    timeline_kind := 'follow_up_cancelled';
    timeline_key := 'follow-up:' || new.id::text || ':cancelled';
  elsif old.status = 'planned' and new.status <> 'planned' then
    timeline_kind := 'follow_up_cancelled';
    timeline_key := 'follow-up:' || new.id::text || ':cancelled';
  elsif new.status = 'planned' and (
    old.scheduled_for is distinct from new.scheduled_for
    or old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.activity_type is distinct from new.activity_type
    or old.reminder_enabled is distinct from new.reminder_enabled
  ) then
    timeline_kind := 'follow_up_rescheduled';
    timeline_key := 'follow-up:' || new.id::text || ':changed:' || gen_random_uuid()::text;
  end if;

  if timeline_kind is null then
    return new;
  end if;

  if timeline_kind in ('follow_up_completed', 'follow_up_cancelled') then
    update public.complete_power_outage_communication_activity_links link
    set is_current = false
    where link.activity_id = new.id;
  end if;

  if actor_id is not null then
    select nullif(btrim(profile.name), '')
    into actor_name
    from public.profiles profile
    where profile.id = actor_id;
  end if;

  insert into public.complete_power_outage_communication_events (
    candidate_id,
    event_kind,
    actor_kind,
    actor_user_id,
    actor_name,
    body,
    occurred_at,
    source_event_key,
    metadata
  ) values (
    link_row.candidate_id,
    timeline_kind,
    case when actor_id is null then 'system' else 'user' end,
    actor_id,
    coalesce(actor_name, case when actor_id is null then 'System' else null end),
    case
      when timeline_kind = 'follow_up_completed' then new.completion_result
      else new.description
    end,
    now(),
    timeline_key,
    jsonb_build_object(
      'contract', 'complete-communication-activity-link-v1',
      'activityId', new.id,
      'title', new.title,
      'activityType', new.activity_type,
      'previousScheduledFor', old.scheduled_for,
      'scheduledFor', new.scheduled_for,
      'reminderEnabled', new.reminder_enabled,
      'activityStatus', new.status
    )
  )
  on conflict (source_event_key) do nothing;

  return new;
end;
$$;

drop trigger if exists activities_sync_cpo_communication_follow_up
  on public.activities;
create trigger activities_sync_cpo_communication_follow_up
after update of
  status,
  scheduled_for,
  title,
  description,
  activity_type,
  reminder_enabled,
  deleted_at,
  recurrence_unit,
  recurrence_interval,
  recurrence_parent_id
on public.activities
for each row execute function public.sync_cpo_communication_follow_up_activity_v1();

create or replace function public.save_complete_power_outage_communication_follow_up_v1(
  requested_candidate_id uuid,
  requested_activity_type text,
  requested_title text,
  requested_description text,
  requested_scheduled_for timestamptz,
  requested_reminder_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_name text;
  assignment_owner_id uuid;
  current_activity_id uuid;
  clean_activity_type text := lower(btrim(coalesce(requested_activity_type, '')));
  clean_title text := btrim(coalesce(requested_title, ''));
  clean_description text := nullif(btrim(coalesce(requested_description, '')), '');
  activity_row public.activities%rowtype;
begin
  if current_user_id is null
     or not public.current_user_can_view_power_outages()
     or not public.current_user_can_view_activities() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  if clean_activity_type not in (
    'phone_call', 'email', 'in_person_meeting', 'work_log', 'other'
  ) then
    raise exception 'Neplatny typ dalsiho kroku.' using errcode = '22023';
  end if;
  if length(clean_title) not between 1 and 240 then
    raise exception 'Nazev dalsiho kroku musi mit 1 az 240 znaku.' using errcode = '22023';
  end if;
  if clean_description is not null and length(clean_description) > 5000 then
    raise exception 'Poznamka muze mit nejvyse 5 000 znaku.' using errcode = '22023';
  end if;
  if requested_scheduled_for is null or requested_scheduled_for <= now() then
    raise exception 'Termin dalsiho kroku musi byt v budoucnosti.' using errcode = '22023';
  end if;

  select assignment.owner_id
  into assignment_owner_id
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id
  for update;

  if assignment_owner_id is null then
    raise exception 'Zaznam nejprve priradte uzivateli.' using errcode = 'P0001';
  end if;
  if assignment_owner_id <> current_user_id then
    raise exception 'Dalsi krok muze spravovat pouze vlastnik zaznamu.' using errcode = '42501';
  end if;

  select nullif(btrim(profile.name), '')
  into current_user_name
  from public.profiles profile
  where profile.id = current_user_id;

  select link.activity_id
  into current_activity_id
  from public.complete_power_outage_communication_activity_links link
  where link.candidate_id = requested_candidate_id
    and link.is_current
  for update;

  if current_activity_id is null then
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
      completion_result,
      reminder_enabled,
      reminder_sent_at,
      reminder_skipped_at,
      metadata
    ) values (
      current_user_id,
      current_user_id,
      null,
      'manual',
      clean_activity_type,
      clean_title,
      clean_description,
      'planned',
      now(),
      requested_scheduled_for,
      null,
      null,
      coalesce(requested_reminder_enabled, false),
      null,
      null,
      jsonb_build_object(
        'contract', 'complete-communication-activity-link-v1',
        'completePowerOutageCandidateId', requested_candidate_id
      )
    )
    returning * into activity_row;

    insert into public.complete_power_outage_communication_activity_links (
      activity_id,
      candidate_id,
      created_by
    ) values (
      activity_row.id,
      requested_candidate_id,
      current_user_id
    );

    insert into public.complete_power_outage_communication_events (
      candidate_id,
      event_kind,
      actor_kind,
      actor_user_id,
      actor_name,
      body,
      occurred_at,
      source_event_key,
      metadata
    ) values (
      requested_candidate_id,
      'follow_up_created',
      'user',
      current_user_id,
      current_user_name,
      clean_description,
      now(),
      'follow-up:' || activity_row.id::text || ':created',
      jsonb_build_object(
        'contract', 'complete-communication-activity-link-v1',
        'activityId', activity_row.id,
        'title', activity_row.title,
        'activityType', activity_row.activity_type,
        'scheduledFor', activity_row.scheduled_for,
        'reminderEnabled', activity_row.reminder_enabled
      )
    );
  else
    select *
    into activity_row
    from public.activities activity
    where activity.id = current_activity_id
    for update;

    if activity_row.user_id <> current_user_id
       or activity_row.created_by <> current_user_id
       or activity_row.origin <> 'manual'
       or activity_row.status <> 'planned'
       or activity_row.deleted_at is not null then
      raise exception 'Propojene pripomenuti jiz nelze upravit.' using errcode = 'P0001';
    end if;

    update public.activities activity
    set
      activity_type = clean_activity_type,
      title = clean_title,
      description = clean_description,
      scheduled_for = requested_scheduled_for,
      reminder_enabled = coalesce(requested_reminder_enabled, false),
      reminder_sent_at = case
        when activity.scheduled_for is distinct from requested_scheduled_for
          or activity.reminder_enabled is distinct from coalesce(requested_reminder_enabled, false)
        then null
        else activity.reminder_sent_at
      end,
      reminder_skipped_at = case
        when activity.scheduled_for is distinct from requested_scheduled_for
          or activity.reminder_enabled is distinct from coalesce(requested_reminder_enabled, false)
        then null
        else activity.reminder_skipped_at
      end
    where activity.id = current_activity_id
    returning * into activity_row;
  end if;

  return jsonb_build_object(
    'status', 'planned',
    'activityId', activity_row.id,
    'candidateId', requested_candidate_id,
    'activityType', activity_row.activity_type,
    'title', activity_row.title,
    'description', activity_row.description,
    'scheduledFor', activity_row.scheduled_for,
    'reminderEnabled', activity_row.reminder_enabled
  );
end;
$$;

create or replace function public.finish_complete_power_outage_communication_follow_up_v1(
  requested_candidate_id uuid,
  requested_completion_result text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  activity_row public.activities%rowtype;
  clean_result text := nullif(btrim(coalesce(requested_completion_result, '')), '');
begin
  if current_user_id is null
     or not public.current_user_can_view_power_outages()
     or not public.current_user_can_view_activities() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;
  if clean_result is not null and length(clean_result) > 5000 then
    raise exception 'Vysledek muze mit nejvyse 5 000 znaku.' using errcode = '22023';
  end if;

  select activity.*
  into activity_row
  from public.complete_power_outage_communication_activity_links link
  join public.activities activity on activity.id = link.activity_id
  where link.candidate_id = requested_candidate_id
    and link.is_current
  for update of link, activity;

  if not found then
    raise exception 'Aktivni dalsi krok nebyl nalezen.' using errcode = 'P0002';
  end if;
  if activity_row.user_id <> current_user_id
     or activity_row.created_by <> current_user_id
     or activity_row.origin <> 'manual'
     or activity_row.status <> 'planned'
     or activity_row.deleted_at is not null then
    raise exception 'Tento dalsi krok nemuzete dokoncit.' using errcode = '42501';
  end if;

  update public.activities activity
  set
    status = 'completed',
    completed_at = now(),
    completion_result = clean_result,
    occurred_at = now(),
    reminder_enabled = false,
    recurrence_unit = null,
    recurrence_interval = null
  where activity.id = activity_row.id
  returning * into activity_row;

  return jsonb_build_object(
    'status', 'completed',
    'activityId', activity_row.id,
    'candidateId', requested_candidate_id,
    'completedAt', activity_row.completed_at,
    'completionResult', activity_row.completion_result
  );
end;
$$;

create or replace function public.get_complete_power_outage_communication_follow_up_v1(
  requested_candidate_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_role text;
  assignment_owner_id uuid;
  activity_row public.activities%rowtype;
begin
  if current_user_id is null
     or not public.current_user_can_view_power_outages()
     or not public.current_user_can_view_activities() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  select profile.role
  into current_role
  from public.profiles profile
  where profile.id = current_user_id;

  select assignment.owner_id
  into assignment_owner_id
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id;

  if assignment_owner_id is distinct from current_user_id and current_role <> 'admin' then
    raise exception 'Tento dalsi krok nemuzete zobrazit.' using errcode = '42501';
  end if;

  select activity.*
  into activity_row
  from public.complete_power_outage_communication_activity_links link
  join public.activities activity on activity.id = link.activity_id
  where link.candidate_id = requested_candidate_id
    and link.is_current
    and activity.status = 'planned'
    and activity.deleted_at is null;

  if not found then
    return jsonb_build_object('status', 'not_planned', 'candidateId', requested_candidate_id);
  end if;

  return jsonb_build_object(
    'status', activity_row.status,
    'activityId', activity_row.id,
    'candidateId', requested_candidate_id,
    'activityType', activity_row.activity_type,
    'title', activity_row.title,
    'description', activity_row.description,
    'scheduledFor', activity_row.scheduled_for,
    'reminderEnabled', activity_row.reminder_enabled,
    'reminderSentAt', activity_row.reminder_sent_at,
    'createdAt', activity_row.created_at,
    'updatedAt', activity_row.updated_at
  );
end;
$$;

revoke all on function public.sync_cpo_communication_follow_up_activity_v1()
  from public, anon, authenticated;
revoke all on function public.save_complete_power_outage_communication_follow_up_v1(
  uuid, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_communication_follow_up_v1(
  uuid, text
) from public, anon, authenticated;
revoke all on function public.get_complete_power_outage_communication_follow_up_v1(uuid)
  from public, anon, authenticated;

grant execute on function public.save_complete_power_outage_communication_follow_up_v1(
  uuid, text, text, text, timestamptz, boolean
) to authenticated;
grant execute on function public.finish_complete_power_outage_communication_follow_up_v1(
  uuid, text
) to authenticated;
grant execute on function public.get_complete_power_outage_communication_follow_up_v1(uuid)
  to authenticated;
grant execute on function public.sync_cpo_communication_follow_up_activity_v1()
  to service_role;

notify pgrst, 'reload schema';
commit;

with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'COMPLETE communication activity link exists',
    to_regclass('public.complete_power_outage_communication_activity_links') is not null),
  ('FUNCTION', 'safe COMPLETE follow up create update complete and read exist',
    to_regprocedure(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'
    ) is not null
    and to_regprocedure(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'
    ) is not null
    and to_regprocedure(
      'public.get_complete_power_outage_communication_follow_up_v1(uuid)'
    ) is not null),
  ('TRIGGER', 'activity changes synchronize the COMPLETE communication timeline',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.activities'::regclass
        and trigger_row.tgname = 'activities_sync_cpo_communication_follow_up'
        and not trigger_row.tgisinternal
    )),
  ('GRANT', 'authenticated cannot enumerate or mutate communication activity links',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_activity_links',
      'SELECT,INSERT,UPDATE,DELETE'
    )),
  ('GRANT', 'follow up functions enforce outage and activity access',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%current_user_can_view_power_outages%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%current_user_can_view_activities%'),
  ('ISOLATION', 'follow up integration stays in COMPLETE scope',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%power_outage_client_email%'
    and pg_get_functiondef(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'::regprocedure
    ) not ilike '%power_outage_client_email%'),
  ('LOGIC', 'one current follow up per company outage is enforced',
    exists (
      select 1
      from pg_index index_row
      join pg_class index_class on index_class.oid = index_row.indexrelid
      where index_row.indrelid =
        'public.complete_power_outage_communication_activity_links'::regclass
        and index_class.relname = 'cpo_communication_activity_one_current_idx'
        and index_row.indisunique
        and pg_get_expr(index_row.indpred, index_row.indrelid) ilike '%is_current%'
    )),
  ('LOGIC', 'activity is the single source of reminder schedule and completion',
    not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_activity_links'
        and column_row.column_name in (
          'scheduled_for', 'completed_at', 'completion_result', 'reminder_enabled'
        )
    )),
  ('LOGIC', 'linked reminders appear as manual planned activities',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%''manual''%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%''planned''%'),
  ('LOGIC', 'completion from either section closes the same link',
    pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%old.status = ''planned'' and new.status = ''completed''%'
    and pg_get_functiondef(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'::regprocedure
    ) ilike '%update public.activities%'),
  ('LOGIC', 'activity edits append communication timeline evidence',
    pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%follow_up_rescheduled%'
    and pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%complete_power_outage_communication_events%'),
  ('RLS', 'communication activity links have RLS',
    coalesce((
      select table_row.relrowsecurity
      from pg_class table_row
      where table_row.oid =
        'public.complete_power_outage_communication_activity_links'::regclass
    ), false)),
  ('DATA', 'communication activity links contain no orphaned records',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      left join public.activities activity on activity.id = link.activity_id
      left join public.complete_power_outage_companies company
        on company.id = link.candidate_id
      where activity.id is null
         or company.id is null
         or activity.user_id <> link.created_by
         or activity.created_by <> link.created_by
    )),
  ('SAFETY', 'follow up functions do not send email or call external services',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%resend%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%http%'),
  ('STATE', 'activity reminder integration is ready without inconsistent current links',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      join public.activities activity on activity.id = link.activity_id
      where link.is_current is distinct from (
        activity.status = 'planned' and activity.deleted_at is null
      )
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
