-- Spoustejte opakovane, dokud batch_result nevrati status "complete"
-- a remainingCount 0. Jedna davka zpracuje nejvyse 2 000 ulozenych dukazu.
select public.refresh_complete_power_outage_address_match_v4_shadow_v1(2000)
  as batch_result;
