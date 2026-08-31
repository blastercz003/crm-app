begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_app_url'
      and nullif(trim(decrypted_secret), '') is not null
  ) then
    raise exception 'Chybí Vault secret weather_alerts_app_url.';
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_automation_token'
      and nullif(trim(decrypted_secret), '') is not null
  ) then
    raise exception 'Chybí Vault secret weather_alerts_automation_token.';
  end if;
end
$$;

create or replace function public.request_power_outages_endpoint(endpoint_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
  request_timeout integer;
begin
  if endpoint_path not in (
    '/api/power-outages/sync?source=cez',
    '/api/power-outages/sync?source=egd',
    '/api/power-outages/stores/process?limit=10',
    '/api/power-outages/watchdog',
    '/api/power-outages/archive',
    '/api/power-outages/stores/audit'
  ) then
    raise exception 'Nepovolený endpoint plánovaných odstávek: %', endpoint_path;
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

  request_timeout := case
    when endpoint_path like '/api/power-outages/sync?source=%' then 300000
    else 120000
  end;

  select net.http_get(
    url := app_url || endpoint_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Supabase-Power-Outages-Cron/2.0'
    ),
    timeout_milliseconds := request_timeout
  )
  into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_power_outages_endpoint(text)
  from public, anon, authenticated;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_sync_daily',
      'power_outages_refresh_every_three_hours',
      'power_outages_cez_every_six_hours',
      'power_outages_egd_every_six_hours',
      'power_outages_store_queue_every_fifteen_minutes',
      'power_outages_watchdog_hourly',
      'power_outages_archive_hourly',
      'power_outages_store_audit_nightly'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_cez_every_six_hours',
    '11 */6 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/sync?source=cez');$job$
  );

  -- EG.D běží uprostřed mezi běhy ČEZ, takže se veřejné zdroje ani aplikace nezatěžují současně.
  perform cron.schedule(
    'power_outages_egd_every_six_hours',
    '41 3-23/6 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/sync?source=egd');$job$
  );

  perform cron.schedule(
    'power_outages_store_queue_every_fifteen_minutes',
    '7-59/15 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/stores/process?limit=10');$job$
  );

  perform cron.schedule(
    'power_outages_watchdog_hourly',
    '17 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/watchdog');$job$
  );

  perform cron.schedule(
    'power_outages_archive_hourly',
    '32 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/archive');$job$
  );

  -- pg_cron používá UTC: 01:53 UTC = 02:53 v zimě / 03:53 v létě v ČR.
  perform cron.schedule(
    'power_outages_store_audit_nightly',
    '53 1 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/stores/audit');$job$
  );
end
$$;

commit;

with expected(jobname, schedule) as (
  values
    ('power_outages_cez_every_six_hours', '11 */6 * * *'),
    ('power_outages_egd_every_six_hours', '41 3-23/6 * * *'),
    ('power_outages_store_queue_every_fifteen_minutes', '7-59/15 * * * *'),
    ('power_outages_watchdog_hourly', '17 * * * *'),
    ('power_outages_archive_hourly', '32 * * * *'),
    ('power_outages_store_audit_nightly', '53 1 * * *')
)
select
  'CRON' as check_type,
  expected.jobname as object_name,
  exists (
    select 1 from cron.job
    where cron.job.jobname = expected.jobname
      and cron.job.schedule = expected.schedule
      and cron.job.active
  ) as is_correct
from expected
union all
select 'FUNCTION', 'request_power_outages_endpoint',
  to_regprocedure('public.request_power_outages_endpoint(text)') is not null
union all
select 'STATE', 'legacy power outage cron jobs removed',
  not exists (
    select 1 from cron.job
    where jobname in (
      'power_outages_sync_daily',
      'power_outages_refresh_every_three_hours'
    )
  )
order by check_type, object_name;
