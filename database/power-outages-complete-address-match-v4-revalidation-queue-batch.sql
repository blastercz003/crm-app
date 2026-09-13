-- Spoustejte opakovane, dokud status nebude "complete" a remainingCount 0.
-- Davka pouze pripravuje SHADOW frontu; neprovadi zadny HTTP pozadavek.
select public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(2000)
  as address_revalidation_queue_batch;
