begin;

do $$
begin
  if to_regprocedure('public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)') is null
     or to_regclass('public.complete_power_outage_communication_states') is null
     or to_regclass('public.complete_power_outage_company_assignments') is null
  then
    raise exception 'Chybi zavislosti pro prime planovani dalsiho kroku KOMPLETNI.';
  end if;
end
$$;

create or replace function public.save_complete_power_outage_communication_follow_up_v2(
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
  assignment_owner_name text;
begin
  if current_user_id is null
     or not public.current_user_can_view_power_outages()
     or not public.current_user_can_view_activities() then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_companies company
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

  if assignment_owner_id is null then
    raise exception 'Zaznam se nepodarilo prevzit.' using errcode = 'P0001';
  end if;
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
      'contract', 'complete-communication-follow-up-direct-claim-v1',
      'claimedByFollowUp', true
    )
  )
  on conflict (candidate_id) do nothing;

  return public.save_complete_power_outage_communication_follow_up_v1(
    requested_candidate_id,
    requested_activity_type,
    requested_title,
    requested_description,
    requested_scheduled_for,
    requested_reminder_enabled
  );
end;
$$;

revoke all on function public.save_complete_power_outage_communication_follow_up_v2(
  uuid, text, text, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.save_complete_power_outage_communication_follow_up_v2(
  uuid, text, text, text, timestamptz, boolean
) to authenticated;

notify pgrst, 'reload schema';
commit;
