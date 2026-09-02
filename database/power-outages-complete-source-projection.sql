begin;

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
    '/api/power-outages/sync?source=pre',
    '/api/power-outages/stores/process?limit=10',
    '/api/power-outages/watchdog',
    '/api/power-outages/archive',
    '/api/power-outages/stores/audit',
    '/api/power-outages/notifications/plan',
    '/api/power-outages/complete/sync?source=all',
    '/api/power-outages/complete/sync?source=cez',
    '/api/power-outages/complete/sync?source=egd',
    '/api/power-outages/complete/sync?source=pre'
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
    when endpoint_path like '/api/power-outages/sync?source=%'
      or endpoint_path like '/api/power-outages/complete/sync?source=%'
      then 300000
    else 120000
  end;

  select net.http_get(
    url := app_url || endpoint_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Supabase-Power-Outages-Cron/4.0'
    ),
    timeout_milliseconds := request_timeout
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_power_outages_endpoint(text)
  from public, anon, authenticated;
grant execute on function public.request_power_outages_endpoint(text)
  to service_role;

commit;

select 'FUNCTION' as check_type,
  'request_power_outages_endpoint includes complete projection' as object_name,
  pg_get_functiondef('public.request_power_outages_endpoint(text)'::regprocedure)
    like '%/api/power-outages/complete/sync?source=all%' as is_correct
union all
select 'FUNCTION', 'request_power_outages_endpoint preserves PRE sync',
  pg_get_functiondef('public.request_power_outages_endpoint(text)'::regprocedure)
    like '%/api/power-outages/sync?source=pre%';
