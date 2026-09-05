begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_v2_audit_runs') is null
    or to_regclass('public.power_outage_cez_market_v2_audit_cases') is null
  then
    raise exception 'Nejdříve spusťte základní migraci auditu ČEZ MARKETY v2.';
  end if;
end
$$;

-- Pokračovací claim nikdy nevytváří nový běh. Pracuje pouze s explicitním ID
-- již založeného auditu a po jeho dokončení vrátí prázdnou dávku.
create or replace function public.claim_power_outage_cez_market_v2_audit_continuation(
  requested_run_id uuid,
  requested_limit integer default 2
)
returns table (
  run_id uuid,
  case_id uuid,
  address_id bigint,
  municipality text,
  street text,
  house_number text,
  orientation_number text,
  store_ids jsonb,
  lock_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_limit integer := least(2, greatest(1, coalesce(requested_limit, 2)));
begin
  if not exists (
    select 1
    from public.power_outage_cez_market_v2_audit_runs audit_run
    where audit_run.id = requested_run_id
      and audit_run.status = 'running'
      and audit_run.collector_version = 'v1'
  ) then
    return;
  end if;

  update public.power_outage_cez_market_v2_audit_cases audit_case
  set status = case when audit_case.attempt_count >= 3 then 'failed' else 'pending' end,
      started_at = case when audit_case.attempt_count >= 3 then audit_case.started_at else null end,
      finished_at = case when audit_case.attempt_count >= 3 then now() else null end,
      lock_token = null,
      lock_expires_at = null,
      error_code = 'CEZ_V2_AUDIT_STALE',
      error_message = 'Auditní zámek vypršel.'
  where audit_case.run_id = requested_run_id
    and audit_case.status = 'running'
    and audit_case.lock_expires_at < now();

  return query
  with selected as (
    select audit_case.id
    from public.power_outage_cez_market_v2_audit_cases audit_case
    where audit_case.run_id = requested_run_id
      and audit_case.status = 'pending'
    order by audit_case.municipality_store_count desc, audit_case.address_id
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.power_outage_cez_market_v2_audit_cases audit_case
    set status = 'running',
        attempt_count = audit_case.attempt_count + 1,
        started_at = now(),
        finished_at = null,
        lock_token = gen_random_uuid(),
        lock_expires_at = now() + interval '10 minutes',
        error_code = null,
        error_message = null
    from selected
    where audit_case.id = selected.id
    returning audit_case.*
  )
  select
    claimed.run_id,
    claimed.id,
    claimed.address_id,
    claimed.municipality,
    claimed.street,
    claimed.house_number,
    claimed.orientation_number,
    claimed.store_ids,
    claimed.lock_token
  from claimed;
end;
$$;

revoke all on function public.claim_power_outage_cez_market_v2_audit_continuation(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_power_outage_cez_market_v2_audit_continuation(uuid, integer)
  to service_role;

-- Každé dvě minuty pokračuje pouze tehdy, když existuje rozběhnutý audit a
-- žádná jeho předchozí dávka právě neběží. Po dokončení neposílá žádný HTTP dotaz.
create or replace function public.request_power_outage_cez_market_v2_audit_continuation()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_run_id uuid;
  app_url text;
  automation_token text;
  request_id bigint;
begin
  select audit_run.id
  into active_run_id
  from public.power_outage_cez_market_v2_audit_runs audit_run
  where audit_run.status = 'running'
    and audit_run.collector_version = 'v1'
    and not exists (
      select 1
      from public.power_outage_cez_market_v2_audit_cases audit_case
      where audit_case.run_id = audit_run.id
        and audit_case.status = 'running'
        and audit_case.lock_expires_at >= now()
    )
  order by audit_run.started_at desc
  limit 1;

  if active_run_id is null then
    return null;
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
    raise exception 'Vault secret weather_alerts_app_url neobsahuje platnou HTTPS adresu aplikace.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url
      || '/api/power-outages/cez/v2-audit?runId='
      || active_run_id::text
      || '&limit=2',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-MARKETY-CEZ-v2-Audit-Continuation/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_power_outage_cez_market_v2_audit_continuation()
  from public, anon, authenticated;
grant execute on function public.request_power_outage_cez_market_v2_audit_continuation()
  to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'power_outage_cez_market_v2_audit_continuation_every_two_minutes'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'power_outage_cez_market_v2_audit_continuation_every_two_minutes',
    '*/2 * * * *',
    'select public.request_power_outage_cez_market_v2_audit_continuation();'
  );
end
$$;

commit;
