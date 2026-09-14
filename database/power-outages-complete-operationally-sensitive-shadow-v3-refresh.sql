-- Lokalni databazovy SHADOW prepocet v3. Bez ARES/Mapy HTTP a bez produkcni aktivace.
select public.refresh_complete_power_outage_operational_sensitivity_shadow_v3()
  as shadow_run_id;
