-- Souhrn posledního SHADOW běhu. Spustit po technickém auditu.
select
  run.id as run_id,
  run.status,
  run.target_count,
  run.eligible_count,
  run.excluded_count,
  run.no_match_count,
  run.eligible_without_mapy_count,
  round(100.0 * run.eligible_count / nullif(run.target_count, 0), 2)
    as eligible_percent,
  run.started_at,
  run.finished_at
from public.complete_power_outage_operational_sensitivity_shadow_runs run
join public.complete_power_outage_operational_sensitivity_state state
  on state.latest_shadow_run_id = run.id
where state.singleton;
