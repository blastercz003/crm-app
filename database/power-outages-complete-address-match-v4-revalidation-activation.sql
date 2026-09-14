begin;

-- Oprava adresniho matcheru KOMPLETNI, etapa 5.
-- Tento skript po bezpecnostni kontrole SKUTECNE spusti externi SHADOW
-- revalidaci EG.D. Nemeni produkcni vazby firem a nezapina e-mailovy provoz.
do $$
begin
  if to_regprocedure(
    'public.claim_complete_power_outage_address_revalidation_v4_v1(integer)'
  ) is null
     or to_regprocedure(
       'public.finish_complete_power_outage_address_revalidation_v4_v1(uuid,uuid,text,text,jsonb,text,timestamp with time zone)'
     ) is null then
    raise exception 'Chybi worker externi adresni revalidace z etapy 4.';
  end if;
  if to_regclass('public.complete_power_outage_address_revalidation_v4_queue') is null then
    raise exception 'Chybi pripravena fronta externi adresni revalidace.';
  end if;
end
$$;

-- Povolime dva konzistentni stavy: zcela vypnuto, nebo vsechny ctyri brany
-- zapnute soucasne. runtime_mode zustava po celou dobu SHADOW.
alter table public.complete_power_outage_address_match_state
  drop constraint if exists cpo_address_match_state_shadow_check;
alter table public.complete_power_outage_address_match_state
  add constraint cpo_address_match_state_shadow_check check (
    runtime_mode = 'shadow'
    and (
      (
        not revalidation_enabled
        and not external_validation_enabled
        and not coalesce((metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
        and not coalesce((metadata ->> 'externalRequestsAllowed')::boolean, false)
      )
      or (
        revalidation_enabled
        and external_validation_enabled
        and coalesce((metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
        and coalesce((metadata ->> 'externalRequestsAllowed')::boolean, false)
      )
    )
  );

create or replace function public.pause_complete_power_outage_address_revalidation_v4_v1(
  requested_reason text default 'manual_pause'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_reason text := left(coalesce(nullif(btrim(requested_reason), ''), 'manual_pause'), 200);
begin
  update public.complete_power_outage_address_match_state state_row
  set revalidation_enabled = false,
      external_validation_enabled = false,
      metadata = state_row.metadata || jsonb_build_object(
        'externalQueueExecutionEnabled', false,
        'externalRequestsAllowed', false,
        'externalWorkerPausedAt', now(),
        'externalWorkerPauseReason', safe_reason
      ),
      updated_at = now()
  where state_row.singleton;

  return jsonb_build_object(
    'status', 'paused',
    'reason', safe_reason,
    'pausedAt', now()
  );
end;
$$;

create or replace function public.activate_complete_power_outage_address_revalidation_v4_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepared_count bigint;
  active_count bigint;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_revalidation_v4_activation')
  );

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.runtime_mode = 'shadow'
      and coalesce((state_row.metadata ->> 'localShadowProjectionReady')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalQueueReady')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalWorkerInstalled')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalQueueRemainingCount')::bigint, -1) = 0
  ) then
    raise exception 'Bezpecnostni preflight externi adresni revalidace nebyl splnen.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_revalidation_v4_queue queue_row
    where queue_row.queue_status in ('prepared', 'pending', 'processing')
  ) then
    raise exception 'Fronta neobsahuje zadnou polozku urcenou ke zpracovani.';
  end if;

  update public.complete_power_outage_address_revalidation_v4_queue queue_row
  set queue_status = 'pending',
      next_attempt_at = now(),
      lease_token = null,
      lease_expires_at = null,
      metadata = queue_row.metadata || jsonb_build_object('releasedAt', now()),
      updated_at = now()
  where queue_row.queue_status = 'prepared';

  get diagnostics prepared_count = row_count;

  update public.complete_power_outage_address_match_state state_row
  set revalidation_enabled = true,
      external_validation_enabled = true,
      metadata = state_row.metadata || jsonb_build_object(
        'stage', 5,
        'externalQueueExecutionEnabled', true,
        'externalRequestsAllowed', true,
        'externalWorkerActivatedAt', now(),
        'externalWorkerPauseReason', null,
        'productionMatchesMutationAllowed', false,
        'emailPlanningChanged', false,
        'emailDispatchChanged', false
      ),
      updated_at = now()
  where state_row.singleton;

  select count(*) into active_count
  from public.complete_power_outage_address_revalidation_v4_queue queue_row
  where queue_row.queue_status in ('pending', 'processing');

  return jsonb_build_object(
    'status', 'active',
    'releasedPreparedCount', prepared_count,
    'activeQueueCount', active_count,
    'runtimeMode', 'shadow',
    'productionMatchesMutationAllowed', false,
    'activatedAt', now()
  );
end;
$$;

create or replace function public.request_complete_power_outage_address_revalidation_v4_v1()
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
  -- Pri vypnuti se necte Vault a nevznika zadny HTTP pozadavek.
  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.runtime_mode = 'shadow'
      and state_row.revalidation_enabled
      and state_row.external_validation_enabled
      and coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
  ) then
    return null;
  end if;

  -- Jakmile jsou vsechny polozky terminalni, worker se sam bezpecne vypne.
  if not exists (
    select 1
    from public.complete_power_outage_address_revalidation_v4_queue queue_row
    where queue_row.queue_status in ('pending', 'processing')
  ) then
    update public.complete_power_outage_address_match_state state_row
    set revalidation_enabled = false,
        external_validation_enabled = false,
        metadata = state_row.metadata || jsonb_build_object(
          'externalQueueExecutionEnabled', false,
          'externalRequestsAllowed', false,
          'externalWorkerCompletedAt', now(),
          'externalWorkerPauseReason', 'queue_complete'
        ),
        updated_at = now()
    where state_row.singleton;
    return null;
  end if;

  -- Cekajici retry v budoucnosti ani platny lease nesmi vytvaret prazdne HTTP.
  if not exists (
    select 1
    from public.complete_power_outage_address_revalidation_v4_queue queue_row
    where (
        queue_row.queue_status = 'pending'
        and (queue_row.next_attempt_at is null or queue_row.next_attempt_at <= now())
      )
      or (
        queue_row.queue_status = 'processing'
        and queue_row.lease_expires_at <= now()
      )
  ) then
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
    perform public.pause_complete_power_outage_address_revalidation_v4_v1(
      'invalid_weather_alerts_app_url'
    );
    raise warning 'Externi revalidace byla pozastavena: neplatna URL aplikace.';
    return null;
  end if;
  if automation_token is null or length(automation_token) < 32 then
    perform public.pause_complete_power_outage_address_revalidation_v4_v1(
      'missing_weather_alerts_automation_token'
    );
    raise warning 'Externi revalidace byla pozastavena: chybi automatizacni token.';
    return null;
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/addresses/revalidate-v4?limit=3',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Address-Revalidation-V4/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.activate_complete_power_outage_address_revalidation_v4_v1()
  from public, anon, authenticated;
revoke all on function public.pause_complete_power_outage_address_revalidation_v4_v1(text)
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_address_revalidation_v4_v1()
  from public, anon, authenticated;
grant execute on function public.activate_complete_power_outage_address_revalidation_v4_v1()
  to service_role;
grant execute on function public.pause_complete_power_outage_address_revalidation_v4_v1(text)
  to service_role;
grant execute on function public.request_complete_power_outage_address_revalidation_v4_v1()
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete_address_revalidation_v4_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_address_revalidation_v4_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_address_revalidation_v4_v1();$job$
  );
end
$$;

select public.activate_complete_power_outage_address_revalidation_v4_v1()
  as address_revalidation_activation;

commit;

select
  state_row.runtime_mode,
  state_row.revalidation_enabled,
  state_row.external_validation_enabled,
  coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
    as queue_execution_enabled,
  coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
    as external_requests_allowed,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status in (
    'verified', 'conflict', 'needs_review', 'exhausted'
  ))::bigint as terminal_count
from public.complete_power_outage_address_match_state state_row
cross join public.complete_power_outage_address_revalidation_v4_queue queue_row
where state_row.singleton
group by state_row.runtime_mode, state_row.revalidation_enabled,
  state_row.external_validation_enabled, state_row.metadata;
