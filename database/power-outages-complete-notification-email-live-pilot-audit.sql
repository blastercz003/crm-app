-- Krok 10.9: instalacni audit prvniho LIVE pilotu KOMPLETNI.
-- Spousti se po migraci a pred rucni aktivaci. Je pouze pro cteni.
with definitions as (
  select
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.activate_cpo_notification_email_live_pilot_v1(text)')), '')) as activate_def,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.pause_cpo_notification_email_live_pilot_v1(text)')), '')) as pause_def,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.claim_cpo_notification_email_live_pilot_v1()')), '')) as claim_def,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.record_cpo_notification_email_live_resend_event_v1(text,text,text,jsonb)')), '')) as webhook_def,
    lower(coalesce(pg_get_functiondef(to_regprocedure('public.get_cpo_notification_email_management_v1(integer)')), '')) as management_def
), checks as (
  select 'TABLE'::text as check_type, 'append only COMPLETE pilot activation history'::text as object_name,
    to_regclass('public.complete_power_outage_notification_email_pilot_activation_events') is not null
    and exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = to_regclass('public.complete_power_outage_notification_email_pilot_activation_events')
        and trigger_row.tgname = 'cpo_notification_email_pilot_activation_immutable'
        and not trigger_row.tgisinternal
    ) as is_correct
  union all
  select 'FUNCTION', 'admin controlled COMPLETE LIVE activation and pause exist',
    to_regprocedure('public.activate_cpo_notification_email_live_pilot_v1(text)') is not null
    and to_regprocedure('public.pause_cpo_notification_email_live_pilot_v1(text)') is not null
  union all
  select 'FUNCTION', 'controlled COMPLETE LIVE pilot claim exists',
    to_regprocedure('public.claim_cpo_notification_email_live_pilot_v1()') is not null
  union all
  select 'FUNCTION', 'idempotent COMPLETE LIVE Resend signal recording exists',
    to_regprocedure('public.record_cpo_notification_email_live_resend_event_v1(text,text,text,jsonb)') is not null
  union all
  select 'CRON', 'COMPLETE LIVE pilot worker runs every minute',
    exists (
      select 1 from cron.job job
      where job.jobname = 'complete_notification_email_live_pilot_every_minute'
        and job.schedule = '* * * * *'
        and job.command like '%/api/power-outages/complete/notification-emails/pilot/send%'
    )
  union all
  select 'GRANT', 'authenticated cannot claim or record COMPLETE LIVE delivery',
    not has_function_privilege('authenticated', 'public.claim_cpo_notification_email_live_pilot_v1()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.record_cpo_notification_email_live_resend_event_v1(text,text,text,jsonb)', 'EXECUTE')
  union all
  select 'GRANT', 'LIVE activation operations remain administrator guarded',
    definitions.activate_def like '%profile.role = ''admin''%'
    and definitions.pause_def like '%profile.role = ''admin''%'
  from definitions
  union all
  select 'LOGIC', 'activation requires exact confirmation and fresh security preflight',
    definitions.activate_def like '%aktivovat pilot kompletní%'
    and definitions.activate_def like '%audit_cpo_notification_email_live_readiness_v1%'
  from definitions
  union all
  select 'LOGIC', 'activation requires one to three current pilot companies',
    definitions.activate_def like '%selected_count < 1 or selected_count > 3%'
    and (select count(distinct ico) between 1 and 3
         from public.complete_power_outage_notification_email_pilot_allowlist_v1
         where active_and_eligible_now)
  from definitions
  union all
  select 'LOGIC', 'pilot sends only allowlisted unsent plans',
    definitions.claim_def like '%complete_power_outage_notification_email_pilot_allowlist_v1%'
    and definitions.claim_def like '%active_and_eligible_now%'
    and definitions.claim_def like '%complete_power_outage_notification_email_pilot_send_outcomes%'
  from definitions
  union all
  select 'LOGIC', 'pilot auto completes and returns to SHADOW',
    definitions.claim_def like '%runtime_mode = ''shadow''%'
    and definitions.claim_def like '%dispatch_enabled = false%'
    and definitions.claim_def like '%reservation_enabled = false%'
  from definitions
  union all
  select 'LOGIC', 'Resend delivery bounce complaint and failures feed safety state',
    definitions.webhook_def like '%email.delivered%'
    and definitions.webhook_def like '%email.bounced%'
    and definitions.webhook_def like '%email.complained%'
    and definitions.webhook_def like '%email.failed%'
    and definitions.webhook_def like '%record_cpo_notification_email_pilot_safety_event_v1%'
  from definitions
  union all
  select 'LOGIC', 'admin EMAILY workspace exposes explicit LIVE activation',
    definitions.management_def like '%liveactivationavailable%'
  from definitions
  union all
  select 'ISOLATION', 'COMPLETE LIVE pilot functions do not reference MARKET email objects',
    definitions.activate_def not like '%market_client_email%'
    and definitions.pause_def not like '%market_client_email%'
    and definitions.claim_def not like '%market_client_email%'
    and definitions.webhook_def not like '%market_client_email%'
  from definitions
  union all
  select 'SAFETY', 'installation keeps COMPLETE LIVE dispatch disabled',
    email_state.runtime_mode = 'shadow'
    and not email_state.dispatch_enabled
    and not allowlist_state.live_dispatch_enabled
    and not rate_state.reservation_enabled
    and not safety_state.live_signal_ingestion_enabled
  from public.complete_power_outage_notification_email_state email_state
  cross join public.complete_power_outage_notification_email_pilot_allowlist_state allowlist_state
  cross join public.complete_power_outage_notification_email_pilot_rate_limit_state rate_state
  cross join public.complete_power_outage_notification_email_pilot_safety_state safety_state
  where email_state.singleton and allowlist_state.singleton and rate_state.singleton and safety_state.singleton
  union all
  select 'SAFETY', 'installation sends no real pilot email',
    not exists (
      select 1 from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      where outcome.outcome = 'sent'
    )
  union all
  select 'STATE', 'three current companies are ready for explicit pilot activation',
    (select count(distinct ico) = 3
     from public.complete_power_outage_notification_email_pilot_allowlist_v1
     where active_and_eligible_now)
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  email_state.runtime_mode,
  email_state.planning_enabled,
  email_state.dispatch_enabled,
  allowlist_state.live_dispatch_enabled,
  rate_state.reservation_enabled,
  safety_state.live_signal_ingestion_enabled,
  safety_state.is_paused,
  count(distinct allowlist_entry.ico) filter (where allowlist_entry.active_and_eligible_now) as selected_pilot_company_count,
  rate_state.daily_send_limit,
  rate_state.minimum_interval_seconds,
  count(distinct outcome.id) filter (where outcome.outcome = 'sent') as real_pilot_sent_count
from public.complete_power_outage_notification_email_state email_state
cross join public.complete_power_outage_notification_email_pilot_allowlist_state allowlist_state
cross join public.complete_power_outage_notification_email_pilot_rate_limit_state rate_state
cross join public.complete_power_outage_notification_email_pilot_safety_state safety_state
left join public.complete_power_outage_notification_email_pilot_allowlist_v1 allowlist_entry on true
left join public.complete_power_outage_notification_email_pilot_send_outcomes outcome on true
where email_state.singleton and allowlist_state.singleton and rate_state.singleton and safety_state.singleton
group by email_state.runtime_mode, email_state.planning_enabled, email_state.dispatch_enabled,
  allowlist_state.live_dispatch_enabled, rate_state.reservation_enabled,
  safety_state.live_signal_ingestion_enabled, safety_state.is_paused,
  rate_state.daily_send_limit, rate_state.minimum_interval_seconds;
