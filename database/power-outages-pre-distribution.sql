begin;

-- PRE je třetí izolovaný zdroj. Stávající data a mechanismy ČEZ/EG.D se nemění.
alter table public.power_outage_source_state
  drop constraint if exists power_outage_source_state_source_check;
alter table public.power_outage_source_state
  add constraint power_outage_source_state_source_check
  check (source in ('cez', 'egd', 'pre'));

alter table public.power_outage_sync_runs
  drop constraint if exists power_outage_sync_runs_source_check;
alter table public.power_outage_sync_runs
  add constraint power_outage_sync_runs_source_check
  check (source in ('cez', 'egd', 'pre'));

alter table public.power_outages
  drop constraint if exists power_outages_source_check;
alter table public.power_outages
  add constraint power_outages_source_check
  check (source in ('cez', 'egd', 'pre'));

alter table public.power_outage_source_payloads
  drop constraint if exists power_outage_source_payloads_source_check;
alter table public.power_outage_source_payloads
  add constraint power_outage_source_payloads_source_check
  check (source in ('cez', 'egd', 'pre'));

alter table public.power_outage_store_registry
  drop constraint if exists power_outage_store_registry_distributor_check;
alter table public.power_outage_store_registry
  add constraint power_outage_store_registry_distributor_check
  check (distributor in ('cez', 'egd', 'pre', 'unknown'));

insert into public.power_outage_source_state (source)
values ('pre')
on conflict (source) do nothing;

-- Již ověřené pražské adresy bezpečně zařadíme do oficiálního území PRE.
-- Roztoky přeřazujeme pouze tehdy, pokud resolver výslovně uvedl PRE,
-- protože obcí stejného názvu existuje více.
update public.power_outage_store_registry
set distributor = 'pre',
    updated_at = now()
where is_active
  and distributor = 'unknown'
  and (
    lower(public.unaccent(trim(store_city))) ~ '^praha([[:space:]]+[0-9]+)?$'
    or replace(lower(public.unaccent(coalesce(metadata ->> 'selectedDso', ''))), ' ', '') like '%predistribuce%'
  );

alter table public.power_outage_task_state
  drop constraint if exists power_outage_task_state_key_check;
alter table public.power_outage_task_state
  add constraint power_outage_task_state_key_check check (
    task_key in (
      'sync_cez', 'sync_egd', 'sync_pre', 'store_queue', 'watchdog',
      'archive', 'store_audit', 'notification_plan'
    )
  );

insert into public.power_outage_task_state (task_key)
values ('sync_pre')
on conflict (task_key) do nothing;

create or replace function public.claim_power_outage_task(
  requested_task_key text,
  requested_lease_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_token uuid := gen_random_uuid();
  claimed_token uuid;
  safe_lease_seconds integer := least(7200, greatest(60, requested_lease_seconds));
begin
  if requested_task_key not in (
    'sync_cez', 'sync_egd', 'sync_pre', 'store_queue', 'watchdog',
    'archive', 'store_audit', 'notification_plan'
  ) then
    raise exception 'Neznámý plánovaný úkol odstávek: %', requested_task_key;
  end if;

  insert into public.power_outage_task_state (
    task_key, lock_token, lock_expires_at, last_started_at, last_status,
    last_error_code, last_error_message
  ) values (
    requested_task_key, next_token,
    now() + make_interval(secs => safe_lease_seconds), now(), 'running', null, null
  )
  on conflict (task_key) do update
    set lock_token = excluded.lock_token,
        lock_expires_at = excluded.lock_expires_at,
        last_started_at = excluded.last_started_at,
        last_status = 'running',
        last_error_code = null,
        last_error_message = null
    where public.power_outage_task_state.lock_token is null
       or public.power_outage_task_state.lock_expires_at <= now()
  returning lock_token into claimed_token;

  return claimed_token;
end;
$$;

revoke all on function public.claim_power_outage_task(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_power_outage_task(text, integer)
  to service_role;

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
    '/api/power-outages/notifications/plan'
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
      'User-Agent', 'B-Energy-Supabase-Power-Outages-Cron/3.0'
    ),
    timeout_milliseconds := request_timeout
  ) into request_id;

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
    select jobid from cron.job
    where jobname = 'power_outages_pre_every_three_hours'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_pre_every_three_hours',
    '26 */3 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/sync?source=pre');$job$
  );
end
$$;

commit;

select 'CRON' as check_type,
  'power_outages_pre_every_three_hours' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_pre_every_three_hours'
      and schedule = '26 */3 * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'request_power_outages_endpoint includes PRE',
  pg_get_functiondef('public.request_power_outages_endpoint(text)'::regprocedure)
    like '%/api/power-outages/sync?source=pre%'
union all
select 'FUNCTION', 'claim_power_outage_task includes PRE',
  pg_get_functiondef('public.claim_power_outage_task(text,integer)'::regprocedure)
    like '%sync_pre%'
union all
select 'STATE', 'power_outage_source_state.pre',
  exists (select 1 from public.power_outage_source_state where source = 'pre')
union all
select 'STATE', 'power_outage_task_state.sync_pre',
  exists (select 1 from public.power_outage_task_state where task_key = 'sync_pre')
union all
select 'CONSTRAINT', 'PRE accepted by outage sources',
  exists (
    select 1 from pg_constraint
    where conname = 'power_outages_source_check'
      and pg_get_constraintdef(oid) like '%pre%'
  )
order by check_type, object_name;
