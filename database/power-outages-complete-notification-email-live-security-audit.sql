-- Krok 10.8: hlavni LIVE bezpecnostni audit. Vsechny radky v prvni
-- tabulce musi byt true. Dotaz je read-only a nic neaktivuje.
select check_type, object_name, is_correct
from public.audit_cpo_notification_email_live_readiness_v1()
order by check_type, object_name;

-- Provozni souhrn pro pripravu kroku 10.9. Nulovy allowlist neni chyba
-- bezpecnostniho auditu; znamena pouze, ze jeste nebyl sestaven pilot.
select
  (select bool_and(audit.is_correct)
   from public.audit_cpo_notification_email_live_readiness_v1() audit)
    as technical_security_ready,
  email_state.runtime_mode,
  email_state.planning_enabled,
  email_state.dispatch_enabled,
  allowlist_state.configured_max_company_count,
  allowlist_state.hard_max_company_count,
  count(distinct allowlist_entry.ico) filter (
    where allowlist_entry.active_and_eligible_now
  ) as selected_pilot_company_count,
  count(distinct allowlist_entry.ico) filter (
    where allowlist_entry.active_and_eligible_now
  ) between 1 and allowlist_state.configured_max_company_count
    as pilot_selection_ready,
  rate_state.daily_send_limit,
  rate_state.minimum_interval_seconds,
  rate_state.reservation_enabled,
  safety_state.is_paused,
  safety_state.live_signal_ingestion_enabled,
  safety_state.consecutive_transient_failure_count,
  safety_state.transient_failure_threshold
from public.complete_power_outage_notification_email_state email_state
cross join public.complete_power_outage_notification_email_pilot_allowlist_state allowlist_state
cross join public.complete_power_outage_notification_email_pilot_rate_limit_state rate_state
cross join public.complete_power_outage_notification_email_pilot_safety_state safety_state
left join public.complete_power_outage_notification_email_pilot_allowlist_v1 allowlist_entry
  on allowlist_entry.active_and_eligible_now
where email_state.singleton
  and allowlist_state.singleton
  and rate_state.singleton
  and safety_state.singleton
group by
  email_state.runtime_mode,
  email_state.planning_enabled,
  email_state.dispatch_enabled,
  allowlist_state.configured_max_company_count,
  allowlist_state.hard_max_company_count,
  rate_state.daily_send_limit,
  rate_state.minimum_interval_seconds,
  rate_state.reservation_enabled,
  safety_state.is_paused,
  safety_state.live_signal_ingestion_enabled,
  safety_state.consecutive_transient_failure_count,
  safety_state.transient_failure_threshold;
