-- KROK 4 / VYSTUP 1: slozeni vybranych zaznamu.
-- Jeden read-only SELECT nad poslednim dokonceny SHADOW behem.

with latest_run as (
  select state.latest_shadow_run_id as run_id
  from public.complete_power_outage_operational_sensitivity_state state
  join public.complete_power_outage_operational_sensitivity_shadow_runs run
    on run.id = state.latest_shadow_run_id
   and run.status = 'complete'
  where state.singleton
), eligible as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_run on latest_run.run_id = result.run_id
  where result.is_eligible
)
select
  eligible.category,
  eligible.decision_source,
  eligible.winning_rule_key,
  count(*)::bigint as record_count,
  count(distinct eligible.ico) filter (where eligible.ico is not null)::bigint
    as unique_ico_count,
  count(*) filter (where eligible.outage_source = 'cez')::bigint as cez_count,
  count(*) filter (where eligible.outage_source = 'egd')::bigint as egd_count,
  count(*) filter (where eligible.outage_source = 'pre')::bigint as pre_count,
  count(*) filter (where eligible.employee_count_min is null)::bigint
    as unknown_employee_size_count,
  count(*) filter (where eligible.mapy_evidence_available)::bigint
    as with_exact_mapy_count,
  count(*) filter (where not eligible.mapy_evidence_available)::bigint
    as without_mapy_count
from eligible
group by eligible.category, eligible.decision_source, eligible.winning_rule_key
order by record_count desc, eligible.category, eligible.winning_rule_key;
