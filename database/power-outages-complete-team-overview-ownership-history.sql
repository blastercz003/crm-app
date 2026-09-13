begin;

do $$
begin
  if to_regclass('public.complete_power_outage_company_assignments') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_addresses') is null
     or to_regclass('public.complete_power_outages') is null
  then
    raise exception 'Chybi zavislosti pro historii vlastnictvi KOMPLETNI.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_company_ownership_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  candidate_id uuid not null,
  outage_id_snapshot uuid,
  company_name_snapshot text not null,
  ico_snapshot text,
  outage_starts_at_snapshot timestamptz,
  event_kind text not null,
  previous_owner_id uuid references public.profiles(id) on delete restrict,
  previous_owner_name text,
  owner_id uuid references public.profiles(id) on delete restrict,
  owner_name text,
  changed_by uuid references public.profiles(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  source_event_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_company_ownership_events_kind_check check (
    event_kind in ('assigned', 'transferred', 'released')
  ),
  constraint cpo_company_ownership_events_company_name_check check (
    length(btrim(company_name_snapshot)) between 1 and 500
  ),
  constraint cpo_company_ownership_events_previous_name_check check (
    previous_owner_name is null
    or length(btrim(previous_owner_name)) between 1 and 120
  ),
  constraint cpo_company_ownership_events_owner_name_check check (
    owner_name is null or length(btrim(owner_name)) between 1 and 120
  ),
  constraint cpo_company_ownership_events_source_key_check check (
    source_event_key is null
    or length(btrim(source_event_key)) between 1 and 500
  ),
  constraint cpo_company_ownership_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_company_ownership_events_shape_check check (
    (event_kind = 'assigned'
      and previous_owner_id is null
      and owner_id is not null
      and owner_name is not null)
    or (event_kind = 'released'
      and previous_owner_id is not null
      and previous_owner_name is not null
      and owner_id is null)
    or (event_kind = 'transferred'
      and previous_owner_id is not null
      and previous_owner_name is not null
      and owner_id is not null
      and owner_name is not null
      and previous_owner_id <> owner_id)
  )
);

comment on table public.complete_power_outage_company_ownership_events is
  'Nemenna historie prevzeti, predani a uvolneni firem v rezimu KOMPLETNI. Snapshoty zachovavaji analyticky kontext i po zmene zdrojovych dat.';

create index if not exists cpo_company_ownership_events_candidate_idx
  on public.complete_power_outage_company_ownership_events (
    candidate_id,
    event_sequence desc
  );

create index if not exists cpo_company_ownership_events_owner_idx
  on public.complete_power_outage_company_ownership_events (
    owner_id,
    occurred_at desc
  )
  where owner_id is not null;

create index if not exists cpo_company_ownership_events_previous_owner_idx
  on public.complete_power_outage_company_ownership_events (
    previous_owner_id,
    occurred_at desc
  )
  where previous_owner_id is not null;

create index if not exists cpo_company_ownership_events_outage_idx
  on public.complete_power_outage_company_ownership_events (
    outage_id_snapshot,
    occurred_at desc
  )
  where outage_id_snapshot is not null;

alter table public.complete_power_outage_company_ownership_events
  enable row level security;

revoke all on table public.complete_power_outage_company_ownership_events
  from public, anon, authenticated;
grant all on table public.complete_power_outage_company_ownership_events
  to service_role;

create or replace function public.prevent_cpo_company_ownership_event_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie vlastnictvi KOMPLETNI je nemenna; vlozte novou udalost.';
end;
$$;

revoke all on function public.prevent_cpo_company_ownership_event_mutation_v1()
  from public, anon, authenticated;
grant execute on function public.prevent_cpo_company_ownership_event_mutation_v1()
  to service_role;

drop trigger if exists cpo_company_ownership_events_immutable
  on public.complete_power_outage_company_ownership_events;
create trigger cpo_company_ownership_events_immutable
before update or delete
on public.complete_power_outage_company_ownership_events
for each row execute function public.prevent_cpo_company_ownership_event_mutation_v1();

create or replace function public.capture_cpo_company_ownership_event_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  effective_candidate_id uuid := case when tg_op = 'DELETE' then old.candidate_id else new.candidate_id end;
  effective_event_kind text;
  effective_changed_by uuid;
  snapshot_outage_id uuid;
  snapshot_company_name text;
  snapshot_ico text;
  snapshot_outage_starts_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.owner_id is not distinct from old.owner_id then
    return new;
  end if;

  if tg_op = 'INSERT' then
    effective_event_kind := 'assigned';
    effective_changed_by := coalesce(auth.uid(), new.updated_by, new.owner_id);
  elsif tg_op = 'DELETE' then
    effective_event_kind := 'released';
    effective_changed_by := coalesce(auth.uid(), old.updated_by, old.owner_id);
  else
    effective_event_kind := 'transferred';
    effective_changed_by := coalesce(auth.uid(), new.updated_by, new.owner_id);
  end if;

  select
    address.outage_id,
    company.company_name,
    company.ico,
    outage.starts_at
  into
    snapshot_outage_id,
    snapshot_company_name,
    snapshot_ico,
    snapshot_outage_starts_at
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where company.id = effective_candidate_id;

  if snapshot_company_name is null then
    select
      history.outage_id_snapshot,
      history.company_name_snapshot,
      history.ico_snapshot,
      history.outage_starts_at_snapshot
    into
      snapshot_outage_id,
      snapshot_company_name,
      snapshot_ico,
      snapshot_outage_starts_at
    from public.complete_power_outage_company_ownership_events history
    where history.candidate_id = effective_candidate_id
    order by history.event_sequence desc
    limit 1;
  end if;

  if snapshot_company_name is null then
    raise exception 'Pro udalost vlastnictvi chybi snapshot firmy %.', effective_candidate_id;
  end if;

  insert into public.complete_power_outage_company_ownership_events (
    candidate_id,
    outage_id_snapshot,
    company_name_snapshot,
    ico_snapshot,
    outage_starts_at_snapshot,
    event_kind,
    previous_owner_id,
    previous_owner_name,
    owner_id,
    owner_name,
    changed_by,
    occurred_at,
    metadata
  ) values (
    effective_candidate_id,
    snapshot_outage_id,
    snapshot_company_name,
    snapshot_ico,
    snapshot_outage_starts_at,
    effective_event_kind,
    case when tg_op in ('UPDATE', 'DELETE') then old.owner_id else null end,
    case when tg_op in ('UPDATE', 'DELETE') then old.owner_name else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.owner_id else null end,
    case when tg_op in ('INSERT', 'UPDATE') then new.owner_name else null end,
    effective_changed_by,
    case
      when tg_op = 'INSERT' then coalesce(new.claimed_at, now())
      else now()
    end,
    jsonb_build_object(
      'contract', 'complete-team-overview-ownership-history-v1',
      'source', 'assignment-trigger',
      'triggerOperation', lower(tg_op)
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.capture_cpo_company_ownership_event_v1()
  from public, anon, authenticated;
grant execute on function public.capture_cpo_company_ownership_event_v1()
  to service_role;

-- Krátký zámek zabrání mezeře mezi pořízením výchozího snímku a aktivací
-- triggeru. Čtení tabulky zůstává dostupné, blokují se pouze souběžné zápisy.
lock table public.complete_power_outage_company_assignments
  in share row exclusive mode;

-- Výchozí událost pro právě existující přiřazení. Neprovádí žádnou změnu
-- zdrojové tabulky a při opakovaném spuštění je idempotentní.
insert into public.complete_power_outage_company_ownership_events (
  candidate_id,
  outage_id_snapshot,
  company_name_snapshot,
  ico_snapshot,
  outage_starts_at_snapshot,
  event_kind,
  owner_id,
  owner_name,
  changed_by,
  occurred_at,
  source_event_key,
  metadata,
  created_at
)
select
  assignment.candidate_id,
  address.outage_id,
  company.company_name,
  company.ico,
  outage.starts_at,
  'assigned',
  assignment.owner_id,
  assignment.owner_name,
  assignment.updated_by,
  assignment.claimed_at,
  'bootstrap:' || assignment.candidate_id::text,
  jsonb_build_object(
    'contract', 'complete-team-overview-ownership-history-v1',
    'source', 'current-assignment-bootstrap',
    'snapshotCapturedAt', now()
  ),
  now()
from public.complete_power_outage_company_assignments assignment
join public.complete_power_outage_companies company
  on company.id = assignment.candidate_id
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id
on conflict (source_event_key) do nothing;

drop trigger if exists cpo_company_assignments_capture_ownership
  on public.complete_power_outage_company_assignments;
create trigger cpo_company_assignments_capture_ownership
after insert or update of owner_id, owner_name or delete
on public.complete_power_outage_company_assignments
for each row execute function public.capture_cpo_company_ownership_event_v1();

notify pgrst, 'reload schema';
commit;
