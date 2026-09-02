begin;

create table if not exists public.complete_power_outage_company_assignments (
  candidate_id uuid primary key
    references public.complete_power_outage_companies(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  owner_name text not null,
  communication_status text not null default 'not_contacted',
  notes text not null default '',
  claimed_at timestamptz not null default now(),
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint cpo_company_assignments_owner_name_check
    check (length(btrim(owner_name)) between 1 and 120),
  constraint cpo_company_assignments_status_check
    check (communication_status in ('not_contacted', 'contacted', 'follow_up', 'closed')),
  constraint cpo_company_assignments_notes_check
    check (length(notes) <= 10000)
);

comment on table public.complete_power_outage_company_assignments is
  'Ruční vlastnictví a stručný pracovní záznam ke kandidátní firmě v režimu KOMPLETNÍ.';

create index if not exists cpo_company_assignments_owner_idx
  on public.complete_power_outage_company_assignments (owner_id, updated_at desc);

alter table public.complete_power_outage_company_assignments enable row level security;

drop policy if exists complete_power_outage_company_assignments_authorized_read
  on public.complete_power_outage_company_assignments;
create policy complete_power_outage_company_assignments_authorized_read
  on public.complete_power_outage_company_assignments
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_company_assignments
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_assignments to authenticated;

create or replace function public.save_complete_power_outage_company_assignment(
  p_candidate_id uuid,
  p_communication_status text default 'not_contacted',
  p_notes text default ''
)
returns table (
  candidate_id uuid,
  owner_id uuid,
  owner_name text,
  communication_status text,
  notes text,
  claimed_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_owner_id uuid;
  current_owner_name text;
  profile_name text;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Pro tuto akci nemáte oprávnění.' using errcode = '42501';
  end if;
  if p_communication_status not in ('not_contacted', 'contacted', 'follow_up', 'closed') then
    raise exception 'Neplatný stav komunikace.' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 10000 then
    raise exception 'Poznámka může mít nejvýše 10 000 znaků.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.complete_power_outage_companies company
    where company.id = p_candidate_id
  ) then
    raise exception 'Firma nebyla nalezena.' using errcode = 'P0002';
  end if;

  select assignment.owner_id, assignment.owner_name
  into current_owner_id, current_owner_name
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = p_candidate_id
  for update;

  if current_owner_id is not null and current_owner_id <> current_user_id then
    raise exception 'Záznam už spravuje uživatel %.', current_owner_name using errcode = 'P0001';
  end if;

  select nullif(btrim(profile.name), '')
  into profile_name
  from public.profiles profile
  where profile.id = current_user_id;

  if profile_name is null then
    raise exception 'Profil přihlášeného uživatele nebyl nalezen.' using errcode = 'P0002';
  end if;

  insert into public.complete_power_outage_company_assignments as assignment (
    candidate_id, owner_id, owner_name, communication_status, notes, updated_by
  ) values (
    p_candidate_id,
    current_user_id,
    profile_name,
    p_communication_status,
    coalesce(p_notes, ''),
    current_user_id
  )
  on conflict on constraint complete_power_outage_company_assignments_pkey do update set
    communication_status = excluded.communication_status,
    notes = excluded.notes,
    owner_name = excluded.owner_name,
    updated_by = excluded.updated_by,
    updated_at = now()
  where assignment.owner_id = current_user_id
  returning
    assignment.candidate_id,
    assignment.owner_id,
    assignment.owner_name,
    assignment.communication_status,
    assignment.notes,
    assignment.claimed_at,
    assignment.updated_at
  into
    candidate_id,
    owner_id,
    owner_name,
    communication_status,
    notes,
    claimed_at,
    updated_at;

  if candidate_id is null then
    raise exception 'Záznam mezitím převzal jiný uživatel.' using errcode = 'P0001';
  end if;

  return next;
end;
$$;

create or replace function public.release_complete_power_outage_company_assignment(
  p_candidate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  assignment_owner_id uuid;
  current_role text;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Pro tuto akci nemáte oprávnění.' using errcode = '42501';
  end if;

  select assignment.owner_id
  into assignment_owner_id
  from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = p_candidate_id
  for update;

  if assignment_owner_id is null then
    return;
  end if;

  select profile.role into current_role
  from public.profiles profile
  where profile.id = current_user_id;

  if assignment_owner_id <> current_user_id and current_role <> 'admin' then
    raise exception 'Přiřazení může zrušit pouze jeho vlastník nebo administrátor.' using errcode = '42501';
  end if;

  delete from public.complete_power_outage_company_assignments assignment
  where assignment.candidate_id = p_candidate_id;
end;
$$;

revoke all on function public.save_complete_power_outage_company_assignment(uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.release_complete_power_outage_company_assignment(uuid)
  from public, anon, authenticated;
grant execute on function public.save_complete_power_outage_company_assignment(uuid,text,text)
  to authenticated;
grant execute on function public.release_complete_power_outage_company_assignment(uuid)
  to authenticated;

create or replace function public.publish_complete_power_outage_assignments_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(profile.id), array[]::uuid[])
  into recipient_ids
  from public.profiles profile
  where profile.role = 'admin'
     or profile.can_view_power_outages = true;

  perform public.publish_app_data_change('complete_power_outages', recipient_ids);
  return null;
end;
$$;

revoke all on function public.publish_complete_power_outage_assignments_app_change()
  from public, anon, authenticated;

drop trigger if exists complete_power_outage_assignments_publish_app_change
  on public.complete_power_outage_company_assignments;
create trigger complete_power_outage_assignments_publish_app_change
after insert or update or delete on public.complete_power_outage_company_assignments
for each statement execute function public.publish_complete_power_outage_assignments_app_change();

commit;

select 'TABLE' as check_type,
       'complete_power_outage_company_assignments' as object_name,
       to_regclass('public.complete_power_outage_company_assignments') is not null as is_correct
union all
select 'RLS', 'complete_power_outage_company_assignments',
       coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_company_assignments'::regclass), false)
union all
select 'FUNCTION', 'save complete outage assignment',
       to_regprocedure('public.save_complete_power_outage_company_assignment(uuid,text,text)') is not null
union all
select 'FUNCTION', 'release complete outage assignment',
       to_regprocedure('public.release_complete_power_outage_company_assignment(uuid)') is not null
union all
select 'TRIGGER', 'complete outage assignment realtime',
       exists (
         select 1 from pg_trigger
         where tgrelid = 'public.complete_power_outage_company_assignments'::regclass
           and tgname = 'complete_power_outage_assignments_publish_app_change'
           and not tgisinternal
       )
order by check_type, object_name;
