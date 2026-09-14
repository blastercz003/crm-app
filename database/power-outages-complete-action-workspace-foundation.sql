begin;

do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regclass('public.complete_power_outage_company_assignments') is null
    or to_regclass('public.complete_power_outage_client_links') is null
    or to_regclass('public.complete_power_outage_job_links') is null
    or to_regclass('public.clients') is null
    or to_regclass('public.tasks') is null
    or to_regclass('public.meetings') is null
    or to_regclass('public.offers') is null
    or to_regclass('public.jobs') is null
    or to_regclass('public.profiles') is null
    or to_regprocedure('public.current_user_can_view_power_outages()') is null
    or to_regprocedure('public.current_user_can_view_client(uuid)') is null
    or to_regprocedure('public.current_user_can_view_activities()') is null
    or to_regprocedure('public.complete_power_outage_normalize_client_ico(text)') is null
    or to_regprocedure('public.complete_power_outage_normalize_client_name(text)') is null
  then
    raise exception 'Chybi zavislosti pro pracovni centrum Spravy komunikace KOMPLETNI.';
  end if;
end
$$;

-- Stav zavadi pouze datovy kontrakt. Rozhrani se zapne az v dalsi etape.
create table if not exists public.complete_power_outage_action_workspace_state (
  singleton boolean primary key default true check (singleton),
  contract_version integer not null default 1 check (contract_version > 0),
  ui_enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.complete_power_outage_action_workspace_state (
  singleton,
  contract_version,
  ui_enabled,
  metadata
)
values (
  true,
  1,
  false,
  jsonb_build_object(
    'contract', 'complete-power-outage-action-workspace-v1',
    'stage', 'foundation',
    'directEmailEnabled', false,
    'externalRequestsEnabled', false,
    'jobsPolicy', 'admin-internal-portal-sales-scope'
  )
)
on conflict (singleton) do update
set contract_version = greatest(
      public.complete_power_outage_action_workspace_state.contract_version,
      excluded.contract_version
    ),
    ui_enabled = false,
    metadata = excluded.metadata,
    updated_at = now();

-- Vazby vzniknou az po uspesnem vytvoreni polozky v pozdejsi etape.
-- Samostatne sloupce zachovavaji skutecne cizi klice a kaskadove odstrani
-- pouze vazbu, nikoliv firmu, odstávku ani komunikaci.
create table if not exists public.complete_power_outage_work_item_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  item_kind text not null,
  client_id uuid references public.clients(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  linked_by uuid not null references public.profiles(id) on delete restrict,
  linked_by_name text not null,
  title_snapshot text not null,
  reference_snapshot text,
  metadata jsonb not null default '{}'::jsonb,
  linked_at timestamptz not null default now(),
  constraint cpo_work_item_links_kind_check
    check (item_kind in ('client', 'task', 'meeting', 'offer')),
  constraint cpo_work_item_links_target_check
    check (
      num_nonnulls(client_id, task_id, meeting_id, offer_id) = 1
      and (item_kind <> 'client' or client_id is not null)
      and (item_kind <> 'task' or task_id is not null)
      and (item_kind <> 'meeting' or meeting_id is not null)
      and (item_kind <> 'offer' or offer_id is not null)
    ),
  constraint cpo_work_item_links_actor_name_check
    check (btrim(linked_by_name) <> ''),
  constraint cpo_work_item_links_title_check
    check (btrim(title_snapshot) <> ''),
  constraint cpo_work_item_links_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_work_item_links_client_uidx
  on public.complete_power_outage_work_item_links (candidate_id, client_id)
  where client_id is not null;
create unique index if not exists cpo_work_item_links_task_uidx
  on public.complete_power_outage_work_item_links (candidate_id, task_id)
  where task_id is not null;
create unique index if not exists cpo_work_item_links_meeting_uidx
  on public.complete_power_outage_work_item_links (candidate_id, meeting_id)
  where meeting_id is not null;
create unique index if not exists cpo_work_item_links_offer_uidx
  on public.complete_power_outage_work_item_links (candidate_id, offer_id)
  where offer_id is not null;
create index if not exists cpo_work_item_links_candidate_timeline_idx
  on public.complete_power_outage_work_item_links (candidate_id, linked_at desc, id desc);

alter table public.complete_power_outage_action_workspace_state enable row level security;
alter table public.complete_power_outage_work_item_links enable row level security;

revoke all on table public.complete_power_outage_action_workspace_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_work_item_links
  from public, anon, authenticated;
grant all on table public.complete_power_outage_action_workspace_state to service_role;
grant all on table public.complete_power_outage_work_item_links to service_role;

create or replace function public.get_complete_power_outage_action_workspace_v1(
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
  can_view_offers boolean := false;
  can_view_jobs boolean := false;
  can_view_jobs_portal boolean := false;
  jobs_sales_scope text;
  assignment_owner_id uuid;
  can_edit_record boolean := false;
  can_manage_reminder boolean := false;
  result jsonb;
begin
  if current_user_id is null
    or not public.current_user_can_view_power_outages()
  then
    raise exception 'Pro tuto akci nemate opravneni.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_companies company
    where company.id = requested_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  select
    profile.role,
    coalesce(profile.can_view_offers, false),
    coalesce(profile.can_view_jobs, false),
    coalesce(profile.can_view_jobs_portal, false),
    nullif(btrim(profile.jobs_sales_scope), '')
  into
    current_role,
    can_view_offers,
    can_view_jobs,
    can_view_jobs_portal,
    jobs_sales_scope
  from public.profiles profile
  where profile.id = current_user_id;

  select assignment.owner_id
  into assignment_owner_id
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = requested_candidate_id;

  can_edit_record := assignment_owner_id is null
    or assignment_owner_id = current_user_id;
  can_manage_reminder := can_edit_record
    and public.current_user_can_view_activities();

  with candidate_context as (
    select
      company.id as candidate_id,
      company.company_name,
      company.ico,
      company.legal_form,
      company.display_address,
      address.id as outage_address_id,
      address.municipality,
      address.town_part,
      address.street,
      address.house_number,
      address.orientation_number,
      address.postal_code,
      address.raw_address,
      outage.id as outage_id,
      outage.source,
      outage.starts_at,
      outage.ends_at
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    where company.id = requested_candidate_id
  ), accessible_client_candidates as (
    select distinct on (client.id)
      client.id,
      client.name,
      client.ico,
      client.address,
      link.match_method,
      link.name_similarity
    from candidate_context candidate
    join public.complete_power_outage_client_links link
      on link.candidate_id = candidate.candidate_id
    join public.clients client on client.id = link.client_id
    where public.current_user_can_view_client(client.id)
    order by client.id,
      case link.match_method
        when 'ico_exact' then 1
        when 'name_exact' then 2
        else 3
      end,
      link.name_similarity desc
  ), manually_linked_clients as (
    select distinct on (client.id)
      client.id,
      client.name,
      client.ico,
      client.address,
      'manual'::text as match_method,
      1::numeric as name_similarity
    from public.complete_power_outage_work_item_links work_link
    join public.clients client on client.id = work_link.client_id
    where work_link.candidate_id = requested_candidate_id
      and work_link.item_kind = 'client'
      and public.current_user_can_view_client(client.id)
    order by client.id, work_link.linked_at desc
  ), all_accessible_clients as (
    select * from accessible_client_candidates
    union all
    select manual.*
    from manually_linked_clients manual
    where not exists (
      select 1 from accessible_client_candidates automatic
      where automatic.id = manual.id
    )
  ), visible_work_items as (
    select
      work_link.id,
      work_link.item_kind,
      work_link.title_snapshot,
      work_link.reference_snapshot,
      work_link.linked_by_name,
      work_link.linked_at
    from public.complete_power_outage_work_item_links work_link
    left join public.clients linked_client on linked_client.id = work_link.client_id
    left join public.tasks linked_task on linked_task.id = work_link.task_id
    left join public.meetings linked_meeting on linked_meeting.id = work_link.meeting_id
    left join public.offers linked_offer on linked_offer.id = work_link.offer_id
    where work_link.candidate_id = requested_candidate_id
      and (
        (work_link.item_kind = 'client'
          and public.current_user_can_view_client(linked_client.id))
        or (work_link.item_kind = 'task'
          and (current_role = 'admin'
            or linked_task.created_by = current_user_id
            or linked_task.assigned_to = current_user_id))
        or (work_link.item_kind = 'meeting'
          and (current_role = 'admin'
            or linked_meeting.created_by = current_user_id
            or linked_meeting.assigned_user_id = current_user_id))
        or (work_link.item_kind = 'offer'
          and (current_role = 'admin'
            or linked_offer.created_by = current_user_id))
      )
  ), accessible_jobs as (
    select
      job.id,
      job.job_number,
      case
        when current_role = 'admin' and can_view_jobs then 'jobs'
        else 'jobs_portal'
      end as destination
    from public.complete_power_outage_job_links job_link
    join public.jobs job on job.id = job_link.job_id
    where job_link.candidate_id = requested_candidate_id
      and (
        (current_role = 'admin' and can_view_jobs)
        or (
          can_view_jobs_portal
          and jobs_sales_scope is not null
          and job.sales_owner = jobs_sales_scope
        )
      )
    order by job.job_number desc, job.id
  ), client_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', client.id,
      'name', client.name,
      'ico', client.ico,
      'address', client.address,
      'matchMethod', client.match_method,
      'nameSimilarity', client.name_similarity
    ) order by
      case client.match_method
        when 'manual' then 0
        when 'ico_exact' then 1
        when 'name_exact' then 2
        else 3
      end,
      client.name), '[]'::jsonb) as items
    from all_accessible_clients client
  ), work_item_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'kind', item.item_kind,
      'title', item.title_snapshot,
      'reference', item.reference_snapshot,
      'actorName', item.linked_by_name,
      'createdAt', item.linked_at
    ) order by item.linked_at desc, item.id desc), '[]'::jsonb) as items
    from (select * from visible_work_items order by linked_at desc, id desc limit 100) item
  ), job_json as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', job.id,
      'jobNumber', job.job_number,
      'destination', job.destination
    ) order by job.job_number desc, job.id), '[]'::jsonb) as items
    from (select * from accessible_jobs limit 100) job
  )
  select jsonb_build_object(
    'contractVersion', 1,
    'uiEnabled', state.ui_enabled,
    'candidateId', candidate.candidate_id,
    'prefill', jsonb_build_object(
      'companyName', candidate.company_name,
      'ico', candidate.ico,
      'legalForm', candidate.legal_form,
      'address', coalesce(nullif(btrim(candidate.display_address), ''), candidate.raw_address),
      'municipality', candidate.municipality,
      'townPart', candidate.town_part,
      'street', candidate.street,
      'houseNumber', candidate.house_number,
      'orientationNumber', candidate.orientation_number,
      'postalCode', candidate.postal_code,
      'outageId', candidate.outage_id,
      'outageAddressId', candidate.outage_address_id,
      'source', candidate.source,
      'startsAt', candidate.starts_at,
      'endsAt', candidate.ends_at
    ),
    'ownership', jsonb_build_object(
      'ownerId', assignment_owner_id,
      'isUnassigned', assignment_owner_id is null,
      'canEdit', can_edit_record
    ),
    'capabilities', jsonb_build_object(
      'canCreateClient', can_edit_record,
      'canCreateTask', can_edit_record,
      'canCreateMeeting', can_edit_record,
      'canCreateOffer', can_edit_record
        and (current_role = 'admin' or can_view_offers),
      'canManageReminder', can_manage_reminder,
      'canCreateJob', can_edit_record and current_role = 'admin',
      'canViewInternalJobs', current_role = 'admin' and can_view_jobs,
      'canViewPortalJobs', can_view_jobs_portal and jobs_sales_scope is not null,
      'directEmailEnabled', false
    ),
    'clients', client_json.items,
    'workItems', work_item_json.items,
    'jobs', job_json.items
  ) into result
  from candidate_context candidate
  cross join public.complete_power_outage_action_workspace_state state
  cross join client_json
  cross join work_item_json
  cross join job_json
  where state.singleton;

  return result;
end;
$$;

revoke all on function public.get_complete_power_outage_action_workspace_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_action_workspace_v1(uuid)
  to authenticated;

commit;
