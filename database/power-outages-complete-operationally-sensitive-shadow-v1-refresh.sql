-- Spustit samostatně až po instalaci SHADOW klasifikátoru.
-- Pouze databázový výpočet; bez HTTP a bez změny produkčních filtrů či e-mailů.
select public.refresh_complete_power_outage_operational_sensitivity_shadow_v1() as run_id;
