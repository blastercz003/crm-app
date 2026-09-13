begin;

-- Sprava komunikace KOMPLETNI, krok 3:
-- strukturovany zapis, aktualni stav a sjednocena casova osa pro popup.
do $$
begin
  if to_regclass('public.complete_power_outage_communication_states') is null
     or to_regclass('public.complete_power_outage_communication_events') is null
     or to_regclass('public.complete_power_outage_communication_activity_links') is null
     or to_regclass('public.complete_power_outage_notification_email_plans') is null
     or to_regclass('public.cpo_notification_email_production_outcomes') is null
     or to_regclass('public.cpo_notification_email_production_safety_events') is null
     or to_regclass('public.complete_power_outage_notification_email_pilot_send_outcomes') is null
     or to_regclass('public.complete_power_outage_notification_email_pilot_safety_events') is null
  then
    raise exception 'Chybi zavislosti pro workspace komunikace KOMPLETNI.';
  end if;
end
$$;

create or replace function public.record_complete_power_outage_communication_v1(
  requested_candidate_id uuid,
  requested_channel text,
  requested_status text,
  requested_contact_person text,
  requested_note text,
  requested_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_name text;
  assignment_row public.complete_power_outage_company_assignments%rowtype;
  state_row public.complete_power_outage_communication_states%rowtype;
  previous_status text := 'not_contacted';
  clean_channel text := lower(btrim(coalesce(requested_channel, '')));
  clean_status text := lower(btrim(coalesce(requested_status, '')));
  clean_contact_person text := nullif(btrim(coalesce(requested_contact_person, '')), '');
  clean_note text := nullif(btrim(coalesce(requested_note, '')), '');
  event_kind text := 'manual_contact';
  legacy_status text;
  effective_occurred_at timestamptz := coalesce(requested_occurred_at, now());
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;
  if clean_channel not in ('phone', 'email', 'in_person', 'other') then
    raise exception 'Vyberte platny zpusob komunikace.' using errcode = '22023';
  end if;
  if clean_status not in (
    'contacted', 'unreachable', 'interested', 'offer_sent',
    'job_won', 'closed_no_job'
  ) then
    raise exception 'Vyberte platny stav komunikace.' using errcode = '22023';
  end if;
  if clean_note is null or length(clean_note) > 10000 then
    raise exception 'Zapis komunikace musi mit 1 az 10 000 znaku.' using errcode = '22023';
  end if;
  if clean_contact_person is not null and length(clean_contact_person) > 200 then
    raise exception 'Kontaktni osoba muze mit nejvyse 200 znaku.' using errcode = '22023';
  end if;
  if effective_occurred_at > now() + interval '5 minutes' then
    raise exception 'Cas komunikace nemuze byt v budoucnosti.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  select nullif(btrim(profile.name), '')
  into current_user_name
  from public.profiles profile
  where profile.id = current_user_id;
  if current_user_name is null then
    raise exception 'Profil prihlaseneho uzivatele nebyl nalezen.' using errcode = 'P0002';
  end if;

  select assignment.*
  into assignment_row
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id
  for update;

  if found and assignment_row.owner_id <> current_user_id then
    raise exception 'Zaznam uz spravuje uzivatel %.', assignment_row.owner_name
      using errcode = '42501';
  end if;

  select state.*
  into state_row
  from public.complete_power_outage_communication_states state
  where state.candidate_id = requested_candidate_id
  for update;

  if found then
    previous_status := state_row.communication_status;
  elsif assignment_row.candidate_id is not null then
    previous_status := case assignment_row.communication_status
      when 'contacted' then 'contacted'
      when 'follow_up' then 'contacted'
      when 'closed' then 'closed_no_job'
      else 'not_contacted'
    end;
  end if;

  legacy_status := case
    when clean_status in ('contacted', 'unreachable') then 'contacted'
    when clean_status in ('interested', 'offer_sent') then 'follow_up'
    when clean_status in ('job_won', 'closed_no_job') then 'closed'
    else 'not_contacted'
  end;

  insert into public.complete_power_outage_company_assignments as assignment (
    candidate_id, owner_id, owner_name, communication_status, notes, updated_by
  ) values (
    requested_candidate_id, current_user_id, current_user_name,
    legacy_status, clean_note, current_user_id
  )
  on conflict on constraint complete_power_outage_company_assignments_pkey do update set
    owner_name = excluded.owner_name,
    communication_status = excluded.communication_status,
    notes = excluded.notes,
    updated_by = excluded.updated_by,
    updated_at = now()
  where assignment.owner_id = current_user_id
  returning * into assignment_row;

  if assignment_row.candidate_id is null then
    raise exception 'Zaznam mezitim prevzal jiny uzivatel.' using errcode = 'P0001';
  end if;

  insert into public.complete_power_outage_communication_states as state (
    candidate_id, communication_status, status_changed_at,
    status_changed_by, state_version, metadata
  ) values (
    requested_candidate_id, clean_status, effective_occurred_at,
    current_user_id, 1,
    jsonb_build_object('contract', 'complete-communication-workspace-v1')
  )
  on conflict (candidate_id) do update set
    communication_status = excluded.communication_status,
    status_changed_at = excluded.status_changed_at,
    status_changed_by = excluded.status_changed_by,
    state_version = state.state_version + 1,
    metadata = state.metadata || excluded.metadata,
    updated_at = now();

  if clean_status = 'job_won' and previous_status <> 'job_won' then
    event_kind := 'job_won';
  elsif previous_status = 'job_won' and clean_status <> 'job_won' then
    event_kind := 'job_reopened';
  end if;

  insert into public.complete_power_outage_communication_events (
    candidate_id, event_kind, actor_kind, actor_user_id, actor_name,
    communication_channel, previous_status, new_status, contact_person,
    body, occurred_at, metadata
  ) values (
    requested_candidate_id, event_kind, 'user', current_user_id,
    current_user_name, clean_channel, previous_status, clean_status,
    clean_contact_person, clean_note, effective_occurred_at,
    jsonb_build_object('contract', 'complete-communication-workspace-v1')
  );

  return jsonb_build_object(
    'status', 'saved',
    'candidateId', requested_candidate_id,
    'communicationStatus', clean_status,
    'isJobWon', clean_status = 'job_won',
    'assignment', jsonb_build_object(
      'ownerId', assignment_row.owner_id,
      'ownerName', assignment_row.owner_name,
      'communicationStatus', assignment_row.communication_status,
      'notes', assignment_row.notes,
      'claimedAt', assignment_row.claimed_at,
      'updatedAt', assignment_row.updated_at
    )
  );
end;
$$;

create or replace function public.get_complete_power_outage_communication_workspace_v1(
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
  workspace jsonb;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  select profile.role into current_role
  from public.profiles profile where profile.id = current_user_id;

  with candidate_scope as (
    select company.id, company.ico, address.outage_id
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    where company.id = requested_candidate_id
  ), assignment_data as (
    select assignment.*
    from public.complete_power_outage_company_assignments assignment
    where assignment.candidate_id = requested_candidate_id
  ), status_data as (
    select coalesce(
      (select state.communication_status
       from public.complete_power_outage_communication_states state
       where state.candidate_id = requested_candidate_id),
      (select case assignment.communication_status
         when 'contacted' then 'contacted'
         when 'follow_up' then 'contacted'
         when 'closed' then 'closed_no_job'
         else 'not_contacted' end
       from assignment_data assignment),
      'not_contacted'
    ) as communication_status
  ), communication_timeline as (
    select
      event.id::text as id,
      event.event_kind as kind,
      event.actor_name,
      event.communication_channel as channel,
      event.previous_status,
      event.new_status,
      event.contact_person,
      event.body,
      event.occurred_at,
      event.metadata
    from public.complete_power_outage_communication_events event
    where event.candidate_id = requested_candidate_id
  ), actual_sends as (
    select plan.id, outcome.created_at as occurred_at, 'production'::text as source
    from candidate_scope scope_row
    join public.complete_power_outage_notification_email_plans plan
      on plan.ico = scope_row.ico and plan.outage_id = scope_row.outage_id
    join public.cpo_notification_email_production_outcomes outcome
      on outcome.plan_id = plan.id and outcome.outcome = 'sent'
    union all
    select plan.id, outcome.created_at, 'pilot'::text
    from candidate_scope scope_row
    join public.complete_power_outage_notification_email_plans plan
      on plan.ico = scope_row.ico and plan.outage_id = scope_row.outage_id
    join public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      on outcome.plan_id = plan.id and outcome.outcome = 'sent'
  ), email_timeline as (
    select
      'email:' || send.source || ':sent:' || send.id::text as id,
      'automatic_email_sent'::text as kind,
      'System'::text as actor_name,
      'email'::text as channel,
      null::text as previous_status,
      null::text as new_status,
      null::text as contact_person,
      null::text as body,
      send.occurred_at,
      jsonb_build_object('source', send.source, 'planId', send.id) as metadata
    from actual_sends send
    union all
    select
      'email:' || send.source || ':delivered:' || send.id::text,
      'automatic_email_delivered', 'System', 'email',
      null, null, null, null, delivery.delivered_at,
      jsonb_build_object('source', send.source, 'planId', send.id)
    from actual_sends send
    join lateral (
      select max(event.created_at) as delivered_at
      from (
        select safety.created_at
        from public.cpo_notification_email_production_safety_events safety
        where send.source = 'production' and safety.plan_id = send.id
          and safety.signal_type = 'delivery_success'
        union all
        select safety.created_at
        from public.complete_power_outage_notification_email_pilot_safety_events safety
        where send.source = 'pilot' and safety.plan_id = send.id
          and safety.signal_type = 'delivery_success'
      ) event
    ) delivery on delivery.delivered_at is not null
  ), full_timeline as (
    select * from communication_timeline
    union all
    select * from email_timeline
  ), timeline_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', timeline.id,
      'kind', timeline.kind,
      'actorName', timeline.actor_name,
      'channel', timeline.channel,
      'previousStatus', timeline.previous_status,
      'newStatus', timeline.new_status,
      'contactPerson', timeline.contact_person,
      'body', timeline.body,
      'occurredAt', timeline.occurred_at,
      'metadata', timeline.metadata
    ) order by timeline.occurred_at desc, timeline.id desc), '[]'::jsonb) as items
    from (select * from full_timeline order by occurred_at desc, id desc limit 200) timeline
  ), follow_up_data as (
    select jsonb_build_object(
      'activityId', activity.id,
      'activityType', activity.activity_type,
      'title', activity.title,
      'description', activity.description,
      'scheduledFor', activity.scheduled_for,
      'reminderEnabled', activity.reminder_enabled,
      'reminderSentAt', activity.reminder_sent_at,
      'createdAt', activity.created_at,
      'updatedAt', activity.updated_at
    ) as value
    from public.complete_power_outage_communication_activity_links link
    join public.activities activity on activity.id = link.activity_id
    where link.candidate_id = requested_candidate_id
      and link.is_current
      and activity.status = 'planned'
      and activity.deleted_at is null
  )
  select jsonb_build_object(
    'candidateId', requested_candidate_id,
    'communicationStatus', status_data.communication_status,
    'isJobWon', status_data.communication_status = 'job_won',
    'assignment', case when assignment.owner_id is null then null else jsonb_build_object(
      'ownerId', assignment.owner_id,
      'ownerName', assignment.owner_name,
      'communicationStatus', assignment.communication_status,
      'notes', assignment.notes,
      'claimedAt', assignment.claimed_at,
      'updatedAt', assignment.updated_at
    ) end,
    'canEdit', assignment.owner_id is null or assignment.owner_id = current_user_id,
    'canRelease', assignment.owner_id is not null and (
      assignment.owner_id = current_user_id or current_role = 'admin'
    ),
    'followUp', (select value from follow_up_data),
    'timeline', timeline_json.items
  ) into workspace
  from status_data
  cross join timeline_json
  left join assignment_data assignment on true;

  return workspace;
end;
$$;

revoke all on function public.record_complete_power_outage_communication_v1(
  uuid, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_complete_power_outage_communication_workspace_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.record_complete_power_outage_communication_v1(
  uuid, text, text, text, text, timestamptz
) to authenticated;
grant execute on function public.get_complete_power_outage_communication_workspace_v1(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
