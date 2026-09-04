begin;

do $$
begin
  if to_regprocedure(
    'public.record_complete_power_outage_cez_cycle_outages(uuid,text,jsonb)'
  ) is null
    or to_regprocedure(
      'public.finish_complete_power_outage_cez_scan_cycle(uuid)'
    ) is null
  then
    raise exception 'Nejdříve spusťte migraci bezpečných cyklických snapshotů ČEZ.';
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null
    and to_regprocedure('extensions.digest(bytea,text)') is null
  then
    raise exception 'Rozšíření pgcrypto není dostupné ve schématu extensions.';
  end if;
end
$$;

-- Nasazená verze funkcí používá bezpečně omezený search_path. Doplnění
-- schématu extensions zpřístupní pgcrypto.digest bez zásahu do jejich logiky.
alter function public.record_complete_power_outage_cez_cycle_outages(uuid, text, jsonb)
  set search_path = pg_catalog, extensions;

alter function public.finish_complete_power_outage_cez_scan_cycle(uuid)
  set search_path = pg_catalog, extensions;

commit;
