with latest_event as (
  select distinct on (event.candidate_id)
    event.candidate_id,
    event.event_kind,
    event.owner_id
  from public.complete_power_outage_company_ownership_events event
  order by event.candidate_id, event.event_sequence desc
), checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'append only COMPLETE ownership history exists',
    to_regclass('public.complete_power_outage_company_ownership_events') is not null),
  ('RLS', 'COMPLETE ownership history has row level security',
    coalesce((
      select table_row.relrowsecurity
      from pg_class table_row
      where table_row.oid = 'public.complete_power_outage_company_ownership_events'::regclass
    ), false)),
  ('GRANT', 'authenticated cannot enumerate or mutate ownership history',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_company_ownership_events',
      'SELECT,INSERT,UPDATE,DELETE'
    )),
  ('FUNCTION', 'automatic COMPLETE ownership history capture exists',
    to_regprocedure('public.capture_cpo_company_ownership_event_v1()') is not null),
  ('TRIGGER', 'assignment changes automatically append ownership history',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_company_assignments'::regclass
        and trigger_row.tgname = 'cpo_company_assignments_capture_ownership'
        and not trigger_row.tgisinternal
    )),
  ('TRIGGER', 'ownership history events are immutable',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_company_ownership_events'::regclass
        and trigger_row.tgname = 'cpo_company_ownership_events_immutable'
        and not trigger_row.tgisinternal
    )),
  ('LOGIC', 'ownership history supports assigned transferred and released',
    (select count(*) = 3
     from unnest(array['assigned', 'transferred', 'released']) expected(event_kind)
     where pg_get_constraintdef((
       select constraint_row.oid
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.complete_power_outage_company_ownership_events'::regclass
         and constraint_row.conname = 'cpo_company_ownership_events_kind_check'
     )) ilike '%' || expected.event_kind || '%')),
  ('LOGIC', 'ordinary communication edits do not create ownership events',
    pg_get_functiondef('public.capture_cpo_company_ownership_event_v1()'::regprocedure)
      ilike '%new.owner_id is not distinct from old.owner_id%'),
  ('LOGIC', 'ownership events preserve company and outage snapshots',
    exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_company_ownership_events'
        and column_row.column_name = 'company_name_snapshot'
    )
    and exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_company_ownership_events'
        and column_row.column_name = 'outage_id_snapshot'
    )
    and exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_company_ownership_events'
        and column_row.column_name = 'event_sequence'
        and column_row.is_identity = 'YES'
    )),
  ('DATA', 'every current assignment has ownership history',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      left join latest_event event on event.candidate_id = assignment.candidate_id
      where event.candidate_id is null
    )),
  ('DATA', 'latest ownership event matches every current assignment',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      join latest_event event on event.candidate_id = assignment.candidate_id
      where event.event_kind = 'released'
         or event.owner_id is distinct from assignment.owner_id
    )),
  ('DATA', 'ownership history contains no invalid event shape',
    not exists (
      select 1
      from public.complete_power_outage_company_ownership_events event
      where event.company_name_snapshot is null
         or event.event_kind = 'assigned' and (event.previous_owner_id is not null or event.owner_id is null)
         or event.event_kind = 'released' and (event.previous_owner_id is null or event.owner_id is not null)
         or event.event_kind = 'transferred' and (
           event.previous_owner_id is null
           or event.owner_id is null
           or event.previous_owner_id = event.owner_id
         )
    )),
  ('DATA', 'ownership bootstrap contains no duplicate candidate',
    not exists (
      select event.candidate_id
      from public.complete_power_outage_company_ownership_events event
      where event.source_event_key like 'bootstrap:%'
      group by event.candidate_id
      having count(*) > 1
    )),
  ('ISOLATION', 'ownership history stays in COMPLETE scope',
    pg_get_functiondef('public.capture_cpo_company_ownership_event_v1()'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('SAFETY', 'ownership history installation changes no assignment function',
    to_regprocedure('public.save_complete_power_outage_company_assignment(uuid,text,text)') is not null
    and to_regprocedure('public.release_complete_power_outage_company_assignment(uuid)') is not null),
  ('SAFETY', 'ownership history creates no automation or external request',
    pg_get_functiondef('public.capture_cpo_company_ownership_event_v1()'::regprocedure) not ilike '%http%'
    and pg_get_functiondef('public.capture_cpo_company_ownership_event_v1()'::regprocedure) not ilike '%resend%'
    and not exists (
      select 1
      from cron.job job
      where job.command ilike '%complete_power_outage_company_ownership_events%'
    )),
  ('STATE', 'COMPLETE team overview data foundation version one is prepared',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      left join latest_event event on event.candidate_id = assignment.candidate_id
      where event.owner_id is distinct from assignment.owner_id
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
