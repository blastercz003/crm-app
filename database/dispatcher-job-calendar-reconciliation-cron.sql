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

create or replace function public.request_dispatcher_job_calendar_reconciliation()
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
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || '/api/dispatcher-job-calendars/reconcile',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Supabase-Job-Calendar-Reconciliation/1.0'
    ),
    timeout_milliseconds := 300000
  )
  into request_id;

  return request_id;
end;
$$;

comment on function public.request_dispatcher_job_calendar_reconciliation() is
  'Spustí bezpečnou kontrolu a opravu aktivních zakázkových kalendářů.';

revoke all on function public.request_dispatcher_job_calendar_reconciliation()
  from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'dispatcher_job_calendars_reconcile_every_thirty_minutes';

  perform cron.schedule(
    'dispatcher_job_calendars_reconcile_every_thirty_minutes',
    '11,41 * * * *',
    $job$select public.request_dispatcher_job_calendar_reconciliation();$job$
  );
end
$$;

commit;

select
  'FUNCTION' as check_type,
  'request_dispatcher_job_calendar_reconciliation' as object_name,
  to_regprocedure('public.request_dispatcher_job_calendar_reconciliation()') is not null as is_correct

union all

select
  'CRON',
  'dispatcher_job_calendars_reconcile_every_thirty_minutes',
  exists (
    select 1
    from cron.job
    where jobname = 'dispatcher_job_calendars_reconcile_every_thirty_minutes'
      and schedule = '11,41 * * * *'
      and active
  );
