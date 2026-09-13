select *
from (values
  ('FUNCTION', 'assigned COMPLETE outages Activity workspace exists',
    to_regprocedure('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)') is not null),
  ('GRANT', 'assigned outage workspace requires authenticated user',
    has_function_privilege('authenticated', 'public.get_activity_complete_power_outage_assignments_v1(uuid,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_activity_complete_power_outage_assignments_v1(uuid,integer)', 'EXECUTE')),
  ('GRANT', 'another user scope remains administrator guarded',
    pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      ilike '%requested_owner_id <> current_user_id and current_role <> ''admin''%'),
  ('LOGIC', 'Activity panel contains only current and future assigned outages',
    pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      ilike '%outage.ends_at >= now()%'
    and pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      ilike '%assignment.owner_id = requested_owner_id%'),
  ('LOGIC', 'finished communication outcomes are excluded',
    pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      ilike '%not in (''job_won'', ''closed_no_job'')%'),
  ('SAFETY', 'assigned outage Activity workspace is read only',
    pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      not ilike '%insert into%'
    and pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      not ilike '%update public%'
    and pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      not ilike '%delete from%'),
  ('ISOLATION', 'assigned outage Activity workspace stays in COMPLETE scope',
    pg_get_functiondef('public.get_activity_complete_power_outage_assignments_v1(uuid,integer)'::regprocedure)
      not ilike '%power_outage_client_email%')
) as checks(check_type, object_name, is_correct)
order by check_type, object_name;
