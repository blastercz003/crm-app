with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'independent COMPLETE Resend TEST state exists',
    to_regclass('public.complete_power_outage_notification_email_test_state') is not null),
  ('TABLE', 'independent COMPLETE Resend TEST deliveries exist',
    to_regclass('public.complete_power_outage_notification_email_test_deliveries') is not null),
  ('TABLE', 'append only COMPLETE Resend TEST events exist',
    to_regclass('public.complete_power_outage_notification_email_test_events') is not null),
  ('FUNCTION', 'controlled COMPLETE Resend TEST preparation exists',
    to_regprocedure('public.prepare_complete_power_outage_notification_email_test_v1(uuid)') is not null),
  ('FUNCTION', 'controlled COMPLETE Resend TEST claim exists',
    to_regprocedure('public.claim_complete_power_outage_notification_email_test_v1()') is not null),
  ('FUNCTION', 'idempotent COMPLETE Resend webhook recording exists',
    to_regprocedure('public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)') is not null),
  ('GRANT', 'authenticated cannot prepare or claim COMPLETE TEST delivery',
    not has_function_privilege('authenticated', 'public.prepare_complete_power_outage_notification_email_test_v1(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.claim_complete_power_outage_notification_email_test_v1()', 'EXECUTE')),
  ('GRANT', 'authenticated cannot finish or record COMPLETE TEST delivery',
    not has_function_privilege('authenticated', 'public.finish_complete_power_outage_notification_email_test_sent_v1(uuid,uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_complete_power_outage_notification_email_test_failed_v1(uuid,uuid,text,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)', 'EXECUTE')),
  ('RLS', 'COMPLETE Resend TEST tables have RLS',
    (select bool_and(c.relrowsecurity)
     from pg_class c
     where c.oid = any(array[
       'public.complete_power_outage_notification_email_test_state'::regclass,
       'public.complete_power_outage_notification_email_test_deliveries'::regclass,
       'public.complete_power_outage_notification_email_test_events'::regclass
     ]))),
  ('ISOLATION', 'COMPLETE TEST uses its own provider namespace',
    (select provider_namespace = 'complete_resend'
       and metadata ->> 'environmentPrefix' = 'COMPLETE_RESEND_'
       and coalesce((metadata ->> 'marketEmailIsolation')::boolean, false)
     from public.complete_power_outage_notification_email_test_state where singleton)),
  ('ISOLATION', 'COMPLETE TEST functions do not reference MARKET email objects',
    not exists (
      select 1 from pg_proc p
      where p.oid = any(array[
        'public.prepare_complete_power_outage_notification_email_test_v1(uuid)'::regprocedure,
        'public.claim_complete_power_outage_notification_email_test_v1()'::regprocedure,
        'public.finish_complete_power_outage_notification_email_test_sent_v1(uuid,uuid,text,text)'::regprocedure,
        'public.finish_complete_power_outage_notification_email_test_failed_v1(uuid,uuid,text,text)'::regprocedure,
        'public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)'::regprocedure
      ]) and pg_get_functiondef(p.oid) ilike '%power_outage_client_email%'
    )),
  ('LOGIC', 'only SHADOW ready future plans can enter COMPLETE TEST',
    pg_get_functiondef('public.prepare_complete_power_outage_notification_email_test_v1(uuid)'::regprocedure)
      ilike '%plan.plan_status = ''shadow_ready''%'
    and pg_get_functiondef('public.prepare_complete_power_outage_notification_email_test_v1(uuid)'::regprocedure)
      ilike '%plan.expires_at > now()%'),
  ('LOGIC', 'one TEST delivery exists at most once per plan',
    exists (
      select 1 from pg_constraint
      where conrelid = 'public.complete_power_outage_notification_email_test_deliveries'::regclass
        and contype = 'u' and pg_get_constraintdef(oid) ilike '%plan_id%'
    )),
  ('LOGIC', 'COMPLETE TEST allows at most two attempts',
    (select max_attempt_count between 1 and 2
     from public.complete_power_outage_notification_email_test_state where singleton)),
  ('LOGIC', 'COMPLETE TEST auto disables after a terminal send result',
    pg_get_functiondef('public.finish_complete_power_outage_notification_email_test_sent_v1(uuid,uuid,text,text)'::regprocedure)
      ilike '%set test_enabled = false%'
    and pg_get_functiondef('public.finish_complete_power_outage_notification_email_test_failed_v1(uuid,uuid,text,text)'::regprocedure)
      ilike '%set test_enabled = false%'),
  ('SAFETY', 'COMPLETE Resend TEST starts disabled',
    (select not test_enabled from public.complete_power_outage_notification_email_test_state where singleton)),
  ('SAFETY', 'COMPLETE TEST exposes no LIVE dispatch path',
    (select coalesce((metadata ->> 'liveDispatchAvailable')::boolean, true) = false
     from public.complete_power_outage_notification_email_test_state where singleton)),
  ('SAFETY', 'COMPLETE TEST has no automatic dispatch schedule',
    not exists (
      select 1 from cron.job
      where jobname ilike '%complete%notification%email%send%'
         or jobname ilike '%complete%notification%email%dispatch%'
    )),
  ('SAFETY', 'COMPLETE planning state remains SHADOW with dispatch disabled',
    (select runtime_mode = 'shadow' and planning_enabled and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)),
  ('SAFETY', 'no TEST delivery was created during installation',
    not exists (select 1 from public.complete_power_outage_notification_email_test_deliveries)),
  ('SAFETY', 'TEST webhook does not suppress real company recipients',
    pg_get_functiondef('public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)'::regprocedure)
      not ilike '%notification_email_suppression_events%'),
  ('STATE', 'COMPLETE Resend TEST contract version one is recorded',
    (select configuration_contract_version = 1
       and metadata ->> 'contract' = 'complete-notification-email-resend-test-v1'
     from public.complete_power_outage_notification_email_test_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
