begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.power_outage_client_email_state
  add column if not exists last_plan_cron_at timestamptz,
  add column if not exists last_plan_cron_request_id bigint,
  add column if not exists last_plan_cron_status_code integer,
  add column if not exists last_plan_cron_error text,
  add column if not exists last_dispatch_cron_at timestamptz,
  add column if not exists last_dispatch_cron_request_id bigint,
  add column if not exists last_dispatch_cron_status_code integer,
  add column if not exists last_dispatch_cron_error text;

-- Klientské e-maily mají vlastní úzce omezený most. Nemohou tak znovu přestat
-- fungovat při budoucí změně allowlistu společného outage endpointu.
create or replace function public.request_power_outage_client_email_endpoint(
  endpoint_path text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
  previous_request_id bigint;
  previous_status_code integer;
  previous_timed_out boolean;
  previous_error text;
  is_plan boolean;
begin
  if endpoint_path not in (
    '/api/power-outages/client-emails/plan',
    '/api/power-outages/client-emails/send'
  ) then
    raise exception 'Nepovolený endpoint klientských e-mailů: %', endpoint_path;
  end if;

  is_plan := endpoint_path = '/api/power-outages/client-emails/plan';

  select case
    when is_plan then state.last_plan_cron_request_id
    else state.last_dispatch_cron_request_id
  end
  into previous_request_id
  from public.power_outage_client_email_state as state
  where state.singleton;

  if previous_request_id is not null then
    select response.status_code, response.timed_out, response.error_msg
    into previous_status_code, previous_timed_out, previous_error
    from net._http_response as response
    where response.id = previous_request_id;

    if found then
      if is_plan then
        update public.power_outage_client_email_state
        set last_plan_cron_status_code = previous_status_code,
            last_plan_cron_error = case
              when coalesce(previous_timed_out, false) then 'Předchozí požadavek plánovače vypršel.'
              when previous_error is not null then previous_error
              when previous_status_code not between 200 and 299 then 'Plánovač odpověděl HTTP ' || previous_status_code::text || '.'
              else null
            end,
            updated_at = now()
        where singleton;
      else
        update public.power_outage_client_email_state
        set last_dispatch_cron_status_code = previous_status_code,
            last_dispatch_cron_error = case
              when coalesce(previous_timed_out, false) then 'Předchozí požadavek workeru vypršel.'
              when previous_error is not null then previous_error
              when previous_status_code not between 200 and 299 then 'Worker odpověděl HTTP ' || previous_status_code::text || '.'
              else null
            end,
            updated_at = now()
        where singleton;
      end if;
    end if;
  end if;

  select trim(trailing '/' from secret.decrypted_secret)
  into app_url
  from vault.decrypted_secrets as secret
  where secret.name = 'weather_alerts_app_url'
  order by secret.created_at desc
  limit 1;

  select secret.decrypted_secret
  into automation_token
  from vault.decrypted_secrets as secret
  where secret.name = 'weather_alerts_automation_token'
  order by secret.created_at desc
  limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || endpoint_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-MARKETY-Client-Email-Cron/1.0'
    ),
    timeout_milliseconds := 120000
  )
  into request_id;

  if is_plan then
    update public.power_outage_client_email_state
    set last_plan_cron_at = now(),
        last_plan_cron_request_id = request_id,
        updated_at = now()
    where singleton;
  else
    update public.power_outage_client_email_state
    set last_dispatch_cron_at = now(),
        last_dispatch_cron_request_id = request_id,
        updated_at = now()
    where singleton;
  end if;

  return request_id;
exception when others then
  if is_plan then
    update public.power_outage_client_email_state
    set last_plan_cron_at = now(),
        last_plan_cron_error = sqlerrm,
        updated_at = now()
    where singleton;
  else
    update public.power_outage_client_email_state
    set last_dispatch_cron_at = now(),
        last_dispatch_cron_error = sqlerrm,
        updated_at = now()
    where singleton;
  end if;
  return null;
end;
$$;

revoke all on function public.request_power_outage_client_email_endpoint(text)
  from public, anon, authenticated;
grant execute on function public.request_power_outage_client_email_endpoint(text)
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'power_outage_client_email_shadow_plan_every_five_minutes',
      'power_outage_client_email_dispatch_every_three_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outage_client_email_shadow_plan_every_five_minutes',
    '4-59/5 * * * *',
    $job$select public.request_power_outage_client_email_endpoint('/api/power-outages/client-emails/plan');$job$
  );

  perform cron.schedule(
    'power_outage_client_email_dispatch_every_three_minutes',
    '1-59/3 * * * *',
    $job$select public.request_power_outage_client_email_endpoint('/api/power-outages/client-emails/send');$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;

select 'FUNCTION' as check_type, 'dedicated client email cron bridge' as object_name,
  to_regprocedure('public.request_power_outage_client_email_endpoint(text)') is not null as is_correct
union all
select 'CRON', 'client email planner every five minutes', exists (
  select 1 from cron.job
  where jobname = 'power_outage_client_email_shadow_plan_every_five_minutes'
    and schedule = '4-59/5 * * * *' and active
    and command like '%request_power_outage_client_email_endpoint%/client-emails/plan%'
)
union all
select 'CRON', 'client email worker every three minutes', exists (
  select 1 from cron.job
  where jobname = 'power_outage_client_email_dispatch_every_three_minutes'
    and schedule = '1-59/3 * * * *' and active
    and command like '%request_power_outage_client_email_endpoint%/client-emails/send%'
)
union all
select 'GRANT', 'authenticated cannot call client email cron bridge',
  not has_function_privilege('authenticated', 'public.request_power_outage_client_email_endpoint(text)', 'execute')
union all
select 'SAFETY', 'client email cron bridge has two endpoint allowlist',
  pg_get_functiondef('public.request_power_outage_client_email_endpoint(text)'::regprocedure)
    like '%/api/power-outages/client-emails/plan%'
  and pg_get_functiondef('public.request_power_outage_client_email_endpoint(text)'::regprocedure)
    like '%/api/power-outages/client-emails/send%'
  and pg_get_functiondef('public.request_power_outage_client_email_endpoint(text)'::regprocedure)
    not ilike '%complete_power_outage%'
union all
select 'SAFETY', 'email dispatch remains live', exists (
  select 1 from public.power_outage_client_email_state
  where singleton and runtime_mode = 'live' and dispatch_enabled
)
order by check_type, object_name;
