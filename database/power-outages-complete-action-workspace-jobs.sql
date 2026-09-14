begin;

do $$
begin
  if to_regclass('public.complete_power_outage_action_workspace_state') is null
    or to_regclass('public.complete_power_outage_work_item_links') is null
    or to_regclass('public.complete_power_outage_communication_events') is null
    or to_regclass('public.complete_power_outage_company_assignments') is null
    or to_regclass('public.complete_power_outage_job_links') is null
    or to_regclass('public.jobs') is null
    or to_regprocedure('public.get_complete_power_outage_action_workspace_v1(uuid)') is null
    or to_regprocedure('public.link_complete_power_outage_work_item_v1(uuid,text,uuid)') is null
    or to_regprocedure('public.current_user_can_view_power_outages()') is null
  then
    raise exception 'Chybi zavislosti pro zakazky ve Sprave komunikace KOMPLETNI.';
  end if;
end
$$;

alter table public.complete_power_outage_work_item_links
  add column if not exists job_id uuid references public.jobs(id) on delete cascade;

alter table public.complete_power_outage_work_item_links
  drop constraint if exists cpo_work_item_links_kind_check;
alter table public.complete_power_outage_work_item_links
  add constraint cpo_work_item_links_kind_check
  check (item_kind in ('client', 'task', 'meeting', 'offer', 'job'));

alter table public.complete_power_outage_work_item_links
  drop constraint if exists cpo_work_item_links_target_check;
alter table public.complete_power_outage_work_item_links
  add constraint cpo_work_item_links_target_check check (
    num_nonnulls(client_id, task_id, meeting_id, offer_id, job_id) = 1
    and (item_kind <> 'client' or client_id is not null)
    and (item_kind <> 'task' or task_id is not null)
    and (item_kind <> 'meeting' or meeting_id is not null)
    and (item_kind <> 'offer' or offer_id is not null)
    and (item_kind <> 'job' or job_id is not null)
  );

create unique index if not exists cpo_work_item_links_job_uidx
  on public.complete_power_outage_work_item_links (candidate_id, job_id)
  where job_id is not null;

alter table public.complete_power_outage_communication_events
  drop constraint if exists cpo_communication_events_kind_check;
alter table public.complete_power_outage_communication_events
  add constraint cpo_communication_events_kind_check check (
    event_kind in (
      'legacy_note', 'manual_contact', 'status_changed', 'job_won',
      'job_reopened', 'follow_up_created', 'follow_up_rescheduled',
      'follow_up_completed', 'follow_up_cancelled', 'automatic_email_sent',
      'automatic_email_delivered', 'client_linked', 'task_created',
      'meeting_created', 'offer_created', 'job_created'
    )
  );

alter table public.complete_power_outage_communication_events
  drop constraint if exists cpo_communication_events_shape_check;
alter table public.complete_power_outage_communication_events
  add constraint cpo_communication_events_shape_check check (
    (event_kind = 'legacy_note' and source_note_id is not null and body is not null)
    or (event_kind = 'manual_contact' and communication_channel is not null and new_status is not null)
    or (event_kind = 'status_changed' and new_status is not null)
    or (event_kind = 'job_won' and new_status = 'job_won')
    or (event_kind = 'job_reopened' and previous_status = 'job_won' and new_status is not null and new_status <> 'job_won')
    or event_kind in (
      'follow_up_created', 'follow_up_rescheduled', 'follow_up_completed',
      'follow_up_cancelled', 'automatic_email_sent', 'automatic_email_delivered',
      'client_linked', 'task_created', 'meeting_created', 'offer_created',
      'job_created'
    )
  );

-- V2 zachovava puvodni projekci a nahrazuje pouze seznam zakazek sjednocenym,
-- opravnenim omezenym pohledem nad automatickymi a explicitnimi vazbami.
create or replace function public.get_complete_power_outage_action_workspace_v2(
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
  is_admin boolean := public.current_user_is_admin();
  can_view_jobs boolean := false;
  can_view_jobs_portal boolean := false;
  jobs_sales_scope text;
  base_workspace jsonb;
  visible_jobs jsonb;
begin
  base_workspace := public.get_complete_power_outage_action_workspace_v1(requested_candidate_id);

  select profile.role,
    coalesce(profile.can_view_jobs, false),
    coalesce(profile.can_view_jobs_portal, false),
    nullif(btrim(profile.jobs_sales_scope), '')
  into current_role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope
  from public.profiles profile
  where profile.id = current_user_id;

  with candidate_job_ids as (
    select automatic_link.job_id
    from public.complete_power_outage_job_links automatic_link
    where automatic_link.candidate_id = requested_candidate_id
    union
    select manual_link.job_id
    from public.complete_power_outage_work_item_links manual_link
    where manual_link.candidate_id = requested_candidate_id
      and manual_link.item_kind = 'job'
      and manual_link.job_id is not null
  ), accessible_jobs as (
    select job.id, job.job_number,
      case when is_admin and can_view_jobs
        then 'jobs' else 'jobs_portal' end as destination
    from candidate_job_ids link
    join public.jobs job on job.id = link.job_id
    where (is_admin and can_view_jobs)
       or (can_view_jobs_portal and jobs_sales_scope is not null
         and job.sales_owner = jobs_sales_scope)
    order by job.job_number desc, job.id
    limit 100
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', job.id,
    'jobNumber', job.job_number,
    'destination', job.destination
  ) order by job.job_number desc, job.id), '[]'::jsonb)
  into visible_jobs
  from accessible_jobs job;

  return jsonb_set(
    jsonb_set(
      jsonb_set(base_workspace, '{contractVersion}', '3'::jsonb, true),
      '{capabilities,canCreateJob}',
      to_jsonb(is_admin),
      true
    ),
    '{jobs}', visible_jobs, true
  );
end;
$$;

revoke all on function public.get_complete_power_outage_action_workspace_v2(uuid)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_action_workspace_v2(uuid)
  to authenticated;

create or replace function public.link_complete_power_outage_work_item_v2(
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
  assignment_owner_id uuid;
  assignment_owner_name text;
  linked_client_id uuid;
  job_client_id uuid;
  job_number text;
  created_link_id uuid;
begin
  if requested_item_kind <> 'job' then
    return public.link_complete_power_outage_work_item_v1(
      requested_candidate_id, requested_item_kind, requested_item_id
    );
  end if;

  if current_user_id is null
    or not public.current_user_can_view_power_outages()
  then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  select nullif(btrim(profile.name), ''), profile.role
  into current_user_name, current_role
  from public.profiles profile
  where profile.id = current_user_id;

  if current_user_name is null then
    raise exception 'Profil prihlaseneho uzivatele nebyl nalezen.' using errcode = 'P0002';
  end if;

  if not public.current_user_is_admin() then
    raise exception 'Zakazku muze vytvorit a propojit pouze administrator.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.complete_power_outage_action_workspace_state state
    where state.singleton and state.ui_enabled
      and coalesce((state.metadata ->> 'jobsCreationEnabled')::boolean, false)
  ) then
    raise exception 'Vytvareni zakazek ze Spravy komunikace neni aktivni.' using errcode = '55000';
  end if;

  if not exists (
    select 1 from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  insert into public.complete_power_outage_company_assignments (
    candidate_id, owner_id, owner_name, communication_status, notes, updated_by
  ) values (
    requested_candidate_id, current_user_id, current_user_name,
    'not_contacted', '', current_user_id
  )
  on conflict on constraint complete_power_outage_company_assignments_pkey do nothing;

  select assignment.owner_id, assignment.owner_name
  into assignment_owner_id, assignment_owner_name
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id
  for update;

  -- Vytvoření zakázky je výhradně administrátorská akce. Administrátor ji
  -- může provést i u záznamu svěřeného jinému uživateli; vlastnictví přitom
  -- zůstává beze změny.

  select job.client_id, job.job_number
  into job_client_id, job_number
  from public.jobs job
  where job.id = requested_item_id;

  if job_client_id is null or nullif(btrim(job_number), '') is null then
    raise exception 'Zakazka nebyla nalezena.' using errcode = 'P0002';
  end if;

  select client_scope.client_id into linked_client_id
  from (
    select client_link.client_id
    from public.complete_power_outage_client_links client_link
    where client_link.candidate_id = requested_candidate_id
    union
    select work_link.client_id
    from public.complete_power_outage_work_item_links work_link
    where work_link.candidate_id = requested_candidate_id
      and work_link.item_kind = 'client'
      and work_link.client_id is not null
  ) client_scope
  where client_scope.client_id = job_client_id
  limit 1;

  if linked_client_id is null then
    raise exception 'Zakazka nepatri propojenemu klientovi teto odstavky.' using errcode = '23514';
  end if;

  insert into public.complete_power_outage_work_item_links (
    candidate_id, item_kind, job_id, linked_by, linked_by_name,
    title_snapshot, reference_snapshot, metadata
  ) values (
    requested_candidate_id, 'job', requested_item_id, current_user_id,
    current_user_name, 'Zakazka ' || job_number, null,
    jsonb_build_object(
      'contract', 'complete-action-workspace-jobs-v1',
      'source', 'communication-popup'
    )
  )
  on conflict do nothing
  returning id into created_link_id;

  if created_link_id is null then
    select link.id into created_link_id
    from public.complete_power_outage_work_item_links link
    where link.candidate_id = requested_candidate_id
      and link.item_kind = 'job'
      and link.job_id = requested_item_id;
  end if;

  insert into public.complete_power_outage_communication_events (
    candidate_id, event_kind, actor_kind, actor_user_id, actor_name,
    occurred_at, source_event_key, metadata
  ) values (
    requested_candidate_id, 'job_created', 'user', current_user_id,
    current_user_name, now(),
    'work-item:' || requested_candidate_id::text || ':job:' || requested_item_id::text,
    jsonb_build_object(
      'contract', 'complete-action-workspace-jobs-v1',
      'itemKind', 'job'
    )
  )
  on conflict (source_event_key) do nothing;

  return public.get_complete_power_outage_action_workspace_v2(requested_candidate_id);
end;
$$;

revoke all on function public.link_complete_power_outage_work_item_v2(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.link_complete_power_outage_work_item_v2(uuid, text, uuid)
  to authenticated;

update public.complete_power_outage_action_workspace_state as workspace_state
set contract_version = greatest(workspace_state.contract_version, 3),
    ui_enabled = true,
    metadata = workspace_state.metadata || jsonb_build_object(
      'stage', 'jobs-and-final-audit',
      'newWorkItemMutationsEnabled', true,
      'jobsCreationEnabled', true,
      'jobsCreationPolicy', 'admin-only-any-record',
      'portalVisibilityPolicy', 'jobs-sales-scope',
      'communicationStatusIndependent', true,
      'directEmailEnabled', false,
      'externalRequestsEnabled', false
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;
