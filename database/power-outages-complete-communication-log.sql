begin;

create table if not exists public.complete_power_outage_company_notes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  author_name text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint cpo_company_notes_author_name_check
    check (length(btrim(author_name)) between 1 and 120),
  constraint cpo_company_notes_body_check
    check (length(btrim(body)) between 1 and 10000),
  constraint cpo_company_notes_entry_unique
    unique (candidate_id, author_id, created_at)
);

comment on table public.complete_power_outage_company_notes is
  'Neměnný chronologický deník komunikace ke kandidátní firmě v režimu KOMPLETNÍ.';

create index if not exists cpo_company_notes_timeline_idx
  on public.complete_power_outage_company_notes (candidate_id, created_at desc);

alter table public.complete_power_outage_company_notes enable row level security;

drop policy if exists complete_power_outage_company_notes_authorized_read
  on public.complete_power_outage_company_notes;
create policy complete_power_outage_company_notes_authorized_read
  on public.complete_power_outage_company_notes
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_company_notes
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_notes to authenticated;

-- Zachová dříve uloženou průběžnou poznámku jako první položku historie.
insert into public.complete_power_outage_company_notes (
  candidate_id,
  author_id,
  author_name,
  body,
  created_at
)
select
  assignment.candidate_id,
  assignment.updated_by,
  assignment.owner_name,
  assignment.notes,
  assignment.updated_at
from public.complete_power_outage_company_assignments assignment
where length(btrim(assignment.notes)) > 0
  and not exists (
    select 1
    from public.complete_power_outage_company_notes note
    where note.candidate_id = assignment.candidate_id
      and note.author_id = assignment.updated_by
      and note.created_at = assignment.updated_at
  );

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
  clean_note text := btrim(coalesce(p_notes, ''));
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Pro tuto akci nemáte oprávnění.' using errcode = '42501';
  end if;
  if p_communication_status not in ('not_contacted', 'contacted', 'follow_up', 'closed') then
    raise exception 'Neplatný stav komunikace.' using errcode = '22023';
  end if;
  if length(clean_note) > 10000 then
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
    clean_note,
    current_user_id
  )
  on conflict on constraint complete_power_outage_company_assignments_pkey do update set
    communication_status = excluded.communication_status,
    notes = case when clean_note = '' then assignment.notes else clean_note end,
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

  if clean_note <> '' then
    insert into public.complete_power_outage_company_notes (
      candidate_id, author_id, author_name, body
    ) values (
      p_candidate_id, current_user_id, profile_name, clean_note
    );
  end if;

  return next;
end;
$$;

revoke all on function public.save_complete_power_outage_company_assignment(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.save_complete_power_outage_company_assignment(uuid,text,text)
  to authenticated;

drop trigger if exists complete_power_outage_company_notes_publish_app_change
  on public.complete_power_outage_company_notes;
create trigger complete_power_outage_company_notes_publish_app_change
after insert or update or delete on public.complete_power_outage_company_notes
for each statement execute function public.publish_complete_power_outage_assignments_app_change();

commit;

select 'TABLE' as check_type,
       'complete_power_outage_company_notes' as object_name,
       to_regclass('public.complete_power_outage_company_notes') is not null as is_correct
union all
select 'RLS', 'complete_power_outage_company_notes',
       coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_company_notes'::regclass), false)
union all
select 'FUNCTION', 'save assignment appends communication note',
       to_regprocedure('public.save_complete_power_outage_company_assignment(uuid,text,text)') is not null
union all
select 'TRIGGER', 'complete communication notes realtime',
       exists (
         select 1 from pg_trigger
         where tgrelid = 'public.complete_power_outage_company_notes'::regclass
           and tgname = 'complete_power_outage_company_notes_publish_app_change'
           and not tgisinternal
       )
order by check_type, object_name;
