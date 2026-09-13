with latest_ownership_event as (
  select distinct on (event.candidate_id)
    event.candidate_id,
    event.event_kind,
    event.owner_id
  from public.complete_power_outage_company_ownership_events event
  order by event.candidate_id, event.event_sequence desc
), function_definitions as (
  select
    pg_get_functiondef(
      'public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'::regprocedure
    ) as overview_definition,
    pg_get_functiondef(
      'public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)'::regprocedure
    ) as records_definition,
    pg_get_functiondef(
      'public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)'::regprocedure
    ) as scope_definition
), checks(check_type, object_name, is_correct) as (
  values
    ('DATA', 'every current assignment has ownership history',
      not exists (
        select 1
        from public.complete_power_outage_company_assignments assignment
        left join latest_ownership_event event on event.candidate_id = assignment.candidate_id
        where event.candidate_id is null
      )),
    ('DATA', 'latest ownership event matches every current assignment',
      not exists (
        select 1
        from public.complete_power_outage_company_assignments assignment
        join latest_ownership_event event on event.candidate_id = assignment.candidate_id
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
    ('FUNCTION', 'admin COMPLETE team overview analytics exists',
      to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)') is not null),
    ('FUNCTION', 'admin COMPLETE team worklists exist',
      to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)') is not null),
    ('FUNCTION', 'automatic COMPLETE ownership history capture exists',
      to_regprocedure('public.capture_cpo_company_ownership_event_v1()') is not null),
    ('GRANT', 'authenticated cannot execute private team filter scope',
      not coalesce(has_function_privilege(
        'authenticated',
        'public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)',
        'EXECUTE'
      ), false)),
    ('GRANT', 'authenticated cannot enumerate or mutate ownership history',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_company_ownership_events',
        'SELECT,INSERT,UPDATE,DELETE'
      )),
    ('GRANT', 'team overview operations enforce administrator role',
      (select position('current_user_is_admin' in overview_definition) > 0
          and position('current_user_is_admin' in records_definition) > 0
       from function_definitions)),
    ('ISOLATION', 'team overview remains in COMPLETE scope',
      (select position('power_outage_market' in lower(overview_definition)) = 0
          and position('power_outage_market' in lower(records_definition)) = 0
          and position('power_outage_market' in lower(scope_definition)) = 0
       from function_definitions)),
    ('LOGIC', 'current workload uses the current assignment owner',
      (select position('scope.current_owner_id' in overview_definition) > 0
       from function_definitions)),
    ('LOGIC', 'job outcomes are attributed to the recording user',
      (select position('event_row.actor_user_id' in overview_definition) > 0
          and position('event_row.event_kind = ''job_won''' in overview_definition) > 0
       from function_definitions)),
    ('LOGIC', 'team overview supports period owner selector and distributor filters',
      (select position('requested_period_basis' in scope_definition) > 0
          and position('requested_owner_id' in scope_definition) > 0
          and position('requested_selector_key' in scope_definition) > 0
          and position('requested_source' in scope_definition) > 0
       from function_definitions)),
    ('LOGIC', 'attention worklist detects every approved attention reason',
      (select position('overdue_follow_up' in records_definition) > 0
          and position('past_outage_open' in records_definition) > 0
          and position('missing_follow_up' in records_definition) > 0
          and position('approaching_uncontacted' in records_definition) > 0
          and position('stale_communication' in records_definition) > 0
       from function_definitions)),
    ('LOGIC', 'reminder metrics use Pracovni agenda as source of truth',
      (select position('public.activities' in overview_definition) > 0
       from function_definitions)),
    ('RLS', 'COMPLETE ownership history retains row level security',
      coalesce((
        select relation.relrowsecurity
        from pg_class relation
        where relation.oid = 'public.complete_power_outage_company_ownership_events'::regclass
      ), false)),
    ('SAFETY', 'team overview analytics are read only',
      (select position('insert into' in lower(overview_definition)) = 0
          and position('update ' in lower(overview_definition)) = 0
          and position('delete from' in lower(overview_definition)) = 0
          and position('insert into' in lower(records_definition)) = 0
          and position('update ' in lower(records_definition)) = 0
          and position('delete from' in lower(records_definition)) = 0
       from function_definitions)),
    ('SAFETY', 'team overview creates no automation or external request',
      (select position('cron.schedule' in lower(overview_definition)) = 0
          and position('net.http' in lower(overview_definition)) = 0
          and position('cron.schedule' in lower(records_definition)) = 0
          and position('net.http' in lower(records_definition)) = 0
       from function_definitions)),
    ('STATE', 'COMPLETE team overview version one is ready',
      to_regclass('public.complete_power_outage_company_ownership_events') is not null
      and to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)') is not null
      and to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)') is not null),
    ('TABLE', 'append only COMPLETE ownership history exists',
      to_regclass('public.complete_power_outage_company_ownership_events') is not null),
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
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
