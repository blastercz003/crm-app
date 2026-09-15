begin;

-- KOMPLETNI / CEZ only. Tato migrace nevytvari targety ani nevola externi
-- sluzby. Pouze auditne zaznamena presne RUIAN adresy bez ulice, kterym chybi
-- exact target, a vrati je do existujici interni normalizacni fronty.
do $$
begin
  if to_regclass('public.complete_power_outages') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outage_address_targets') is null
  then
    raise exception 'Chybi zavislosti katalogu KOMPLETNI.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_cez_number_only_target_backfill_v1 (
  address_id uuid primary key,
  outage_id uuid not null,
  outage_external_id text not null,
  municipality text not null,
  town_part text,
  house_number text,
  orientation_number text,
  postal_code text,
  ruian_address_id bigint not null,
  previous_normalization_version integer not null,
  previous_target_kinds jsonb not null,
  captured_at timestamptz not null default now(),
  constraint cpo_cez_number_only_backfill_target_kinds_check
    check (jsonb_typeof(previous_target_kinds) = 'array')
);

comment on table public.complete_power_outage_cez_number_only_target_backfill_v1 is
  'Nemenna vstupni mnozina CEZ RUIAN adres bez ulice, ktere byly vraceny do normalizace kvuli chybejicimu exact targetu.';

alter table public.complete_power_outage_cez_number_only_target_backfill_v1
  enable row level security;

revoke all on table public.complete_power_outage_cez_number_only_target_backfill_v1
  from public, anon, authenticated;
grant all on table public.complete_power_outage_cez_number_only_target_backfill_v1
  to service_role;

insert into public.complete_power_outage_cez_number_only_target_backfill_v1 (
  address_id,
  outage_id,
  outage_external_id,
  municipality,
  town_part,
  house_number,
  orientation_number,
  postal_code,
  ruian_address_id,
  previous_normalization_version,
  previous_target_kinds
)
select
  address.id,
  outage.id,
  outage.external_id,
  address.municipality,
  address.town_part,
  address.house_number,
  address.orientation_number,
  address.postal_code,
  address.ruian_address_id,
  address.normalization_version,
  coalesce((
    select jsonb_agg(kinds.target_kind order by kinds.target_kind)
    from (
      select distinct target.target_kind
      from public.complete_power_outage_address_targets target
      where target.outage_address_id = address.id
    ) kinds
  ), '[]'::jsonb)
from public.complete_power_outage_addresses address
join public.complete_power_outages outage on outage.id = address.outage_id
where outage.source = 'cez'
  and outage.source_status in ('scheduled', 'active')
  and outage.ends_at >= now()
  and address.normalization_version >= 2
  and address.address_scope = 'exact'
  and address.ruian_address_id is not null
  and nullif(btrim(coalesce(address.street, '')), '') is null
  and nullif(btrim(coalesce(address.municipality, '')), '') is not null
  and (
    nullif(btrim(coalesce(address.house_number, '')), '') is not null
    or nullif(btrim(coalesce(address.orientation_number, '')), '') is not null
  )
  and not exists (
    select 1
    from public.complete_power_outage_address_targets target
    where target.outage_address_id = address.id
      and target.target_kind = 'exact_number'
  )
on conflict (address_id) do nothing;

update public.complete_power_outage_addresses address
set normalization_version = 0,
    normalized_at = null
from public.complete_power_outage_cez_number_only_target_backfill_v1 manifest
join public.complete_power_outages outage
  on outage.id = manifest.outage_id
where address.id = manifest.address_id
  and outage.source = 'cez'
  and outage.source_status in ('scheduled', 'active')
  and outage.ends_at >= now()
  and address.ruian_address_id = manifest.ruian_address_id
  and nullif(btrim(coalesce(address.street, '')), '') is null
  and not exists (
    select 1
    from public.complete_power_outage_address_targets target
    where target.outage_address_id = address.id
      and target.target_kind = 'exact_number'
  );

commit;

select
  count(*)::bigint as captured_address_count,
  count(*) filter (where address.normalization_version < 2)::bigint
    as queued_address_count,
  count(*) filter (where exists (
    select 1
    from public.complete_power_outage_address_targets target
    where target.outage_address_id = manifest.address_id
      and target.target_kind = 'exact_number'
  ))::bigint as already_rebuilt_address_count
from public.complete_power_outage_cez_number_only_target_backfill_v1 manifest
join public.complete_power_outage_addresses address
  on address.id = manifest.address_id;
