begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_staged_addresses') is null then
    raise exception 'Nejdříve spusťte migraci stagingového skenu ČEZ.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_staged_addresses
  add column if not exists normalization_version integer not null default 0,
  add column if not exists normalization_status text not null default 'pending',
  add column if not exists normalization_attempt_count integer not null default 0,
  add column if not exists normalized_at timestamptz,
  add column if not exists normalization_next_attempt_at timestamptz,
  add column if not exists normalization_error_code text,
  add column if not exists normalization_error_message text,
  add column if not exists normalization_lock_token uuid,
  add column if not exists normalization_lock_expires_at timestamptz;

alter table public.complete_power_outage_cez_staged_addresses
  drop constraint if exists cpo_cez_staged_addresses_normalization_version_check;
alter table public.complete_power_outage_cez_staged_addresses
  add constraint cpo_cez_staged_addresses_normalization_version_check
  check (normalization_version >= 0 and normalization_attempt_count >= 0);

alter table public.complete_power_outage_cez_staged_addresses
  drop constraint if exists cpo_cez_staged_addresses_normalization_status_check;
alter table public.complete_power_outage_cez_staged_addresses
  add constraint cpo_cez_staged_addresses_normalization_status_check
  check (normalization_status in ('pending', 'processing', 'succeeded', 'error', 'needs_review'));

alter table public.complete_power_outage_cez_staged_addresses
  drop constraint if exists cpo_cez_staged_addresses_normalization_lock_check;
alter table public.complete_power_outage_cez_staged_addresses
  add constraint cpo_cez_staged_addresses_normalization_lock_check
  check (
    (normalization_lock_token is null and normalization_lock_expires_at is null)
    or (normalization_lock_token is not null and normalization_lock_expires_at is not null)
  );

drop index if exists public.cpo_cez_staged_addresses_normalization_queue_idx;
create index cpo_cez_staged_addresses_normalization_queue_idx
  on public.complete_power_outage_cez_staged_addresses (
    normalization_status,
    normalization_next_attempt_at,
    id
  )
  where normalization_version < 2
    and normalization_status in ('pending', 'error');

-- Verze 2 bezpečně rozbaluje číselné rozsahy a umí použít samostatné
-- orientační číslo, pouze pokud je současně známá konkrétní ulice.
update public.complete_power_outage_cez_staged_addresses
set normalization_status = 'pending',
    normalization_attempt_count = 0,
    normalization_next_attempt_at = null,
    normalization_error_code = null,
    normalization_error_message = null,
    normalization_lock_token = null,
    normalization_lock_expires_at = null
where normalization_version < 2
  and normalization_status in ('succeeded', 'error', 'needs_review');

create table if not exists public.complete_power_outage_cez_staged_address_targets (
  id uuid primary key default gen_random_uuid(),
  staged_address_id uuid not null
    references public.complete_power_outage_cez_staged_addresses(id) on delete cascade,
  target_key text not null,
  target_kind text not null,
  municipality text not null default '',
  town_part text,
  street text not null default '',
  number_token text,
  query_text text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_staged_targets_key_check
    check (target_key ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_staged_targets_kind_check
    check (target_kind in ('exact_number', 'street', 'municipality')),
  constraint cpo_cez_staged_targets_query_check
    check (length(btrim(query_text)) between 1 and 300),
  constraint cpo_cez_staged_targets_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_cez_staged_targets_address_key_unique
    unique (staged_address_id, target_key)
);

create index if not exists cpo_cez_staged_targets_address_idx
  on public.complete_power_outage_cez_staged_address_targets (staged_address_id);

create index if not exists cpo_cez_staged_targets_audit_idx
  on public.complete_power_outage_cez_staged_address_targets (
    target_kind,
    municipality,
    street,
    number_token
  );

drop trigger if exists cpo_cez_staged_targets_set_updated_at
  on public.complete_power_outage_cez_staged_address_targets;
create trigger cpo_cez_staged_targets_set_updated_at
before update on public.complete_power_outage_cez_staged_address_targets
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_staged_address_targets enable row level security;

drop policy if exists cpo_cez_staged_targets_authorized_read
  on public.complete_power_outage_cez_staged_address_targets;
create policy cpo_cez_staged_targets_authorized_read
  on public.complete_power_outage_cez_staged_address_targets
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_staged_address_targets
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_staged_address_targets to authenticated;
grant all on table public.complete_power_outage_cez_staged_address_targets to service_role;

create or replace function public.claim_complete_power_outage_cez_staged_address_batch(
  requested_limit integer default 100
)
returns table (
  id uuid,
  outage_external_id text,
  municipality text,
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
  safe_limit integer := least(500, greatest(1, coalesce(requested_limit, 100)));
  batch_token uuid := gen_random_uuid();
begin
  update public.complete_power_outage_cez_staged_addresses address
  set normalization_status = 'error',
      normalization_next_attempt_at = now(),
      normalization_error_code = 'CEZ_STAGED_NORMALIZATION_LOCK_EXPIRED',
      normalization_error_message = 'Předchozí normalizace adresy nebyla dokončena v bezpečnostním limitu.',
      normalization_lock_token = null,
      normalization_lock_expires_at = null
  where address.normalization_status = 'processing'
    and address.normalization_lock_expires_at <= now();

  return query
  with candidates as (
    select address.id
    from public.complete_power_outage_cez_staged_addresses address
    where address.normalization_version < 2
      and address.normalization_status in ('pending', 'error')
      and (
        address.normalization_next_attempt_at is null
        or address.normalization_next_attempt_at <= now()
      )
    order by
      case address.normalization_status when 'pending' then 0 else 1 end,
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
    claimed.town_part,
    claimed.street,
    claimed.house_number,
    claimed.orientation_number,
    claimed.raw_address,
    claimed.metadata,
    claimed.normalization_attempt_count,
    claimed.normalization_lock_token
  from claimed
  order by claimed.id;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  to service_role;

create or replace function public.request_complete_power_outage_cez_staged_address_normalization(
  requested_limit integer default 100
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(500, greatest(1, coalesce(requested_limit, 100)));
  request_id bigint;
begin
  select trim(trailing '/' from decrypted_secret)
  into app_url
  from vault.decrypted_secrets
  where name = 'weather_alerts_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret
  into automation_token
  from vault.decrypted_secrets
  where name = 'weather_alerts_automation_token'
  order by created_at desc
  limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace bez cesty.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url
      || '/api/power-outages/complete/cez/staging/normalize?limit='
      || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-CEZ-Staging-Normalizer/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_cez_staged_address_normalization(integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_cez_staged_address_normalization(integer)
  to service_role;

commit;
