begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_municipalities') is null then
    raise exception 'Nejdříve spusťte migraci power-outages-complete-cez-municipality-foundation.sql.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_municipalities
  add column if not exists representative_sjtsk_y double precision,
  add column if not exists representative_sjtsk_x double precision,
  add column if not exists representative_status text not null default 'pending',
  add column if not exists representative_attempt_count integer not null default 0,
  add column if not exists representative_last_attempt_at timestamptz,
  add column if not exists representative_next_attempt_at timestamptz,
  add column if not exists representative_error_message text;

alter table public.complete_power_outage_cez_municipalities
  drop constraint if exists cpo_cez_municipalities_sjtsk_check;

alter table public.complete_power_outage_cez_municipalities
  add constraint cpo_cez_municipalities_sjtsk_check
  check (
    (representative_sjtsk_y is null and representative_sjtsk_x is null)
    or (
      representative_sjtsk_y is not null
      and representative_sjtsk_x is not null
      and representative_sjtsk_y > 0
      and representative_sjtsk_x > 0
    )
  );

alter table public.complete_power_outage_cez_municipalities
  drop constraint if exists cpo_cez_municipalities_representative_status_check;

alter table public.complete_power_outage_cez_municipalities
  add constraint cpo_cez_municipalities_representative_status_check
  check (representative_status in ('pending', 'resolved', 'error', 'needs_review'));

alter table public.complete_power_outage_cez_municipalities
  drop constraint if exists cpo_cez_municipalities_representative_attempts_check;

alter table public.complete_power_outage_cez_municipalities
  add constraint cpo_cez_municipalities_representative_attempts_check
  check (representative_attempt_count >= 0);

create index if not exists cpo_cez_municipalities_representative_queue_idx
  on public.complete_power_outage_cez_municipalities (
    representative_status,
    representative_next_attempt_at,
    municipality_code
  )
  where is_active and representative_status in ('pending', 'error');

create or replace function public.request_complete_power_outage_cez_ruian_import(
  requested_phase text default 'all',
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
  safe_phase text := lower(coalesce(requested_phase, 'all'));
  safe_limit integer := least(250, greatest(1, coalesce(requested_limit, 100)));
  request_id bigint;
begin
  if safe_phase not in ('catalog', 'representatives', 'all') then
    raise exception 'Fáze importu musí být catalog, representatives nebo all.';
  end if;

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
      || '/api/power-outages/complete/cez/ruian?phase='
      || safe_phase
      || '&limit='
      || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-CEZ-RUIAN-Import/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_cez_ruian_import(text, integer)
  from public, anon, authenticated;

grant execute on function public.request_complete_power_outage_cez_ruian_import(text, integer)
  to service_role;

commit;
