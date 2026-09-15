-- Ciste cteci audit opravy CEZ RUIAN adres bez ulice v tabu KOMPLETNI.
-- Nespousti normalizaci, providerovy lookup ani jinou mutaci.
with manifest_scope as (
  select manifest.*, outage.source, outage.source_status, outage.ends_at,
    address.normalization_version, address.address_scope, address.street,
    address.ruian_address_id as current_ruian_address_id
  from public.complete_power_outage_cez_number_only_target_backfill_v1 manifest
  join public.complete_power_outage_addresses address
    on address.id = manifest.address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
), checks as (
  select 'DATA'::text as check_type,
    'every captured CEZ address is queued or rebuilt'::text as object_name,
    not exists (
      select 1 from manifest_scope scope
      where scope.normalization_version >= 2
        and not exists (
          select 1 from public.complete_power_outage_address_targets target
          where target.outage_address_id = scope.address_id
            and target.target_kind = 'exact_number'
        )
    ) as is_correct

  union all
  select 'DATA', 'rebuilt exact target keeps the CEZ number only contract',
    not exists (
      select 1
      from manifest_scope scope
      join public.complete_power_outage_address_targets target
        on target.outage_address_id = scope.address_id
       and target.target_kind = 'exact_number'
      where coalesce((target.metadata ->> 'cezRuianNumberOnlyExact')::boolean, false) is false
        or target.metadata ->> 'targetContractVersion' is distinct from '3'
    )

  union all
  select 'ISOLATION', 'backfill contains only COMPLETE CEZ outages',
    not exists (select 1 from manifest_scope scope where scope.source <> 'cez')

  union all
  select 'ISOLATION', 'PRE and EGD are absent from the backfill manifest',
    not exists (select 1 from manifest_scope scope where scope.source in ('pre', 'egd'))

  union all
  select 'LOGIC', 'captured addresses are verified RUIAN number only addresses',
    not exists (
      select 1 from manifest_scope scope
      where scope.current_ruian_address_id is null
        or nullif(btrim(coalesce(scope.street, '')), '') is not null
        or (
          nullif(btrim(coalesce(scope.house_number, '')), '') is null
          and nullif(btrim(coalesce(scope.orientation_number, '')), '') is null
        )
    )

  union all
  select 'SAFETY', 'backfill manifest does not reference MARKET objects',
    not exists (
      select 1
      from pg_constraint constraint_row
      join pg_class referenced_table
        on referenced_table.oid = constraint_row.confrelid
      where constraint_row.conrelid =
        'public.complete_power_outage_cez_number_only_target_backfill_v1'::regclass
        and lower(referenced_table.relname) like '%market%'
    )

  union all
  select 'STATE', 'CEZ number only backfill manifest exists',
    to_regclass('public.complete_power_outage_cez_number_only_target_backfill_v1') is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  count(distinct manifest.address_id)::bigint as captured_address_count,
  count(distinct manifest.address_id) filter (
    where address.normalization_version < 2
  )::bigint
    as remaining_normalization_count,
  count(distinct manifest.address_id) filter (
    where exact_target.id is not null
  )::bigint
    as rebuilt_exact_address_count,
  count(distinct manifest.address_id) filter (
    where exact_target.id is not null
      and ares_lookup.id is null
  )::bigint as waiting_for_ares_count,
  count(distinct manifest.address_id) filter (
    where exact_target.id is not null
      and mapy_lookup.id is null
  )::bigint as waiting_for_mapy_count,
  count(distinct manifest.address_id) filter (
    where ares_lookup.lookup_status = 'error'
  )::bigint
    as ares_error_count,
  count(distinct manifest.address_id) filter (
    where mapy_lookup.lookup_status = 'error'
  )::bigint
    as mapy_error_count
from public.complete_power_outage_cez_number_only_target_backfill_v1 manifest
join public.complete_power_outage_addresses address
  on address.id = manifest.address_id
left join public.complete_power_outage_address_targets exact_target
  on exact_target.outage_address_id = manifest.address_id
 and exact_target.target_kind = 'exact_number'
left join public.complete_power_outage_target_lookups ares_lookup
  on ares_lookup.target_id = exact_target.id
 and ares_lookup.provider = 'ares'
left join public.complete_power_outage_target_lookups mapy_lookup
  on mapy_lookup.target_id = exact_target.id
 and mapy_lookup.provider = 'mapy';
