with checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'admin COMPLETE team overview analytics exists',
      to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)') is not null),
    ('FUNCTION', 'admin COMPLETE team worklists exist',
      to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)') is not null),
    ('FUNCTION', 'one shared COMPLETE team filter scope exists',
      to_regprocedure('public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)') is not null),
    ('GRANT', 'team overview analytics enforce administrator role',
      coalesce(position('current_user_is_admin' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)
      and coalesce(position('current_user_is_admin' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)'))) > 0, false)),
    ('GRANT', 'authenticated cannot execute private team filter scope',
      not coalesce(has_function_privilege('authenticated', 'public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)', 'EXECUTE'), false)),
    ('ISOLATION', 'team overview analytics stay in COMPLETE scope',
      coalesce(position('power_outage_market' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)')))) = 0, false)
      and coalesce(position('power_outage_market' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)')))) = 0, false)),
    ('LOGIC', 'job outcomes are attributed to the user who set job won',
      coalesce(position('event_row.actor_user_id' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)
      and coalesce(position('event_row.event_kind = ''job_won''' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)),
    ('LOGIC', 'current workload uses current assignment owner',
      coalesce(position('scope.current_owner_id' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)),
    ('LOGIC', 'team analytics support period user selector and distributor filters',
      coalesce(position('requested_period_basis' in pg_get_functiondef(to_regprocedure('public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)
      and coalesce(position('requested_owner_id' in pg_get_functiondef(to_regprocedure('public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)
      and coalesce(position('requested_selector_key' in pg_get_functiondef(to_regprocedure('public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)
      and coalesce(position('requested_source' in pg_get_functiondef(to_regprocedure('public.get_cpo_team_overview_scope_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)),
    ('LOGIC', 'reminder metrics use Pracovni agenda as source of truth',
      coalesce(position('public.activities' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)'))) > 0, false)),
    ('LOGIC', 'attention list detects overdue and missing follow ups',
      coalesce(position('overdue_follow_up' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)'))) > 0, false)
      and coalesce(position('missing_follow_up' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)'))) > 0, false)),
    ('SAFETY', 'team overview analytics are read only',
      coalesce(position('insert into' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)')))) = 0, false)
      and coalesce(position('update ' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)')))) = 0, false)
      and coalesce(position('delete from' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)')))) = 0, false)),
    ('SAFETY', 'team analytics create no automation or external request',
      coalesce(position('cron.schedule' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)')))) = 0, false)
      and coalesce(position('net.http' in lower(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)')))) = 0, false)),
    ('STATE', 'team overview analytics version one is prepared without UI',
      to_regprocedure('public.get_complete_power_outage_team_overview_v1(timestamptz,timestamptz,text,uuid,text,text)') is not null
      and to_regprocedure('public.get_complete_power_outage_team_records_v1(timestamptz,timestamptz,text,uuid,text,text,text,integer,integer)') is not null)
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
