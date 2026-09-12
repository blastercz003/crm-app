begin;

-- Krok 10.8: opakovatelny, read-only bezpecnostni preflight pro prvni
-- LIVE pilot e-mailu KOMPLETNI. Nevytvari odesilaci cestu, cron ani
-- moznost aktivace. Funkce je urcena jen serverove roli a bude znovu
-- pouzita jako dynamicka pojistka pri budouci rucni aktivaci pilotu.
do $$
declare missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_plans') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email plans');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_reviews_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot reviews');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot allowlist');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_rate_limit_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot rate limits');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_safety_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot safety state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_test_deliveries') is null
     or to_regclass('public.complete_power_outage_notification_email_test_events') is null then
    missing_dependencies := array_append(missing_dependencies, 'delivered template TEST evidence');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_suppressions_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'effective unsubscribe suppressions');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_send_outcomes') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot send outcomes');
  end if;
  if to_regprocedure('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)') is null then
    missing_dependencies := array_append(missing_dependencies, 'unsubscribe');
  end if;
  if to_regprocedure('public.get_cpo_notification_email_management_v1(integer)') is null then
    missing_dependencies := array_append(missing_dependencies, 'admin EMAILY workspace');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro LIVE bezpecnostni audit KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create or replace function public.audit_cpo_notification_email_live_readiness_v1()
returns table (
  check_type text,
  object_name text,
  is_correct boolean
)
language sql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
  with latest_test_delivery as (
    select delivery.*
    from public.complete_power_outage_notification_email_test_deliveries delivery
    order by delivery.requested_at desc, delivery.id desc
    limit 1
  ),
  checks(check_type, object_name, is_correct) as (
    values
    ('DATA', 'only approved eligible entries appear as active pilot entries',
      not exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
        left join public.complete_power_outage_notification_email_pilot_reviews_v1 review
          on review.plan_id = entry.plan_id
        where entry.active_and_eligible_now
          and (
            review.plan_id is null
            or review.review_status <> 'approved'
            or not review.approved_and_eligible_now
          )
      )),
    ('DATA', 'active pilot allowlist contains no duplicate company',
      not exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
        where entry.active_and_eligible_now
        group by entry.ico
        having count(*) > 1
      )),
    ('DATA', 'active pilot allowlist stays within configured and hard limits',
      (
        select count(distinct entry.ico) <= state_row.configured_max_company_count
          and count(distinct entry.ico) <= state_row.hard_max_company_count
        from public.complete_power_outage_notification_email_pilot_allowlist_state state_row
        left join public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
          on entry.active_and_eligible_now
        where state_row.singleton
        group by state_row.configured_max_company_count, state_row.hard_max_company_count
      )),
    ('DATA', 'active pilot entries reference future unsuppressed SHADOW plans',
      not exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
        join public.complete_power_outage_notification_email_plans plan
          on plan.id = entry.plan_id
        left join public.complete_power_outage_notification_email_suppressions_v1 suppression
          on suppression.normalized_email = plan.recipient_email
         and suppression.is_suppressed
        where entry.active_and_eligible_now
          and (
            plan.plan_status <> 'shadow_ready'
            or plan.starts_at_snapshot <= now()
            or plan.expires_at <= now()
            or suppression.normalized_email is not null
          )
      )),
    ('DATA', 'current COMPLETE plans have unique unsubscribe tokens',
      not exists (
        select 1 from public.complete_power_outage_notification_email_plans plan
        where plan.unsubscribe_token is null
      ) and (
        select count(*) = count(distinct plan.unsubscribe_token)
        from public.complete_power_outage_notification_email_plans plan
      )),
    ('DATA', 'final COMPLETE template test was delivered with webhook evidence',
      exists (
        select 1
        from latest_test_delivery delivery
        join public.complete_power_outage_notification_email_test_events event
          on event.delivery_id = delivery.id
         and event.provider_message_id = delivery.provider_message_id
        where delivery.delivery_status = 'delivered'
          and delivery.delivered_at is not null
          and delivery.provider_message_id is not null
          and delivery.metadata ->> 'templateContract' = 'complete-notification-email-template-v1'
          and event.event_kind = 'email.delivered'
      )),
    ('FUNCTION', 'manual review allowlist rate safety and unsubscribe contracts exist',
      to_regprocedure('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)') is not null
      and to_regprocedure('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)') is not null
      and to_regprocedure('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)') is not null
      and to_regprocedure('public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)') is not null
      and to_regprocedure('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)') is not null
      and to_regprocedure('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)') is not null),
    ('GRANT', 'authenticated cannot reserve or complete pilot sends',
      not has_function_privilege('authenticated', 'public.reserve_cpo_notification_email_pilot_slot_v1(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)', 'EXECUTE')),
    ('GRANT', 'authenticated cannot inject safety events or invoke unsubscribe storage',
      not has_function_privilege('authenticated', 'public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)', 'EXECUTE')),
    ('GRANT', 'LIVE security preflight is available only to server role',
      not has_function_privilege('anon', 'public.audit_cpo_notification_email_live_readiness_v1()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.audit_cpo_notification_email_live_readiness_v1()', 'EXECUTE')
      and has_function_privilege('service_role', 'public.audit_cpo_notification_email_live_readiness_v1()', 'EXECUTE')),
    ('GRANT', 'authenticated cannot enumerate private COMPLETE email tables',
      not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_plans', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_review_events', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_allowlist_events', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_send_slots', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_safety_events', 'SELECT')),
    ('ISOLATION', 'COMPLETE pilot keeps an independent provider namespace',
      (
        select state_row.provider_namespace = 'complete_resend'
          and coalesce((state_row.metadata ->> 'marketEmailIsolation')::boolean, false)
        from public.complete_power_outage_notification_email_state state_row
        where state_row.singleton
      )),
    ('ISOLATION', 'COMPLETE pilot functions do not reference MARKET email objects',
      pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
        not ilike '%power_outage_client_email%'
      and pg_get_functiondef('public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)'::regprocedure)
        not ilike '%power_outage_client_email%'
      and pg_get_functiondef('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)'::regprocedure)
        not ilike '%power_outage_client_email%'
      and pg_get_functiondef('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)'::regprocedure)
        not ilike '%power_outage_client_email%'),
    ('LOGIC', 'pilot daily limit and minimum interval are enforced in database',
      (
        select state_row.enforcement_enabled
          and state_row.daily_send_limit = 3
          and state_row.hard_daily_send_limit = 3
          and state_row.minimum_interval_seconds >= 600
          and state_row.accounting_timezone = 'Europe/Prague'
        from public.complete_power_outage_notification_email_pilot_rate_limit_state state_row
        where state_row.singleton
      )
      and pg_get_functiondef('public.guard_cpo_notification_email_pilot_send_slot_insert()'::regprocedure)
        ilike '%daily_send_limit%minimum_interval_seconds%'),
    ('LOGIC', 'pilot reservations are serialized and allowlist bound',
      pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
        ilike '%pg_advisory_xact_lock%'
      and pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
        ilike '%active_and_eligible_now%'),
    ('LOGIC', 'complaint hard bounce and configuration error stop immediately',
      pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
        ilike '%configuration_error%hard_bounce%complaint%'),
    ('LOGIC', 'three consecutive transient failures stop COMPLETE pilot',
      (
        select state_row.auto_pause_enabled and state_row.transient_failure_threshold = 3
        from public.complete_power_outage_notification_email_pilot_safety_state state_row
        where state_row.singleton
      )
      and pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
        ilike '%next_failure_count >= safety_state.transient_failure_threshold%'),
    ('LOGIC', 'complaint and hard bounce suppress future COMPLETE plans',
      pg_get_functiondef('public.apply_cpo_notification_email_pilot_safety_signal_v1()'::regprocedure)
        ilike '%complete_power_outage_notification_email_suppression_events%'),
    ('LOGIC', 'unsubscribe is token based idempotent and immediately suppresses plans',
      pg_get_functiondef('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)'::regprocedure)
        ilike '%where plan.unsubscribe_token = requested_token%'
      and pg_get_functiondef('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)'::regprocedure)
        ilike '%already_unsubscribed%'
      and pg_get_functiondef('public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)'::regprocedure)
        ilike '%set plan_status = ''suppressed''%'),
    ('LOGIC', 'admin EMAILY workspace enforces administrator role',
      pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
        ilike '%profile.role = ''admin''%'),
    ('RLS', 'private COMPLETE email tables retain row level security',
      not exists (
        select 1
        from pg_class relation
        where relation.oid = any(array[
          'public.complete_power_outage_notification_email_plans'::regclass,
          'public.complete_power_outage_notification_email_pilot_review_events'::regclass,
          'public.complete_power_outage_notification_email_pilot_allowlist_events'::regclass,
          'public.complete_power_outage_notification_email_pilot_send_slots'::regclass,
          'public.complete_power_outage_notification_email_pilot_send_outcomes'::regclass,
          'public.complete_power_outage_notification_email_pilot_safety_events'::regclass
        ]) and not relation.relrowsecurity
      )),
    ('SAFETY', 'LIVE dispatch reservation and signal ingestion remain disabled',
      (
        select state_row.runtime_mode = 'shadow'
          and state_row.planning_enabled
          and not state_row.dispatch_enabled
        from public.complete_power_outage_notification_email_state state_row
        where state_row.singleton
      )
      and (
        select not state_row.reservation_enabled
        from public.complete_power_outage_notification_email_pilot_rate_limit_state state_row
        where state_row.singleton
      )
      and (
        select not state_row.live_signal_ingestion_enabled
        from public.complete_power_outage_notification_email_pilot_safety_state state_row
        where state_row.singleton
      )),
    ('SAFETY', 'no automatic COMPLETE LIVE dispatch schedule exists',
      not exists (
        select 1 from cron.job job
        where job.jobname ilike '%complete%notification%email%send%'
           or job.jobname ilike '%complete%notification%email%dispatch%'
           or job.jobname ilike '%complete%pilot%send%'
      )),
    ('SAFETY', 'no real pilot send outcome exists before activation',
      not exists (
        select 1
        from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
        where outcome.outcome = 'sent'
      )),
    ('SAFETY', 'admin review allowlist and incident acknowledgement cannot send',
      pg_get_functiondef('public.decide_cpo_notification_email_pilot_v1(uuid,text,text)'::regprocedure)
        not ilike '%resend%'
      and pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
        not ilike '%resend%'
      and pg_get_functiondef('public.acknowledge_cpo_notification_email_pilot_pause_v1(text)'::regprocedure)
        not ilike '%dispatch_enabled = true%'),
    ('STATE', 'LIVE security preflight contract is recorded without activation',
      (
        select state_row.metadata ->> 'liveSecurityAuditContract' = 'complete-notification-email-live-security-audit-v1'
          and not coalesce((state_row.metadata ->> 'liveDispatchEnabled')::boolean, false)
          and state_row.runtime_mode = 'shadow'
          and not state_row.dispatch_enabled
        from public.complete_power_outage_notification_email_state state_row
        where state_row.singleton
      ))
  )
  select checks.check_type, checks.object_name, checks.is_correct
  from checks;
$$;

revoke all on function public.audit_cpo_notification_email_live_readiness_v1()
  from public, anon, authenticated;
grant execute on function public.audit_cpo_notification_email_live_readiness_v1()
  to service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
      'liveSecurityAuditContract', 'complete-notification-email-live-security-audit-v1',
      'liveSecurityAuditInstalledAt', now(),
      'liveDispatchEnabled', false,
      'liveActivationAvailable', false
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
