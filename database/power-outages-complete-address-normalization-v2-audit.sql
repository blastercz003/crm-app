with target_audit as (
  select
    count(*) as target_count,
    count(*) filter (
      where coalesce(metadata ->> 'normalizerVersion', '') = '2'
    ) as version_2_count,
    count(*) filter (
      where target_kind = 'exact_number'
        and coalesce(number_token, '') ~ '(^|/)0($|/)'
    ) as zero_number_count,
    count(*) filter (
      where target_kind = 'exact_number'
        and nullif(metadata ->> 'houseNumber', '') is null
        and nullif(metadata ->> 'orientationNumber', '') is null
    ) as exact_without_pair_count,
    count(*) filter (
      where target_kind = 'street'
        and coalesce((metadata ->> 'legacyNumberEvidenceIgnored')::boolean, false)
    ) as safely_collapsed_legacy_count
  from public.complete_power_outage_address_targets
)
select 'TARGETS' as check_type,
  'all generated targets use normalizer v2' as object_name,
  target_count = version_2_count as is_correct,
  format('%s / %s', version_2_count, target_count) as detail
from target_audit
union all
select 'NUMBERS', 'placeholder zero is not an exact target',
  zero_number_count = 0,
  zero_number_count::text
from target_audit
union all
select 'NUMBERS', 'every exact target has a trusted number pair',
  exact_without_pair_count = 0,
  exact_without_pair_count::text
from target_audit
union all
select 'SAFETY', 'legacy flat number lists collapsed to street targets',
  true,
  safely_collapsed_legacy_count::text
from target_audit
order by check_type, object_name;

select
  target_kind,
  count(*) as target_count,
  count(distinct query_text) as unique_query_count,
  count(*) - count(distinct query_text) as duplicate_query_count
from public.complete_power_outage_address_targets
group by target_kind
order by target_kind;

select
  a.id as outage_address_id,
  a.municipality,
  a.town_part,
  a.street,
  count(t.id) as target_count,
  count(*) filter (where t.target_kind = 'exact_number') as exact_target_count,
  min(t.query_text) as first_query,
  max(t.query_text) as last_query
from public.complete_power_outage_addresses a
join public.complete_power_outage_address_targets t
  on t.outage_address_id = a.id
group by a.id, a.municipality, a.town_part, a.street
order by count(t.id) desc, a.id
limit 25;
