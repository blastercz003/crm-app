begin;

-- Jednorázově opraví distribuční území již zpracovaných adres MARKETY.
-- Párování odstávek ani tabulky režimu KOMPLETNÍ tato migrace nemění.
-- Explicitní označení DSO z adresního API má vždy přednost. Praha a Roztoky
-- tvoří území PRE; u zbývající ověřené adresy s prázdným DSO víme, že nejde
-- o ČEZ, a v modelu tří sledovaných velkých distributorů ji vedeme jako EG.D.
with classification as (
  select
    registry.id,
    regexp_replace(
      lower(public.unaccent(coalesce(registry.metadata ->> 'selectedDso', ''))),
      '[^a-z0-9]+',
      '',
      'g'
    ) as compact_dso,
    registry.distributor as previous_distributor,
    registry.ruian_address_id,
    registry.municipality_code
  from public.power_outage_store_registry registry
  where registry.is_active
), resolved as (
  select
    classification.id,
    case
      when compact_dso like '%cez%' then 'cez'
      when compact_dso like '%egd%' or compact_dso like '%eon%' then 'egd'
      when compact_dso like '%predistribuce%' or compact_dso = 'pre' then 'pre'
      when previous_distributor in ('cez', 'egd', 'pre') then previous_distributor
      when ruian_address_id is null then 'unknown'
      when municipality_code in ('554782', '539627') then 'pre'
      else 'egd'
    end as next_distributor,
    case
      when compact_dso like '%cez%'
        or compact_dso like '%egd%'
        or compact_dso like '%eon%'
        or compact_dso like '%predistribuce%'
        or compact_dso = 'pre'
      then 'address-api-dso'
      when previous_distributor in ('cez', 'egd', 'pre') then 'preserved'
      when ruian_address_id is null then 'unresolved-address'
      when municipality_code in ('554782', '539627') then 'ruian-major-dso-territory-v1'
      else 'non-cez-major-dso-territory-v1'
    end as classification_method,
    case
      when compact_dso like '%cez%'
        or compact_dso like '%egd%'
        or compact_dso like '%eon%'
        or compact_dso like '%predistribuce%'
        or compact_dso = 'pre'
        or previous_distributor in ('cez', 'egd', 'pre')
      then 'verified'
      when ruian_address_id is not null then 'probable'
      else 'unknown'
    end as classification_confidence
  from classification
)
update public.power_outage_store_registry registry
set distributor = resolved.next_distributor,
    metadata = registry.metadata || jsonb_build_object(
      'distributorClassificationVersion', 3,
      'distributorClassificationMethod', resolved.classification_method,
      'distributorClassificationConfidence', resolved.classification_confidence,
      'distributorClassifiedAt', now()
    ),
    updated_at = now()
from resolved
where registry.id = resolved.id
  and (
    registry.distributor is distinct from resolved.next_distributor
    or coalesce((registry.metadata ->> 'distributorClassificationVersion')::integer, 0) < 3
  );

commit;
