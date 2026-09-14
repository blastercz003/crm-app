-- Po nasazeni SHADOW v2 spusti jeden lokalni databazovy prepocet.
-- Nevola ARES ani Mapy.com a nic neaktivuje v produkci.
select public.refresh_complete_power_outage_operational_sensitivity_shadow_v2()
  as shadow_run_id;
