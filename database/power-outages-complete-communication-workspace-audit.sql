with checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'structured COMPLETE communication recording exists',
    to_regprocedure('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)') is not null),
  ('FUNCTION', 'unified COMPLETE communication workspace exists',
    to_regprocedure('public.get_complete_power_outage_communication_workspace_v1(uuid)') is not null),
  ('GRANT', 'communication workspace is available only through guarded functions',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_communication_workspace_v1(uuid)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_communication_events', 'SELECT,INSERT,UPDATE,DELETE')),
  ('LOGIC', 'job outcome stays bound to canonical communication status',
    pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure)
      ilike '%clean_status = ''job_won''%'),
  ('LOGIC', 'structured communication keeps legacy assignment compatibility',
    pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure)
      ilike '%complete_power_outage_company_assignments%'),
  ('LOGIC', 'timeline contains communication reminders and actual email events',
    pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure)
      ilike '%automatic_email_sent%'
    and pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure)
      ilike '%complete_power_outage_communication_activity_links%'),
  ('ISOLATION', 'communication workspace stays in COMPLETE scope',
    pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('SAFETY', 'communication recording does not send email or call external services',
    pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure)
      not ilike '%resend%'
    and pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure)
      not ilike '%http%'),
  ('SAFETY', 'step three creates no communication automation',
    not exists (
      select 1 from cron.job job
      where job.command ilike '%record_complete_power_outage_communication_v1%'
         or job.command ilike '%get_complete_power_outage_communication_workspace_v1%'
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
