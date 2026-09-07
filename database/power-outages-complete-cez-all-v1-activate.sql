-- Spustit az po uspesnem deploymentu aplikace a po samych hodnotach true
-- z auditu power-outages-complete-cez-all-v1.sql.
select public.set_complete_power_outage_cez_source('shadow');

-- Aktivace sama zalozi nezmenitelny manifest a zaradi prvni ostrou
-- synchronizaci CEZ. Nasledujici kontrola potvrdi stav bez cekani na worker.
select
  state.active_source = 'shadow' as cez_all_v1_is_active,
  state.previous_source = 'legacy' as legacy_is_rollback_source,
  state.metadata ->> 'activeProductName' as active_product_name,
  state.metadata ->> 'preservationManifestId' as preservation_manifest_id,
  state.metadata ->> 'requiredSafeCycleCount' as required_safe_cycle_count
from public.complete_power_outage_cez_projection_state state
where state.singleton;
