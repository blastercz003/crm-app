with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'independent COMPLETE pilot safety state',
    to_regclass('public.complete_power_outage_notification_email_pilot_safety_state') is not null),
  ('TABLE', 'append only COMPLETE pilot safety events',
    to_regclass('public.complete_power_outage_notification_email_pilot_safety_events') is not null),
  ('FUNCTION', 'idempotent COMPLETE pilot safety event recording exists',
    to_regprocedure('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)') is not null),
  ('FUNCTION', 'admin COMPLETE pilot incident acknowledgement exists',
    to_regprocedure('public.acknowledge_cpo_notification_email_pilot_pause_v1(text)') is not null),
  ('GRANT', 'authenticated cannot record pilot safety signals',
    not has_function_privilege('authenticated', 'public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)', 'EXECUTE')),
  ('GRANT', 'authenticated cannot enumerate pilot safety tables',
    not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_safety_state', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_safety_events', 'SELECT')),
  ('GRANT', 'incident acknowledgement enforces administrator role',
    pg_get_functiondef('public.acknowledge_cpo_notification_email_pilot_pause_v1(text)'::regprocedure)
      ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'complaint hard bounce and configuration error stop immediately',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%configuration_error%hard_bounce%complaint%'),
  ('LOGIC', 'three consecutive transient failures stop COMPLETE pilot',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%next_failure_count >= safety_state.transient_failure_threshold%'),
  ('LOGIC', 'successful delivery resets transient failure streak',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%consecutive_transient_failure_count = 0%'),
  ('LOGIC', 'safety events are idempotent by provider event id',
    pg_get_functiondef('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)'::regprocedure)
      ilike '%on conflict (source, external_event_id) do nothing%'),
  ('LOGIC', 'complaint and hard bounce suppress future COMPLETE plans',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%complete_power_outage_notification_email_suppression_events%'),
  ('SAFETY', 'automatic pause disables planning dispatch and reservations',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%planning_enabled = false%dispatch_enabled = false%'
    and pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      ilike '%reservation_enabled = false%'),
  ('SAFETY', 'acknowledgement never reactivates sending',
    pg_get_functiondef('public.acknowledge_cpo_notification_email_pilot_pause_v1(text)'::regprocedure)
      not ilike '%dispatch_enabled = true%'
    and pg_get_functiondef('public.acknowledge_cpo_notification_email_pilot_pause_v1(text)'::regprocedure)
      not ilike '%reservation_enabled = true%'),
  ('SAFETY', 'LIVE signal ingestion and COMPLETE dispatch remain disabled',
    (select monitoring_enabled and not live_signal_ingestion_enabled
     from public.complete_power_outage_notification_email_pilot_safety_state where singleton)
    and (select runtime_mode = 'shadow' and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)),
  ('DATA', 'pilot safety history starts empty',
    not exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events)),
  ('ISOLATION', 'pilot auto stop does not reference MARKET email objects',
    pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      not ilike '%power_outage_client_email%'
    and pg_get_functiondef('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('SAFETY', 'pilot auto stop creates no cron or sending path',
    not exists (select 1 from cron.job where jobname ilike '%complete%pilot%safety%')
    and pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
      not ilike '%resend%'),
  ('STATE', 'COMPLETE pilot auto stop contract is recorded without activation',
    (select
      metadata ->> 'pilotAutoStopContract' = 'complete-notification-email-pilot-auto-stop-v1'
      and coalesce((metadata ->> 'pilotAutoStopEnabled')::boolean, false)
      and not coalesce((metadata ->> 'pilotLiveSignalIngestionEnabled')::boolean, true)
      and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
