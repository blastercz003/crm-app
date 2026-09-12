with claim_definition as (
  select pg_get_functiondef(
    'public.claim_cpo_notification_email_test_v2()'::regprocedure
  ) as definition
),
checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'COMPLETE final template TEST claim version two exists',
    to_regprocedure('public.claim_cpo_notification_email_test_v2()') is not null),
  ('GRANT', 'authenticated cannot claim COMPLETE template TEST',
    not has_function_privilege('anon', 'public.claim_cpo_notification_email_test_v2()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_cpo_notification_email_test_v2()', 'EXECUTE')),
  ('GRANT', 'only server role can claim COMPLETE template TEST',
    has_function_privilege('service_role', 'public.claim_cpo_notification_email_test_v2()', 'EXECUTE')),
  ('DATA', 'template TEST receives current COMPLETE outage snapshots',
    (select definition ilike '%complete_power_outage_notification_email_plans%'
       and definition ilike '%complete_power_outages%'
       and definition ilike '%announcementUrl%'
       and definition ilike '%sourceUrl%'
     from claim_definition)),
  ('LOGIC', 'template TEST records versioned rendering contract',
    (select definition ilike '%complete-notification-email-template-v1%'
     from claim_definition)),
  ('SAFETY', 'template TEST keeps unsubscribe link inactive',
    (select definition ilike '%''unsubscribeLinkActive'', false%'
     from claim_definition)),
  ('SAFETY', 'template TEST remains limited to pending TEST deliveries',
    (select definition ilike '%delivery.delivery_status = ''pending''%'
       and definition ilike '%attempt_count < delivery.max_attempt_count%'
     from claim_definition)),
  ('SAFETY', 'COMPLETE email dispatch remains disabled',
    (select runtime_mode = 'shadow' and planning_enabled and not dispatch_enabled
     from public.complete_power_outage_notification_email_state
     where singleton)),
  ('ISOLATION', 'template TEST does not reference MARKET email objects',
    (select definition not ilike '%power_outage_client_email%'
     from claim_definition)),
  ('SAFETY', 'existing COMPLETE unsubscribe contract remains available',
    to_regprocedure('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)') is not null)
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
