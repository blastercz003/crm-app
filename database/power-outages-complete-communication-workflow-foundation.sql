begin;

-- Sprava komunikace KOMPLETNI, krok 1:
-- datovy zaklad noveho workflow a jednotne casove osy. Soucasny popup dale
-- zapisuje do puvodnich tabulek; tato instalace nemeni zadnou aplikacni funkci.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_companies') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.complete_power_outage_companies'
    );
  end if;
  if to_regclass('public.complete_power_outage_company_assignments') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.complete_power_outage_company_assignments'
    );
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    missing_dependencies := array_append(
      missing_dependencies,
      'public.set_power_outage_updated_at()'
    );
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro workflow komunikace KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_communication_states (
  candidate_id uuid primary key
    references public.complete_power_outage_companies(id) on delete cascade,
  communication_status text not null default 'not_contacted',
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid references public.profiles(id) on delete set null,
  state_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_communication_states_status_check check (
    communication_status in (
      'not_contacted',
      'contacted',
      'unreachable',
      'interested',
      'offer_sent',
      'job_won',
      'closed_no_job'
    )
  ),
  constraint cpo_communication_states_version_check check (state_version > 0),
  constraint cpo_communication_states_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_communication_states_timestamps_check check (
    updated_at >= created_at
  )
);

comment on table public.complete_power_outage_communication_states is
  'Kanonicky aktualni stav komunikace ke konkretni firme a odstavce v rezimu KOMPLETNI. Stav job_won je jedinym zdrojem pravdy pro priznak Vznikla zakazka.';

create index if not exists cpo_communication_states_status_idx
  on public.complete_power_outage_communication_states (
    communication_status,
    updated_at desc,
    candidate_id
  );

-- Konzervativni prevod puvodnich ctyr stavu. Hodnota follow_up nepotvrzuje
-- projeveny zajem, proto se prevadi pouze na obecne contacted.
insert into public.complete_power_outage_communication_states (
  candidate_id,
  communication_status,
  status_changed_at,
  status_changed_by,
  metadata,
  created_at,
  updated_at
)
select
  assignment.candidate_id,
  case assignment.communication_status
    when 'not_contacted' then 'not_contacted'
    when 'contacted' then 'contacted'
    when 'follow_up' then 'contacted'
    when 'closed' then 'closed_no_job'
    else 'not_contacted'
  end,
  assignment.updated_at,
  assignment.updated_by,
  jsonb_build_object(
    'contract', 'complete-communication-workflow-foundation-v1',
    'importedFrom', 'complete_power_outage_company_assignments',
    'legacyStatus', assignment.communication_status
  ),
  assignment.claimed_at,
  assignment.updated_at
from public.complete_power_outage_company_assignments assignment
on conflict (candidate_id) do nothing;

create table if not exists public.complete_power_outage_communication_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  event_kind text not null,
  actor_kind text not null default 'user',
  actor_user_id uuid references public.profiles(id) on delete restrict,
  actor_name text,
  communication_channel text,
  previous_status text,
  new_status text,
  contact_person text,
  body text,
  occurred_at timestamptz not null default now(),
  source_event_key text unique,
  -- Volitelny odkaz na starsi denik. Nektera produkcni prostredi tuto
  -- pomocnou tabulku nikdy nepouzivala, proto zde zamerne neni cizi klic.
  source_note_id uuid unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_communication_events_kind_check check (
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
  ),
  constraint cpo_communication_events_actor_kind_check check (
    actor_kind in ('user', 'system')
  ),
  constraint cpo_communication_events_actor_check check (
    (actor_kind = 'user' and actor_user_id is not null)
    or (actor_kind = 'system' and actor_user_id is null)
  ),
  constraint cpo_communication_events_actor_name_check check (
    actor_name is null or length(btrim(actor_name)) between 1 and 120
  ),
  constraint cpo_communication_events_channel_check check (
    communication_channel is null
    or communication_channel in ('phone', 'email', 'in_person', 'other')
  ),
  constraint cpo_communication_events_previous_status_check check (
    previous_status is null
    or previous_status in (
      'not_contacted', 'contacted', 'unreachable', 'interested',
      'offer_sent', 'job_won', 'closed_no_job'
    )
  ),
  constraint cpo_communication_events_new_status_check check (
    new_status is null
    or new_status in (
      'not_contacted', 'contacted', 'unreachable', 'interested',
      'offer_sent', 'job_won', 'closed_no_job'
    )
  ),
  constraint cpo_communication_events_contact_person_check check (
    contact_person is null or length(btrim(contact_person)) between 1 and 200
  ),
  constraint cpo_communication_events_body_check check (
    body is null or length(btrim(body)) between 1 and 10000
  ),
  constraint cpo_communication_events_source_key_check check (
    source_event_key is null
    or length(btrim(source_event_key)) between 1 and 500
  ),
  constraint cpo_communication_events_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_communication_events_shape_check check (
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
  )
);

comment on table public.complete_power_outage_communication_events is
  'Nemenna jednotna casova osa komunikace, stavu, pripomenuti a systemovych udalosti ke konkretni firme a odstavce v rezimu KOMPLETNI.';

create index if not exists cpo_communication_events_timeline_idx
  on public.complete_power_outage_communication_events (
    candidate_id,
    occurred_at desc,
    created_at desc,
    id desc
  );

create index if not exists cpo_communication_events_kind_idx
  on public.complete_power_outage_communication_events (
    event_kind,
    occurred_at desc
  );

create or replace function public.prevent_cpo_communication_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie komunikace KOMPLETNI je nemenna; vlozte novou udalost.';
end;
$$;

drop trigger if exists cpo_communication_events_immutable
  on public.complete_power_outage_communication_events;
create trigger cpo_communication_events_immutable
before update or delete
on public.complete_power_outage_communication_events
for each row execute function public.prevent_cpo_communication_event_mutation();

-- Puvodni volne poznamky zachovame, pokud byl starsi denik v danem prostredi
-- nasazen. Dynamicke SQL zabrani chybe pri parsovani, kdyz tabulka neexistuje.
do $$
begin
  if to_regclass('public.complete_power_outage_company_notes') is not null then
    execute $legacy_notes$
      insert into public.complete_power_outage_communication_events (
        candidate_id,
        event_kind,
        actor_kind,
        actor_user_id,
        actor_name,
        body,
        occurred_at,
        source_note_id,
        metadata,
        created_at
      )
      select
        note.candidate_id,
        'legacy_note',
        'user',
        note.author_id,
        note.author_name,
        note.body,
        note.created_at,
        note.id,
        jsonb_build_object(
          'contract', 'complete-communication-workflow-foundation-v1',
          'importedFrom', 'complete_power_outage_company_notes'
        ),
        note.created_at
      from public.complete_power_outage_company_notes note
      on conflict (source_note_id) do nothing
    $legacy_notes$;
  end if;
end
$$;

drop trigger if exists cpo_communication_states_set_updated_at
  on public.complete_power_outage_communication_states;
create trigger cpo_communication_states_set_updated_at
before update on public.complete_power_outage_communication_states
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_communication_states
  enable row level security;
alter table public.complete_power_outage_communication_events
  enable row level security;

revoke all on table public.complete_power_outage_communication_states
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_communication_events
  from public, anon, authenticated;
grant all on table public.complete_power_outage_communication_states
  to service_role;
grant all on table public.complete_power_outage_communication_events
  to service_role;

revoke all on function public.prevent_cpo_communication_event_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_cpo_communication_event_mutation()
  to service_role;

notify pgrst, 'reload schema';
commit;

with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'canonical COMPLETE communication state exists',
    to_regclass('public.complete_power_outage_communication_states') is not null),
  ('TABLE', 'append only COMPLETE communication timeline exists',
    to_regclass('public.complete_power_outage_communication_events') is not null),
  ('RLS', 'COMPLETE communication workflow tables have RLS',
    coalesce((
      select bool_and(table_row.relrowsecurity)
      from pg_class table_row
      where table_row.oid in (
        'public.complete_power_outage_communication_states'::regclass,
        'public.complete_power_outage_communication_events'::regclass
      )
    ), false)),
  ('GRANT', 'authenticated cannot inspect or mutate communication workflow',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_states',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_events',
      'SELECT,INSERT,UPDATE,DELETE'
    )),
  ('DATA', 'every legacy assignment has a canonical communication state',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      left join public.complete_power_outage_communication_states state
        on state.candidate_id = assignment.candidate_id
      where state.candidate_id is null
    )),
  ('DATA', 'legacy note imports contain no duplicates',
    not exists (
      select event.source_note_id
      from public.complete_power_outage_communication_events event
      where event.source_note_id is not null
      group by event.source_note_id
      having count(*) > 1
    )),
  ('LOGIC', 'job outcome has one canonical source of truth',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_communication_states'::regclass
        and constraint_row.conname = 'cpo_communication_states_status_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%job_won%'
    )
    and not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_states'
        and column_row.column_name in ('job_won', 'has_job', 'job_created')
    )),
  ('LOGIC', 'all approved communication states are represented',
    (
      select count(*) = 7
      from unnest(array[
        'not_contacted', 'contacted', 'unreachable', 'interested',
        'offer_sent', 'job_won', 'closed_no_job'
      ]) as expected(status)
      where pg_get_constraintdef((
        select constraint_row.oid
        from pg_constraint constraint_row
        where constraint_row.conrelid =
          'public.complete_power_outage_communication_states'::regclass
          and constraint_row.conname = 'cpo_communication_states_status_check'
      )) ilike '%' || expected.status || '%'
    )),
  ('LOGIC', 'structured communication channels are constrained',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_communication_events'::regclass
        and constraint_row.conname = 'cpo_communication_events_channel_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%phone%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%email%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%in_person%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%other%'
    )),
  ('LOGIC', 'legacy follow up is conservatively mapped to contacted',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      join public.complete_power_outage_communication_states state
        on state.candidate_id = assignment.candidate_id
      where assignment.communication_status = 'follow_up'
        and state.metadata ->> 'importedFrom' =
          'complete_power_outage_company_assignments'
        and state.communication_status <> 'contacted'
    )),
  ('SAFETY', 'current assignment functions and status contract remain unchanged',
    pg_get_functiondef(
      'public.save_complete_power_outage_company_assignment(uuid,text,text)'::regprocedure
    ) ilike '%''not_contacted'', ''contacted'', ''follow_up'', ''closed''%'
    and exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_company_assignments'::regclass
        and constraint_row.conname = 'cpo_company_assignments_status_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%follow_up%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%closed%'
    )),
  ('SAFETY', 'step one creates no reminder or activity integration',
    to_regclass('public.complete_power_outage_communication_activity_links') is null),
  ('SAFETY', 'step one creates no workflow automation or sending trigger',
    not exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid in (
        'public.complete_power_outage_communication_states'::regclass,
        'public.complete_power_outage_communication_events'::regclass
      )
        and not trigger_row.tgisinternal
        and trigger_row.tgname not in (
          'cpo_communication_states_set_updated_at',
          'cpo_communication_events_immutable'
        )
    )),
  ('STATE', 'communication workflow foundation version one is prepared',
    not exists (
      select 1
      from public.complete_power_outage_communication_states state
      where state.communication_status not in (
        'not_contacted', 'contacted', 'unreachable', 'interested',
        'offer_sent', 'job_won', 'closed_no_job'
      )
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
