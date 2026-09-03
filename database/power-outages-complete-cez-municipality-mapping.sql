begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_municipalities') is null then
    raise exception 'Nejdříve spusťte základní migraci celoplošného ČEZ katalogu.';
  end if;
end
$$;

create or replace function public.claim_complete_power_outage_cez_mapping_batch(
  requested_limit integer default 5
)
returns table (
  municipality_code text,
  municipality_name text,
  representative_address_code text,
  representative_street text,
  representative_house_number text,
  representative_orientation_number text,
  representative_postal_code text,
  mapping_attempt_count integer,
  mapping_lock_token uuid,
  metadata jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(25, greatest(1, coalesce(requested_limit, 5)));
  batch_token uuid := gen_random_uuid();
begin
  -- Pád jedné serverové funkce nesmí ponechat obec navždy zamčenou.
  update public.complete_power_outage_cez_municipalities municipality
  set mapping_status = 'error',
      mapping_next_attempt_at = now(),
      mapping_error_code = 'CEZ_MAPPING_LOCK_EXPIRED',
      mapping_error_message = 'Předchozí mapování nedokončilo obec v bezpečnostním limitu.',
      mapping_lock_token = null,
      mapping_lock_expires_at = null
  where municipality.mapping_status = 'processing'
    and municipality.mapping_lock_expires_at <= now();

  return query
  with candidates as (
    select municipality.municipality_code
    from public.complete_power_outage_cez_municipalities municipality
    where municipality.is_active
      and municipality.representative_status = 'resolved'
      and municipality.representative_address_code is not null
      and municipality.representative_house_number is not null
      and municipality.mapping_status in ('pending', 'error')
      and (
        municipality.mapping_next_attempt_at is null
        or municipality.mapping_next_attempt_at <= now()
      )
    order by
      municipality.mapping_attempt_count,
      municipality.mapping_next_attempt_at nulls first,
      municipality.municipality_code
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_cez_municipalities municipality
    set mapping_status = 'processing',
        mapping_attempt_count = municipality.mapping_attempt_count + 1,
        mapping_last_attempt_at = now(),
        mapping_lock_token = batch_token,
        mapping_lock_expires_at = now() + interval '10 minutes',
        mapping_error_code = null,
        mapping_error_message = null
    from candidates
    where municipality.municipality_code = candidates.municipality_code
    returning municipality.*
  )
  select
    claimed.municipality_code,
    claimed.municipality_name,
    claimed.representative_address_code,
    claimed.representative_street,
    claimed.representative_house_number,
    claimed.representative_orientation_number,
    claimed.representative_postal_code,
    claimed.mapping_attempt_count,
    claimed.mapping_lock_token,
    claimed.metadata
  from claimed
  order by claimed.municipality_code;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_mapping_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_mapping_batch(integer)
  to service_role;

create or replace function public.request_complete_power_outage_cez_mapping(
  requested_limit integer default 5
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(25, greatest(1, coalesce(requested_limit, 5)));
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
      || '/api/power-outages/complete/cez/map?limit='
      || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-CEZ-Municipality-Mapping/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_cez_mapping(integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_cez_mapping(integer)
  to service_role;

commit;
