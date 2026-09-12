with checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'admin COMPLETE email management workspace exists',
    to_regprocedure('public.get_cpo_notification_email_management_v1(integer)') is not null),
  ('GRANT', 'email management workspace enforces administrator role',
    pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'email management combines review allowlist rate and safety',
    pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%get_cpo_notification_email_pilot_review_v1%'
    and pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%get_cpo_notification_email_pilot_allowlist_v1%'
    and pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%get_cpo_notification_email_pilot_rate_summary_v1%'
    and pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%get_cpo_notification_email_pilot_safety_summary_v1%'),
  ('SAFETY', 'email management exposes no LIVE activation operation',
    pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      not ilike '%dispatch_enabled = true%'
    and pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      not ilike '%reservation_enabled = true%'),
  ('SAFETY', 'COMPLETE email dispatch and rate reservations remain disabled',
    (select runtime_mode = 'shadow' and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)
    and (select not reservation_enabled
     from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)),
  ('ISOLATION', 'email management UI does not reference MARKET email objects',
    pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('STATE', 'admin COMPLETE email management UI version one is active',
    (select ui_enabled and not live_dispatch_enabled
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)
    and (select
      coalesce((metadata ->> 'emailManagementUiEnabled')::boolean, false)
      and metadata ->> 'emailManagementUiAudience' = 'admin'
      and metadata ->> 'emailManagementUiContract' = 'complete-notification-email-management-ui-v1'
      and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
