begin;

do $$
begin
  if to_regclass('public.complete_power_outage_action_workspace_state') is null
    or to_regclass('public.complete_power_outage_work_item_links') is null
    or to_regclass('public.complete_power_outage_communication_events') is null
    or to_regclass('public.complete_power_outage_company_assignments') is null
    or to_regclass('public.complete_power_outage_communication_states') is null
    or to_regprocedure('public.get_complete_power_outage_action_workspace_v1(uuid)') is null
    or to_regprocedure('public.current_user_can_view_power_outages()') is null
    or to_regprocedure('public.current_user_can_view_client(uuid)') is null
  then
    raise exception 'Chybi zavislosti pro aktivni pracovni akce Spravy komunikace KOMPLETNI.';
  end if;
end
$$;

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
      'automatic_email_delivered',
      'client_linked',
      'task_created',
      'meeting_created',
      'offer_created'
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
      'automatic_email_delivered',
      'client_linked',
      'task_created',
      'meeting_created',
      'offer_created'
    )
  );

create or replace function public.link_complete_power_outage_work_item_v1(
  requested_candidate_id uuid,
  requested_item_kind text,
  requested_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_name text;
  current_role text;
  current_can_view_offers boolean := false;
  assignment_owner_id uuid;
  assignment_owner_name text;
  item_title text;
  item_reference text;
  next_event_kind text;
  created_link_id uuid;
begin
  if current_user_id is null
    or not public.current_user_can_view_power_outages()
  then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  if requested_item_kind not in ('client', 'task', 'meeting', 'offer') then
    raise exception 'Neplatny druh pracovni polozky.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_action_workspace_state state
    where state.singleton
      and state.ui_enabled
      and coalesce((state.metadata ->> 'newWorkItemMutationsEnabled')::boolean, false)
  ) then
    raise exception 'Pracovni akce zatim nejsou aktivni.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  select
    nullif(btrim(profile.name), ''),
    profile.role,
    coalesce(profile.can_view_offers, false)
  into current_user_name, current_role, current_can_view_offers
  from public.profiles profile
  where profile.id = current_user_id;

  if current_user_name is null then
    raise exception 'Profil prihlaseneho uzivatele nebyl nalezen.' using errcode = 'P0002';
  end if;

  if requested_item_kind = 'client' then
    select client.name,
      case when nullif(btrim(client.ico), '') is not null
        then 'ICO ' || btrim(client.ico)
        else nullif(btrim(client.address), '')
      end
    into item_title, item_reference
    from public.clients client
    where client.id = requested_item_id
      and public.current_user_can_view_client(client.id);
    next_event_kind := 'client_linked';
  elsif requested_item_kind = 'task' then
    select task.title, task.due_date::text
    into item_title, item_reference
    from public.tasks task
    where task.id = requested_item_id
      and (
        current_role = 'admin'
        or task.created_by = current_user_id
        or task.assigned_to = current_user_id
      );
    next_event_kind := 'task_created';
  elsif requested_item_kind = 'meeting' then
    select coalesce(nullif(btrim(meeting.title), ''), nullif(btrim(meeting.company_name), ''), 'Schuzka'),
      meeting.meeting_datetime::text
    into item_title, item_reference
    from public.meetings meeting
    where meeting.id = requested_item_id
      and (
        current_role = 'admin'
        or meeting.created_by = current_user_id
        or meeting.assigned_user_id = current_user_id
      );
    next_event_kind := 'meeting_created';
  else
    select offer.title, offer.offer_number
    into item_title, item_reference
    from public.offers offer
    where offer.id = requested_item_id
      and (current_role = 'admin' or current_can_view_offers)
      and (current_role = 'admin' or offer.created_by = current_user_id);
    next_event_kind := 'offer_created';
  end if;

  if item_title is null then
    raise exception 'Pracovni polozka nebyla nalezena nebo k ni nemate pristup.' using errcode = '42501';
  end if;

  insert into public.complete_power_outage_company_assignments (
    candidate_id,
    owner_id,
    owner_name,
    communication_status,
    notes,
    updated_by
  ) values (
    requested_candidate_id,
    current_user_id,
    current_user_name,
    'not_contacted',
    '',
    current_user_id
  )
  on conflict on constraint complete_power_outage_company_assignments_pkey do nothing;

  select assignment.owner_id, assignment.owner_name
  into assignment_owner_id, assignment_owner_name
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id
  for update;

  if assignment_owner_id <> current_user_id then
    raise exception 'Zaznam uz spravuje uzivatel %.', assignment_owner_name using errcode = '42501';
  end if;

  insert into public.complete_power_outage_communication_states (
    candidate_id,
    communication_status,
    status_changed_at,
    status_changed_by,
    metadata
  ) values (
    requested_candidate_id,
    'not_contacted',
    now(),
    current_user_id,
    jsonb_build_object(
      'contract', 'complete-action-workspace-actions-v1',
      'claimedByWorkItem', requested_item_kind
    )
  )
  on conflict (candidate_id) do nothing;

  insert into public.complete_power_outage_work_item_links (
    candidate_id,
    item_kind,
    client_id,
    task_id,
    meeting_id,
    offer_id,
    linked_by,
    linked_by_name,
    title_snapshot,
    reference_snapshot,
    metadata
  ) values (
    requested_candidate_id,
    requested_item_kind,
    case when requested_item_kind = 'client' then requested_item_id end,
    case when requested_item_kind = 'task' then requested_item_id end,
    case when requested_item_kind = 'meeting' then requested_item_id end,
    case when requested_item_kind = 'offer' then requested_item_id end,
    current_user_id,
    current_user_name,
    item_title,
    item_reference,
    jsonb_build_object(
      'contract', 'complete-action-workspace-actions-v1',
      'source', 'communication-popup'
    )
  )
  on conflict do nothing
  returning id into created_link_id;

  if created_link_id is null then
    select link.id into created_link_id
    from public.complete_power_outage_work_item_links link
    where link.candidate_id = requested_candidate_id
      and (
        (requested_item_kind = 'client' and link.client_id = requested_item_id)
        or (requested_item_kind = 'task' and link.task_id = requested_item_id)
        or (requested_item_kind = 'meeting' and link.meeting_id = requested_item_id)
        or (requested_item_kind = 'offer' and link.offer_id = requested_item_id)
      );
  end if;

  insert into public.complete_power_outage_communication_events (
    candidate_id,
    event_kind,
    actor_kind,
    actor_user_id,
    actor_name,
    occurred_at,
    source_event_key,
    metadata
  ) values (
    requested_candidate_id,
    next_event_kind,
    'user',
    current_user_id,
    current_user_name,
    now(),
    'work-item:' || requested_candidate_id::text || ':' || requested_item_kind || ':' || requested_item_id::text,
    jsonb_build_object(
      'contract', 'complete-action-workspace-actions-v1',
      'workItemLinkId', created_link_id,
      'itemKind', requested_item_kind,
      'itemId', requested_item_id,
      'title', item_title,
      'reference', item_reference
    )
  )
  on conflict (source_event_key) do nothing;

  return public.get_complete_power_outage_action_workspace_v1(requested_candidate_id);
end;
$$;

revoke all on function public.link_complete_power_outage_work_item_v1(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.link_complete_power_outage_work_item_v1(uuid, text, uuid)
  to authenticated;

update public.complete_power_outage_action_workspace_state as workspace_state
set contract_version = greatest(contract_version, 2),
    ui_enabled = true,
    metadata = workspace_state.metadata || jsonb_build_object(
      'stage', 'active-work-item-actions',
      'newWorkItemMutationsEnabled', true,
      'directEmailEnabled', false,
      'externalRequestsEnabled', false,
      'jobsCreationEnabled', false
    ),
    updated_at = now()
where singleton;

commit;
