begin;

alter table public.weather_notification_deliveries
  add column if not exists push_delivery jsonb not null default '{}'::jsonb;

comment on column public.weather_notification_deliveries.push_delivery is
  'Výsledek pokusu o PWA push pro danou výstrahu, včetně počtu registrací, úspěchů a chyb.';

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
    '/api/weather-insights/forecast/sync',
    '/api/weather-insights/notifications/daily'
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
  'Bezpečně zařadí synchronizaci dat počasí nebo denní meteorologický přehled přes pg_net.';

revoke all on function public.request_weather_insights_endpoint(text)
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'weather_insights_daily_summary_every_ten_minutes';

  perform cron.schedule(
    'weather_insights_daily_summary_every_ten_minutes',
    '0-59/10 * * * *',
    $job$select public.request_weather_insights_endpoint('/api/weather-insights/notifications/daily');$job$
  );
end
$$;

commit;

select
  'COLUMN' as check_type,
  'weather_notification_deliveries.push_delivery' as object_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weather_notification_deliveries'
      and column_name = 'push_delivery'
  ) as is_correct
union all
select
  'FUNCTION',
  'request_weather_insights_endpoint allows daily summary',
  pg_get_functiondef('public.request_weather_insights_endpoint(text)'::regprocedure)
    like '%/api/weather-insights/notifications/daily%'
union all
select
  'CRON',
  'weather_insights_daily_summary_every_ten_minutes',
  exists (
    select 1
    from cron.job
    where jobname = 'weather_insights_daily_summary_every_ten_minutes'
      and active
      and schedule = '0-59/10 * * * *'
  )
order by check_type, object_name;
