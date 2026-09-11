-- Spustit až po:
-- 1. power-outages-complete-large-companies-audit-foundation.sql
-- 2. nasazení aplikačního ARES/RES workeru s kontraktem
--    complete-company-ares-res-v2.
--
-- Pouze zařadí chybějící profily do již existující řízené ARES/RES fronty.
-- Nemění odstávky, kandidáty, skóre, TOP VÝBĚR ani UI.
select public.enqueue_complete_power_outage_large_company_audit_enrichment()
  as queued_or_requeued_ico_count;

-- Průběh lze bezpečně sledovat tímto čtecím dotazem. Audit je připravený,
-- až waiting_for_audit_data = 0; kód 000 zůstává korektně „velikost neznámá“.
select
  count(*) filter (
    where input.ico is not null
      and not input.audit_profile_current
  ) as waiting_for_audit_data,
  count(*) filter (where input.employee_size_known) as known_size_record_count,
  count(*) filter (
    where input.employee_category_code = '000'
  ) as explicitly_unknown_size_record_count,
  max(input.profile_fetched_at) as newest_profile_at
from public.complete_power_outage_large_company_audit_inputs input;
