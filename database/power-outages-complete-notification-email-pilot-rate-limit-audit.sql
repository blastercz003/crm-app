with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'independent COMPLETE pilot rate limit state',
    to_regclass('public.complete_power_outage_notification_email_pilot_rate_limit_state') is not null),
  ('TABLE', 'immutable COMPLETE pilot send slots',
    to_regclass('public.complete_power_outage_notification_email_pilot_send_slots') is not null),
  ('TABLE', 'immutable COMPLETE pilot send outcomes',
    to_regclass('public.complete_power_outage_notification_email_pilot_send_outcomes') is not null),
  ('VIEW', 'effective COMPLETE pilot send ledger',
    to_regclass('public.complete_power_outage_notification_email_pilot_send_ledger_v1') is not null),
  ('FUNCTION', 'atomic COMPLETE pilot slot reservation exists',
    to_regprocedure('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)') is not null),
  ('FUNCTION', 'token protected COMPLETE pilot slot completion exists',
    to_regprocedure('public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)') is not null),
  ('GRANT', 'authenticated cannot reserve or finish pilot send slots',
    not has_function_privilege('authenticated', 'public.reserve_cpo_notification_email_pilot_slot_v1(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)', 'EXECUTE')),
  ('GRANT', 'authenticated cannot enumerate pilot rate limit tables',
    not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_send_slots', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_send_outcomes', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_send_ledger_v1', 'SELECT')),
  ('LOGIC', 'pilot daily send limit is exactly three',
    (select daily_send_limit = 3 and hard_daily_send_limit = 3
     from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)),
  ('LOGIC', 'pilot minimum interval is at least ten minutes',
    (select minimum_interval_seconds >= 600
     from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)),
  ('LOGIC', 'rate accounting uses Europe Prague calendar days',
    (select accounting_timezone = 'Europe/Prague'
     from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)
    and pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      ilike '%Europe/Prague%'),
  ('LOGIC', 'slot reservation is serialized and allowlist bound',
    pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      ilike '%pg_advisory_xact_lock%'
    and pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      ilike '%active_and_eligible_now%'),
  ('LOGIC', 'database guard enforces daily limit and minimum interval',
    pg_get_functiondef('public.guard_cpo_notification_email_pilot_send_slot_insert()'::regprocedure)
      ilike '%daily_send_limit%'
    and pg_get_functiondef('public.guard_cpo_notification_email_pilot_send_slot_insert()'::regprocedure)
      ilike '%minimum_interval_seconds%'
    and exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_notification_email_pilot_send_slots'::regclass
        and trigger_row.tgname = 'cpo_pilot_send_slot_insert_guard'
        and not trigger_row.tgisinternal
    )),
  ('LOGIC', 'expired reservation does not permanently block the queue',
    pg_get_viewdef('public.complete_power_outage_notification_email_pilot_send_ledger_v1'::regclass, true)
      ilike '%lease_expires_at%now()%'),
  ('LOGIC', 'one plan can be recorded sent at most once',
    exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'cpo_pilot_send_outcome_sent_plan_idx'
        and indexdef ilike '%unique%where (outcome = ''sent''%'
    )),
  ('DATA', 'pilot rate limit history starts empty',
    not exists (select 1 from public.complete_power_outage_notification_email_pilot_send_slots)
    and not exists (select 1 from public.complete_power_outage_notification_email_pilot_send_outcomes)),
  ('SAFETY', 'pilot rate reservations remain disabled',
    (select enforcement_enabled and not reservation_enabled
     from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)),
  ('SAFETY', 'COMPLETE LIVE dispatch remains disabled',
    (select runtime_mode = 'shadow' and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)
    and (select not live_dispatch_enabled
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)),
  ('SAFETY', 'rate limiter performs no network or Resend request',
    pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      not ilike '%http%'
    and pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      not ilike '%resend%'),
  ('ISOLATION', 'pilot rate limiter does not reference MARKET email objects',
    pg_get_functiondef('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)'::regprocedure)
      not ilike '%power_outage_client_email%'
    and pg_get_functiondef('public.finish_cpo_notification_email_pilot_slot_v1(uuid,uuid,text,text,text)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('STATE', 'COMPLETE pilot rate contract is recorded without activation',
    (select
      metadata ->> 'pilotRateLimitContract' = 'complete-notification-email-pilot-rate-limit-v1'
      and coalesce((metadata ->> 'pilotRateLimitEnforced')::boolean, false)
      and not coalesce((metadata ->> 'pilotRateLimitReservationEnabled')::boolean, true)
      and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
