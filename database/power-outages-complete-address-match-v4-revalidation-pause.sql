-- Okamzite zastavi nove claimy a HTTP pozadavky. Jiz bezici pozadavek muze
-- bezpecne dokoncit pouze svoji SHADOW polozku pomoci platneho lease tokenu.
select public.pause_complete_power_outage_address_revalidation_v4_v1('manual_sql_pause')
  as address_revalidation_pause;
