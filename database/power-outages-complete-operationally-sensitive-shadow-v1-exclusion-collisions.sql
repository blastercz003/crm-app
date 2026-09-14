-- KROK 4 / VYSTUP 4: pouze potencialni kolize.
-- Ukaze vybrane zaznamy, u kterych se soucasne trefilo nektere vylucovaci
-- pravidlo. Prazdny vysledek znamena, ze zadnou takovou kolizi nemame.

with latest_run as (
  select state.latest_shadow_run_id as run_id
  from public.complete_power_outage_operational_sensitivity_state state
  join public.complete_power_outage_operational_sensitivity_shadow_runs run
    on run.id = state.latest_shadow_run_id
   and run.status = 'complete'
  where state.singleton
), collisions as (
  select
    result.*,
    array(
      select rule.rule_key
      from public.complete_power_outage_operational_sensitivity_rules rule
      where rule.rule_key = any(result.matched_rule_keys)
        and rule.effect = 'exclude'
      order by rule.priority desc, rule.rule_key
    ) as matched_exclusion_rule_keys
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_run on latest_run.run_id = result.run_id
  where result.is_eligible
)
select
  collisions.company_name,
  collisions.ico,
  collisions.outage_source,
  collisions.starts_at,
  collisions.ends_at,
  collisions.category,
  collisions.winning_rule_key,
  collisions.matched_exclusion_rule_keys,
  collisions.primary_nace_codes,
  collisions.employee_count_min,
  collisions.exact_mapy_labels
from collisions
where cardinality(collisions.matched_exclusion_rule_keys) > 0
order by collisions.company_name, collisions.starts_at;
