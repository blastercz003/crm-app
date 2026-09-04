begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_staged_addresses') is null
    or to_regclass('public.complete_power_outage_cez_staged_address_targets') is null
  then
    raise exception 'Nejdříve spusťte migraci stagingových adres a cílů ČEZ.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_staged_address_targets
  add column if not exists validation_version integer not null default 0,
  add column if not exists validation_status text not null default 'unverified',
  add column if not exists ruian_address_code text,
  add column if not exists ruian_building_type text,
  add column if not exists verified_house_number text,
  add column if not exists verified_orientation_number text,
  add column if not exists postal_code text,
  add column if not exists ruian_sjtsk_y double precision,
  add column if not exists ruian_sjtsk_x double precision,
  add column if not exists validation_detail jsonb not null default '{}'::jsonb;

alter table public.complete_power_outage_cez_staged_address_targets
  drop constraint if exists cpo_cez_staged_targets_validation_status_check;
alter table public.complete_power_outage_cez_staged_address_targets
  add constraint cpo_cez_staged_targets_validation_status_check
  check (validation_status in ('unverified', 'verified', 'fallback', 'needs_review', 'error'));

alter table public.complete_power_outage_cez_staged_address_targets
  drop constraint if exists cpo_cez_staged_targets_validation_check;
alter table public.complete_power_outage_cez_staged_address_targets
  add constraint cpo_cez_staged_targets_validation_check
  check (
    validation_version >= 0
    and jsonb_typeof(validation_detail) = 'object'
    and (
      validation_status <> 'verified'
      or (
        validation_version >= 1
        and target_kind = 'exact_number'
        and ruian_address_code ~ '^[0-9]+$'
        and (verified_house_number is not null or verified_orientation_number is not null)
      )
    )
    and (
      (ruian_sjtsk_y is null and ruian_sjtsk_x is null)
      or (
        ruian_sjtsk_y is not null and ruian_sjtsk_y > 0
        and ruian_sjtsk_x is not null and ruian_sjtsk_x > 0
      )
    )
  );

create unique index if not exists cpo_cez_staged_targets_ruian_address_uidx
  on public.complete_power_outage_cez_staged_address_targets (
    staged_address_id,
    ruian_address_code
  )
  where ruian_address_code is not null;

create index if not exists cpo_cez_staged_targets_validation_audit_idx
  on public.complete_power_outage_cez_staged_address_targets (
    validation_status,
    target_kind,
    municipality,
    street
  );

drop index if exists public.cpo_cez_staged_addresses_normalization_queue_idx;
create index cpo_cez_staged_addresses_normalization_queue_idx
  on public.complete_power_outage_cez_staged_addresses (
    normalization_status,
    normalization_next_attempt_at,
    municipality_code,
    id
  )
  where normalization_version < 3
    and normalization_status in ('pending', 'error');

-- Všechny cíle verze 2 musí projít skutečným RÚIAN adresním souborem.
-- Existující cíle zatím nemažeme; vymění je až úspěšná validace konkrétní
-- stagingové adresy. Chyba RÚIAN tak nezpůsobí dočasnou ztrátu dat.
update public.complete_power_outage_cez_staged_addresses
set normalization_status = 'pending',
    normalization_attempt_count = 0,
    normalization_next_attempt_at = null,
    normalization_error_code = null,
    normalization_error_message = null,
    normalization_lock_token = null,
    normalization_lock_expires_at = null
where normalization_version < 3
  and normalization_status in ('succeeded', 'error', 'needs_review');

drop function if exists public.claim_complete_power_outage_cez_staged_address_batch(integer);
create function public.claim_complete_power_outage_cez_staged_address_batch(
  requested_limit integer default 8
)
returns table (
  id uuid,
  outage_external_id text,
  municipality text,
  municipality_code text,
  town_part text,
  street text,
  house_number text,
  orientation_number text,
  raw_address text,
  metadata jsonb,
  normalization_attempt_count integer,
  normalization_lock_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(8, greatest(1, coalesce(requested_limit, 8)));
  batch_token uuid := gen_random_uuid();
begin
  update public.complete_power_outage_cez_staged_addresses address
  set normalization_status = 'error',
      normalization_next_attempt_at = now(),
      normalization_error_code = 'CEZ_RUIAN_VALIDATION_LOCK_EXPIRED',
      normalization_error_message = 'Předchozí validace RÚIAN nebyla dokončena v bezpečnostním limitu.',
      normalization_lock_token = null,
      normalization_lock_expires_at = null
  where address.normalization_status = 'processing'
    and address.normalization_lock_expires_at <= now();

  return query
  with candidates as (
    select address.id
    from public.complete_power_outage_cez_staged_addresses address
    where address.normalization_version < 3
      and address.normalization_status in ('pending', 'error')
      and (
        address.normalization_next_attempt_at is null
        or address.normalization_next_attempt_at <= now()
      )
    order by
      case address.normalization_status when 'pending' then 0 else 1 end,
      address.municipality_code nulls last,
      address.id
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_cez_staged_addresses address
    set normalization_status = 'processing',
        normalization_attempt_count = address.normalization_attempt_count + 1,
        normalization_lock_token = batch_token,
        normalization_lock_expires_at = now() + interval '10 minutes',
        normalization_error_code = null,
        normalization_error_message = null
    from candidates
    where address.id = candidates.id
    returning address.*
  )
  select
    claimed.id,
    claimed.outage_external_id,
    claimed.municipality,
    claimed.municipality_code,
    claimed.town_part,
    claimed.street,
    claimed.house_number,
    claimed.orientation_number,
    claimed.raw_address,
    claimed.metadata,
    claimed.normalization_attempt_count,
    claimed.normalization_lock_token
  from claimed
  order by claimed.municipality_code nulls last, claimed.id;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  to service_role;

commit;
