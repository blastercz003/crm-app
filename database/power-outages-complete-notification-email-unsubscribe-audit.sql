with function_definition as (
  select pg_get_functiondef(
    'public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)'::regprocedure
  ) as definition
),
checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'token based COMPLETE unsubscribe exists',
    to_regprocedure('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)') is not null),
  ('GRANT', 'public and authenticated cannot call COMPLETE unsubscribe directly',
    not has_function_privilege('anon', 'public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)', 'EXECUTE')),
  ('GRANT', 'only server role can execute COMPLETE unsubscribe',
    has_function_privilege('service_role', 'public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)', 'EXECUTE')),
  ('LOGIC', 'unknown unsubscribe token changes nothing',
    (select definition ilike '%status'', ''unavailable%'
       and definition ilike '%where plan.unsubscribe_token = requested_token%'
     from function_definition)),
  ('LOGIC', 'repeated unsubscribe is idempotent',
    (select definition ilike '%status'', ''already_unsubscribed%'
       and definition ilike '%latest_action = ''suppress''%'
     from function_definition)),
  ('LOGIC', 'unsubscribe immediately suppresses pending plans for the email',
    (select definition ilike '%set plan_status = ''suppressed''%'
       and definition ilike '%plan.recipient_email = selected_plan.recipient_email%'
     from function_definition)),
  ('SAFETY', 'unsubscribe returns no recipient email or company identity',
    (select definition ilike '%''recipientExposed'', false%'
       and definition not ilike '%''recipientEmail''%'
       and definition not ilike '%''companyName''%'
     from function_definition)),
  ('SAFETY', 'unsubscribe stores no network address or user agent',
    (select definition ilike '%''storesNetworkAddress'', false%'
       and definition ilike '%''storesUserAgent'', false%'
     from function_definition)),
  ('SAFETY', 'unsubscribe does not enable planning or dispatch',
    (select definition not ilike '%notification_email_state%'
       and definition not ilike '%dispatch_enabled%'
     from function_definition)),
  ('ISOLATION', 'unsubscribe does not reference MARKET email objects',
    (select definition not ilike '%power_outage_client_email%'
     from function_definition)),
  ('DATA', 'every current COMPLETE plan has a unique unsubscribe token',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      where plan.unsubscribe_token is null
    )
    and (
      select count(*) = count(distinct unsubscribe_token)
      from public.complete_power_outage_notification_email_plans
    )),
  ('SAFETY', 'COMPLETE delivery remains SHADOW only',
    (select runtime_mode = 'shadow' and planning_enabled and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
