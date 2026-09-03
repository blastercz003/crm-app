begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_municipalities') is null
    or to_regclass('public.complete_power_outage_cez_scan_cycles') is null
    or to_regclass('public.complete_power_outage_cez_scan_attempts') is null
  then
    raise exception 'Nejdříve spusťte základní migraci celoplošného ČEZ katalogu.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_cez_staged_outages (
  external_id text primary key,
  source_status text not null,
  title text,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  archive_at timestamptz not null,
  municipality text,
  municipality_code text,
  district text,
  region text,
  source_url text,
  announcement_url text,
  payload_sha256 text not null,
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_seen_cycle_id uuid references public.complete_power_outage_cez_scan_cycles(id) on delete set null,
  missing_since timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_staged_outages_external_check
    check (length(btrim(external_id)) between 1 and 256),
  constraint cpo_cez_staged_outages_status_check
    check (source_status in ('scheduled', 'active', 'completed', 'cancelled')),
  constraint cpo_cez_staged_outages_period_check
    check (ends_at > starts_at and archive_at = ends_at),
  constraint cpo_cez_staged_outages_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_staged_outages_seen_check
    check (last_seen_at >= first_seen_at),
  constraint cpo_cez_staged_outages_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_cez_staged_outages_timeline_idx
  on public.complete_power_outage_cez_staged_outages (archive_at, starts_at);

create index if not exists cpo_cez_staged_outages_cycle_idx
  on public.complete_power_outage_cez_staged_outages (last_seen_cycle_id, external_id);

create table if not exists public.complete_power_outage_cez_staged_addresses (
  id uuid primary key default gen_random_uuid(),
  outage_external_id text not null
    references public.complete_power_outage_cez_staged_outages(external_id) on delete cascade,
  external_address_id text,
  address_key text not null,
  municipality text not null default '',
  municipality_code text,
  town_part text,
  street text not null default '',
  house_number text,
  orientation_number text,
  postal_code text,
  raw_address text not null default '',
  normalized_municipality text not null default '',
  normalized_street text not null default '',
  latitude double precision,
  longitude double precision,
  payload_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_staged_addresses_key_check
    check (length(btrim(address_key)) between 1 and 256),
  constraint cpo_cez_staged_addresses_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint cpo_cez_staged_addresses_coordinates_check
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    ),
  constraint cpo_cez_staged_addresses_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_cez_staged_addresses_outage_key_unique
    unique (outage_external_id, address_key)
);

create index if not exists cpo_cez_staged_addresses_outage_idx
  on public.complete_power_outage_cez_staged_addresses (outage_external_id);

create index if not exists cpo_cez_staged_addresses_match_idx
  on public.complete_power_outage_cez_staged_addresses (
    normalized_municipality,
    normalized_street,
    house_number,
    orientation_number
  );

drop trigger if exists cpo_cez_staged_outages_set_updated_at
  on public.complete_power_outage_cez_staged_outages;
create trigger cpo_cez_staged_outages_set_updated_at
before update on public.complete_power_outage_cez_staged_outages
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_cez_staged_addresses_set_updated_at
  on public.complete_power_outage_cez_staged_addresses;
create trigger cpo_cez_staged_addresses_set_updated_at
before update on public.complete_power_outage_cez_staged_addresses
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_staged_outages enable row level security;
alter table public.complete_power_outage_cez_staged_addresses enable row level security;

drop policy if exists cpo_cez_staged_outages_authorized_read
  on public.complete_power_outage_cez_staged_outages;
create policy cpo_cez_staged_outages_authorized_read
  on public.complete_power_outage_cez_staged_outages
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_staged_addresses_authorized_read
  on public.complete_power_outage_cez_staged_addresses;
create policy cpo_cez_staged_addresses_authorized_read
  on public.complete_power_outage_cez_staged_addresses
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_staged_outages
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_staged_addresses
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_staged_outages to authenticated;
grant select on table public.complete_power_outage_cez_staged_addresses to authenticated;
grant all on table public.complete_power_outage_cez_staged_outages to service_role;
grant all on table public.complete_power_outage_cez_staged_addresses to service_role;

create or replace function public.claim_complete_power_outage_cez_scan_batch(
  requested_limit integer default 3,
  requested_pilot boolean default true
)
returns table (
  cycle_id uuid,
  municipality_code text,
  municipality_name text,
  cez_address_id bigint,
  cez_town_code bigint,
  scan_attempt_count integer,
  scan_lock_token uuid,
  attempt_number integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(20, greatest(1, coalesce(requested_limit, 3)));
  active_cycle public.complete_power_outage_cez_scan_cycles%rowtype;
  batch_token uuid := gen_random_uuid();
  available_count integer;
  cycle_claimed_count integer;
begin
  update public.complete_power_outage_cez_municipalities municipality
  set scan_status = 'error',
      scan_next_attempt_at = now(),
      scan_error_code = 'CEZ_SCAN_LOCK_EXPIRED',
      scan_error_message = 'Předchozí sken obce nebyl dokončen v bezpečnostním limitu.',
      scan_lock_token = null,
      scan_lock_expires_at = null
  where municipality.scan_status = 'processing'
    and municipality.scan_lock_expires_at <= now();

  update public.complete_power_outage_cez_scan_attempts attempt
  set status = 'failed',
      finished_at = now(),
      error_code = 'CEZ_SCAN_LOCK_EXPIRED',
      error_message = 'Předchozí sken obce nebyl dokončen v bezpečnostním limitu.'
  where attempt.status = 'running'
    and attempt.started_at <= now() - interval '12 minutes';

  update public.complete_power_outage_cez_scan_cycles cycle
  set status = 'failed',
      finished_at = now(),
      error_code = 'CEZ_SCAN_CYCLE_STALE',
      error_message = 'Skenovací cyklus nebyl dokončen v bezpečnostním limitu.'
  where cycle.status = 'running'
    and cycle.started_at <= now() - interval '2 hours';

  select * into active_cycle
  from public.complete_power_outage_cez_scan_cycles cycle
  where cycle.status = 'running'
  order by cycle.started_at desc
  limit 1
  for update;

  if found and active_cycle.is_pilot <> coalesce(requested_pilot, true) then
    raise exception 'Již běží jiný typ celoplošného ČEZ cyklu.';
  end if;

  if not found then
    select count(*)::integer into available_count
    from public.complete_power_outage_cez_municipalities municipality
    where municipality.is_active
      and municipality.distribution_status = 'cez'
      and municipality.mapping_status = 'resolved'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null
      and municipality.scan_status in ('pending', 'succeeded', 'no_change', 'partial', 'error')
      and (municipality.scan_next_attempt_at is null or municipality.scan_next_attempt_at <= now());

    if available_count = 0 then
      return;
    end if;

    insert into public.complete_power_outage_cez_scan_cycles (
      trigger_kind,
      status,
      is_pilot,
      municipality_total_count,
      metadata
    ) values (
      case when coalesce(requested_pilot, true) then 'pilot' else 'manual' end,
      'running',
      coalesce(requested_pilot, true),
      case when coalesce(requested_pilot, true)
        then least(safe_limit, available_count)
        else available_count
      end,
      jsonb_build_object('contract', 'complete-cez-municipality-scan-v1')
    ) returning * into active_cycle;
  end if;

  select count(*)::integer into cycle_claimed_count
  from public.complete_power_outage_cez_scan_attempts attempt
  where attempt.cycle_id = active_cycle.id;

  if cycle_claimed_count >= active_cycle.municipality_total_count then
    return;
  end if;

  return query
  with candidates as (
    select municipality.municipality_code
    from public.complete_power_outage_cez_municipalities municipality
    where municipality.is_active
      and municipality.distribution_status = 'cez'
      and municipality.mapping_status = 'resolved'
      and municipality.cez_address_id is not null
      and municipality.cez_town_code is not null
      and municipality.scan_status in ('pending', 'succeeded', 'no_change', 'partial', 'error')
      and (municipality.scan_next_attempt_at is null or municipality.scan_next_attempt_at <= now())
    order by
      case municipality.scan_status when 'pending' then 0 when 'error' then 1 else 2 end,
      municipality.scan_priority,
      municipality.scan_last_success_at nulls first,
      municipality.municipality_code
    for update skip locked
    limit least(
      safe_limit,
      greatest(0, active_cycle.municipality_total_count - cycle_claimed_count)
    )
  ), claimed as (
    update public.complete_power_outage_cez_municipalities municipality
    set scan_status = 'processing',
        scan_attempt_count = municipality.scan_attempt_count + 1,
        scan_last_attempt_at = now(),
        scan_lock_token = batch_token,
        scan_lock_expires_at = now() + interval '12 minutes',
        scan_error_code = null,
        scan_error_message = null
    from candidates
    where municipality.municipality_code = candidates.municipality_code
    returning municipality.*
  ), attempts as (
    insert into public.complete_power_outage_cez_scan_attempts (
      cycle_id,
      municipality_code,
      attempt_number,
      status,
      cez_address_id,
      cez_town_code
    )
    select
      active_cycle.id,
      claimed.municipality_code,
      claimed.scan_attempt_count,
      'running',
      claimed.cez_address_id,
      claimed.cez_town_code
    from claimed
    returning
      complete_power_outage_cez_scan_attempts.municipality_code,
      complete_power_outage_cez_scan_attempts.attempt_number
  )
  select
    active_cycle.id,
    claimed.municipality_code,
    claimed.municipality_name,
    claimed.cez_address_id,
    claimed.cez_town_code,
    claimed.scan_attempt_count,
    claimed.scan_lock_token,
    attempts.attempt_number
  from claimed
  join attempts
    on attempts.municipality_code = claimed.municipality_code
   and attempts.attempt_number = claimed.scan_attempt_count
  order by claimed.municipality_code;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_scan_batch(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_scan_batch(integer, boolean)
  to service_role;

create or replace function public.finish_complete_power_outage_cez_scan_cycle(
  requested_cycle_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  cycle_row public.complete_power_outage_cez_scan_cycles%rowtype;
  processed_count integer;
  success_count integer;
  error_count integer;
  skipped_count integer;
  staged_outage_count integer;
  staged_address_count integer;
  v_changed_outage_count integer;
  v_changed_address_count integer;
  final_status text;
begin
  select * into cycle_row
  from public.complete_power_outage_cez_scan_cycles cycle
  where cycle.id = requested_cycle_id
  for update;

  if not found then
    raise exception 'ČEZ skenovací cyklus neexistuje.';
  end if;
  if cycle_row.status <> 'running' then
    return cycle_row.status;
  end if;

  select
    count(*) filter (where attempt.status <> 'running')::integer,
    count(*) filter (where attempt.status in ('succeeded', 'no_change'))::integer,
    count(*) filter (where attempt.status = 'failed')::integer,
    count(*) filter (where attempt.status = 'skipped')::integer,
    coalesce(sum(
      case when attempt.metadata->>'changedOutageCount' ~ '^[0-9]+$'
        then (attempt.metadata->>'changedOutageCount')::integer else 0 end
    ), 0)::integer,
    coalesce(sum(
      case when attempt.metadata->>'changedAddressCount' ~ '^[0-9]+$'
        then (attempt.metadata->>'changedAddressCount')::integer else 0 end
    ), 0)::integer
  into processed_count, success_count, error_count, skipped_count,
    v_changed_outage_count, v_changed_address_count
  from public.complete_power_outage_cez_scan_attempts attempt
  where attempt.cycle_id = requested_cycle_id;

  select count(*)::integer into staged_outage_count
  from public.complete_power_outage_cez_staged_outages outage
  where outage.last_seen_cycle_id = requested_cycle_id;

  select count(*)::integer into staged_address_count
  from public.complete_power_outage_cez_staged_addresses address
  where exists (
    select 1
    from public.complete_power_outage_cez_staged_outages outage
    where outage.external_id = address.outage_external_id
      and outage.last_seen_cycle_id = requested_cycle_id
  );

  update public.complete_power_outage_cez_scan_cycles
  set municipality_processed_count = processed_count,
      municipality_success_count = success_count,
      municipality_error_count = error_count,
      municipality_skipped_count = skipped_count,
      outage_count = staged_outage_count,
      address_count = staged_address_count,
      changed_outage_count = v_changed_outage_count,
      changed_address_count = v_changed_address_count
  where id = requested_cycle_id;

  if processed_count < cycle_row.municipality_total_count then
    return 'running';
  end if;

  final_status := case
    when error_count = 0 and v_changed_outage_count = 0 and v_changed_address_count = 0 then 'no_change'
    when error_count = 0 then 'succeeded'
    when success_count > 0 then 'partial'
    else 'failed'
  end;

  update public.complete_power_outage_cez_scan_cycles
  set status = final_status,
      finished_at = now(),
      error_code = case when error_count > 0 then 'CEZ_SCAN_MUNICIPALITY_ERRORS' else null end,
      error_message = case
        when error_count > 0 then error_count::text || ' obcí nebylo úspěšně zkontrolováno.'
        else null
      end
  where id = requested_cycle_id;

  return final_status;
end;
$$;

revoke all on function public.finish_complete_power_outage_cez_scan_cycle(uuid)
  from public, anon, authenticated;
grant execute on function public.finish_complete_power_outage_cez_scan_cycle(uuid)
  to service_role;

create or replace function public.request_complete_power_outage_cez_scan(
  requested_limit integer default 3,
  requested_pilot boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(20, greatest(1, coalesce(requested_limit, 3)));
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
      || '/api/power-outages/complete/cez/scan?limit='
      || safe_limit::text
      || '&pilot='
      || case when coalesce(requested_pilot, true) then 'true' else 'false' end,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-CEZ-Municipality-Scan/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_cez_scan(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_cez_scan(integer, boolean)
  to service_role;

commit;
