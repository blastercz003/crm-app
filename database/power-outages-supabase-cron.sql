begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
declare
  daily_job_id bigint;
  refresh_job_id bigint;
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
begin
  if endpoint_path not in (
    '/api/power-outages/sync',
    '/api/power-outages/refresh',
    '/api/power-outages/health'
  ) then
    raise exception 'Nepovolený endpoint plánovaných odstávek.';
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
      'User-Agent', 'B-Energy-Supabase-Power-Outages-Cron/1.0'
    ),
    timeout_milliseconds := 300000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.request_power_outages_endpoint(text) is
  'Bezpečně zařadí plnou nebo podmíněnou synchronizaci plánovaných odstávek přes pg_net.';

revoke all on function public.request_power_outages_endpoint(text)
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in (
    'power_outages_sync_daily',
    'power_outages_refresh_every_three_hours'
  );

  -- pg_cron používá UTC: 03:17 UTC odpovídá 04:17 v zimě a 05:17 v létě.
  daily_job_id := cron.schedule(
    'power_outages_sync_daily',
    '17 3 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/sync');$job$
  );

  -- Lehký endpoint spustí import jen po změně Prodejen, prvním běhu nebo chybě.
  refresh_job_id := cron.schedule(
    'power_outages_refresh_every_three_hours',
    '47 */3 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/refresh');$job$
  );

  -- Aktivaci provedeme až po nasazení a kontrolovaném prvním importu.
  perform cron.alter_job(job_id := daily_job_id, active := false);
  perform cron.alter_job(job_id := refresh_job_id, active := false);
end
$$;

commit;

select 'FUNCTION' as check_type,
  'request_power_outages_endpoint' as object_name,
  to_regprocedure('public.request_power_outages_endpoint(text)') is not null as is_correct
union all
select 'CRON', 'power_outages_sync_daily configured paused',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_sync_daily'
      and not active
      and schedule = '17 3 * * *'
  )
union all
select 'CRON', 'power_outages_refresh_every_three_hours configured paused',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_refresh_every_three_hours'
      and not active
      and schedule = '47 */3 * * *'
  )
union all
select 'VAULT', 'weather_alerts_app_url',
  exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_app_url'
      and nullif(trim(decrypted_secret), '') is not null
  )
union all
select 'VAULT', 'weather_alerts_automation_token',
  exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_automation_token'
      and nullif(trim(decrypted_secret), '') is not null
  )
order by check_type, object_name;
