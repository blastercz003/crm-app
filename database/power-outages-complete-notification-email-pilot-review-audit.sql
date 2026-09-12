with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'append only COMPLETE pilot review history',
    to_regclass('public.complete_power_outage_notification_email_pilot_review_events') is not null),
  ('VIEW', 'effective COMPLETE pilot review state',
    to_regclass('public.complete_power_outage_notification_email_pilot_reviews_v1') is not null),
  ('FUNCTION', 'admin COMPLETE pilot review decision exists',
    to_regprocedure('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)') is not null),
  ('FUNCTION', 'admin COMPLETE pilot review workspace exists',
    to_regprocedure('public.get_cpo_notification_email_pilot_review_v1(integer)') is not null),
  ('GRANT', 'authenticated cannot enumerate pilot review tables',
    not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_review_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_reviews_v1', 'SELECT')),
  ('GRANT', 'pilot review operations enforce administrator role',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%profile.role = ''admin''%'
    and pg_get_functiondef('public.get_cpo_notification_email_pilot_review_v1(integer)'::regprocedure)
      ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'approval is bound to an immutable plan fingerprint',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%cpo_notification_email_plan_fingerprint_v1%'
    and pg_get_viewdef('public.complete_power_outage_notification_email_pilot_reviews_v1'::regclass, true)
      ilike '%plan_fingerprint%'),
  ('LOGIC', 'approval revalidates current candidate and unsubscribe state',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%complete_power_outage_notification_email_candidates_v1%'
    and pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%complete_power_outage_notification_email_suppressions_v1%'),
  ('LOGIC', 'approval requires future SHADOW ready notice',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%runtime_mode <> ''shadow''%'
    and pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      ilike '%plan_status <> ''shadow_ready''%'),
  ('SAFETY', 'manual review does not mutate notification plans',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      not ilike '%update public.complete_power_outage_notification_email_plans%'),
  ('SAFETY', 'manual review cannot enable or perform dispatch',
    (select not dispatch_enabled and runtime_mode = 'shadow'
     from public.complete_power_outage_notification_email_state where singleton)
    and pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      not ilike '%resend%'),
  ('SAFETY', 'pilot allowlist and review UI remain disabled',
    (select
      not coalesce((metadata ->> 'pilotAllowlistEnabled')::boolean, true)
      and not coalesce((metadata ->> 'pilotReviewUiEnabled')::boolean, true)
     from public.complete_power_outage_notification_email_state where singleton)),
  ('ISOLATION', 'pilot review does not reference MARKET email objects',
    pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
      not ilike '%power_outage_client_email%'
    and pg_get_functiondef('public.get_cpo_notification_email_pilot_review_v1(integer)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('STATE', 'COMPLETE pilot review foundation is active while LIVE stays off',
    (select
      coalesce((metadata ->> 'pilotReviewEnabled')::boolean, false)
      and metadata ->> 'pilotReviewContract' = 'complete-notification-email-pilot-review-v1'
      and not dispatch_enabled
      and not coalesce((metadata ->> 'liveDispatchEnabled')::boolean, true)
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
