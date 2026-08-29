begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'weather_alerts_app_url'
      and nullif(trim(decrypted_secret), '') is not null
  ) then
    raise exception 'Chybí Vault secret weather_alerts_app_url.';
  end if;

  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'weather_alerts_automation_token'
      and nullif(trim(decrypted_secret), '') is not null
  ) then
    raise exception 'Chybí Vault secret weather_alerts_automation_token.';
  end if;
end
$$;

create or replace function public.request_weather_alerts_endpoint(endpoint_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
begin
  if endpoint_path not in (
    '/api/weather-alerts/sync',
    '/api/weather-alerts/health'
  ) then
    raise exception 'Nepovolený endpoint výstrah počasí.';
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
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat pouze kořenovou HTTPS adresu aplikace bez cesty.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || endpoint_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Supabase-Weather-Cron/1.0'
    ),
    timeout_milliseconds := 180000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.request_weather_alerts_endpoint(text) is
  'Bezpečně zařadí synchronizaci nebo watchdog výstrah ČHMÚ přes pg_net.';

revoke all on function public.request_weather_alerts_endpoint(text)
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'weather_alerts_sync_every_five_minutes',
    'weather_alerts_watchdog_every_fifteen_minutes'
  );

  perform cron.schedule(
    'weather_alerts_sync_every_five_minutes',
    '2-59/5 * * * *',
    $job$select public.request_weather_alerts_endpoint('/api/weather-alerts/sync');$job$
  );

  perform cron.schedule(
    'weather_alerts_watchdog_every_fifteen_minutes',
    '6-59/15 * * * *',
    $job$select public.request_weather_alerts_endpoint('/api/weather-alerts/health');$job$
  );

  -- Po prvním nasazení nečekáme na nejbližší pětiminutový interval.
  perform public.request_weather_alerts_endpoint('/api/weather-alerts/sync');
end
$$;

commit;
