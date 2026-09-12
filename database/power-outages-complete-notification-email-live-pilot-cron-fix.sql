begin;

-- Oprava aktivniho kroku 10.9: vlastni COMPLETE requester misto obecneho
-- whitelistu. Instalace neobchazi databazove limity ani bezpecnostni stav.
create or replace function public.request_cpo_notification_email_live_pilot_v1()
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
  if not coalesce((
    select state_row.runtime_mode = 'live' and state_row.dispatch_enabled
    from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
  ), false) then
    return null;
  end if;

  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets
  where name = 'weather_alerts_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret into automation_token
  from vault.decrypted_secrets
  where name = 'weather_alerts_automation_token'
  order by created_at desc
  limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url neni platny.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybi.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/notification-emails/pilot/send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Notification-Live-Pilot/1.0'
    ),
    timeout_milliseconds := 60000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_cpo_notification_email_live_pilot_v1()
  from public, anon, authenticated;
grant execute on function public.request_cpo_notification_email_live_pilot_v1()
  to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_notification_email_live_pilot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_notification_email_live_pilot_every_minute',
    '* * * * *',
    $job$select public.request_cpo_notification_email_live_pilot_v1();$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (
  values
    ('FUNCTION'::text, 'isolated COMPLETE LIVE HTTP requester exists'::text,
      to_regprocedure('public.request_cpo_notification_email_live_pilot_v1()') is not null),
    ('GRANT', 'authenticated cannot run COMPLETE LIVE HTTP requester',
      not has_function_privilege(
        'authenticated',
        'public.request_cpo_notification_email_live_pilot_v1()',
        'EXECUTE'
      )),
    ('ISOLATION', 'COMPLETE requester uses only COMPLETE pilot endpoint',
      pg_get_functiondef(
        'public.request_cpo_notification_email_live_pilot_v1()'::regprocedure
      ) ilike '%/api/power-outages/complete/notification-emails/pilot/send%'
      and pg_get_functiondef(
        'public.request_cpo_notification_email_live_pilot_v1()'::regprocedure
      ) not ilike '%market%'),
    ('CRON', 'COMPLETE LIVE cron uses isolated requester every minute',
      exists (
        select 1 from cron.job job
        where job.jobname = 'complete_notification_email_live_pilot_every_minute'
          and job.schedule = '* * * * *'
          and job.command like '%request_cpo_notification_email_live_pilot_v1%'
      )),
    ('SAFETY', 'requester performs work only while COMPLETE LIVE is enabled',
      pg_get_functiondef(
        'public.request_cpo_notification_email_live_pilot_v1()'::regprocedure
      ) ilike '%runtime_mode = ''live'' and state_row.dispatch_enabled%')
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
