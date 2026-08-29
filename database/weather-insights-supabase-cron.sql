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

create or replace function public.request_weather_insights_endpoint(endpoint_path text)
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
    '/api/weather-insights/radar/sync',
    '/api/weather-insights/observations/sync',
    '/api/weather-insights/forecast/sync'
  ) then
    raise exception 'Nepovolený endpoint doplňkových dat počasí.';
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
      'User-Agent', 'B-Energy-Supabase-Weather-Insights-Cron/1.0'
    ),
    timeout_milliseconds := 180000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.request_weather_insights_endpoint(text) is
  'Bezpečně zařadí synchronizaci radaru, měřených extrémů nebo výhledu ČHMÚ přes pg_net.';

revoke all on function public.request_weather_insights_endpoint(text)
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'weather_insights_radar_every_five_minutes',
    'weather_insights_observations_every_ten_minutes',
    'weather_insights_forecast_hourly'
  );

  perform cron.schedule(
    'weather_insights_radar_every_five_minutes',
    '4-59/5 * * * *',
    $job$select public.request_weather_insights_endpoint('/api/weather-insights/radar/sync');$job$
  );

  perform cron.schedule(
    'weather_insights_observations_every_ten_minutes',
    '0-59/10 * * * *',
    $job$select public.request_weather_insights_endpoint('/api/weather-insights/observations/sync');$job$
  );

  perform cron.schedule(
    'weather_insights_forecast_hourly',
    '17 * * * *',
    $job$select public.request_weather_insights_endpoint('/api/weather-insights/forecast/sync');$job$
  );

  -- Po prvním nasazení načteme všechny tři zdroje bez čekání na nejbližší interval.
  perform public.request_weather_insights_endpoint('/api/weather-insights/radar/sync');
  perform public.request_weather_insights_endpoint('/api/weather-insights/observations/sync');
  perform public.request_weather_insights_endpoint('/api/weather-insights/forecast/sync');
end
$$;

commit;

select
  'FUNCTION' as check_type,
  'request_weather_insights_endpoint' as object_name,
  to_regprocedure('public.request_weather_insights_endpoint(text)') is not null as is_correct
union all
select
  'CRON',
  expected.jobname,
  exists (
    select 1
    from cron.job job
    where job.jobname = expected.jobname
      and job.active
      and job.schedule = expected.schedule
  )
from (
  values
    ('weather_insights_radar_every_five_minutes', '4-59/5 * * * *'),
    ('weather_insights_observations_every_ten_minutes', '0-59/10 * * * *'),
    ('weather_insights_forecast_hourly', '17 * * * *')
) as expected(jobname, schedule)
order by check_type, object_name;
