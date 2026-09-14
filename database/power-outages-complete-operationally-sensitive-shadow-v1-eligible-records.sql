-- KROK 4 / VYSTUP 3: konkretni zaznamy vybrane filtrem.
-- Jeden read-only SELECT. Neobsahuje kontaktni ani komunikacni data.

with latest_run as (
  select state.latest_shadow_run_id as run_id
  from public.complete_power_outage_operational_sensitivity_state state
  join public.complete_power_outage_operational_sensitivity_shadow_runs run
    on run.id = state.latest_shadow_run_id
   and run.status = 'complete'
  where state.singleton
)
select
  result.company_name,
  result.ico,
  result.outage_source,
  address.municipality as outage_municipality,
  address.street as outage_street,
  address.house_number as outage_house_number,
  address.orientation_number as outage_orientation_number,
  address.postal_code as outage_postal_code,
  result.starts_at,
  result.ends_at,
  result.category,
  result.decision_source,
  result.winning_rule_key,
  result.primary_nace_codes,
  result.employee_count_min,
  result.exact_mapy_labels,
  result.mapy_evidence_available
from public.complete_power_outage_operational_sensitivity_shadow_results result
join latest_run on latest_run.run_id = result.run_id
join public.complete_power_outage_companies company
  on company.id = result.candidate_id
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
where result.is_eligible
order by result.category, result.company_name, result.starts_at, result.candidate_id;
