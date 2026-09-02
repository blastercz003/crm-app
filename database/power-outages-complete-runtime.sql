begin;

create or replace function public.request_complete_power_outage_runtime_pipeline()
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
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace bez cesty.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/pipeline',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Supabase-Complete-Power-Outages/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_runtime_pipeline()
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_runtime_pipeline()
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'power_outages_complete_cez_projection_every_fifteen_minutes',
      'power_outages_complete_egd_projection_every_six_hours',
      'power_outages_complete_pre_projection_every_three_hours',
      'power_outages_complete_pipeline_every_fifteen_minutes',
      'power_outages_complete_pipeline_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  -- Projekce jsou záměrně oddělené od stahování distributora. Nemohou tak
  -- prodloužit jeho serverless běh až za časový limit a nikdy neposílají nový
  -- požadavek na ČEZ, EG.D ani PRE; čtou pouze uložené snapshoty.
  perform cron.schedule(
    'power_outages_complete_cez_projection_every_fifteen_minutes',
    '11-59/15 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/complete/sync?source=cez');$job$
  );

  perform cron.schedule(
    'power_outages_complete_egd_projection_every_six_hours',
    '51 3-23/6 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/complete/sync?source=egd');$job$
  );

  perform cron.schedule(
    'power_outages_complete_pre_projection_every_three_hours',
    '36 */3 * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/complete/sync?source=pre');$job$
  );

  -- Běží mezi stávajícími úlohami zdrojů. Endpoint nevolá distributory;
  -- zpracuje jen uložená data a malé dávky providerů chráněné kvótami/cache.
  perform cron.schedule(
    'power_outages_complete_pipeline_every_five_minutes',
    '4-59/5 * * * *',
    $job$select public.request_complete_power_outage_runtime_pipeline();$job$
  );
end
$$;

do $$
begin
  if to_regprocedure('public.publish_app_data_change(text,uuid[])') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.publish_app_data_change(text, uuid[]).';
  end if;
end
$$;

create or replace function public.publish_complete_power_outages_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or profiles.can_view_power_outages = true;

  perform public.publish_app_data_change('complete_power_outages', recipient_ids);
  return null;
end;
$$;

revoke all on function public.publish_complete_power_outages_app_change()
  from public, anon, authenticated;

drop trigger if exists complete_power_outage_sources_publish_app_change
  on public.complete_power_outage_source_state;
create trigger complete_power_outage_sources_publish_app_change
after insert or update or delete on public.complete_power_outage_source_state
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists complete_power_outage_tasks_publish_app_change
  on public.complete_power_outage_task_state;
create trigger complete_power_outage_tasks_publish_app_change
after insert or update or delete on public.complete_power_outage_task_state
for each statement execute function public.publish_complete_power_outages_app_change();

commit;

select 'CRON' as check_type,
  'complete pipeline every five minutes' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_pipeline_every_five_minutes'
      and schedule = '4-59/5 * * * *'
      and active
  ) as is_correct
union all
select 'CRON', 'complete ČEZ projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes'
      and schedule = '11-59/15 * * * *'
      and active
  )
union all
select 'CRON', 'complete EG.D projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_egd_projection_every_six_hours'
      and schedule = '51 3-23/6 * * *'
      and active
  )
union all
select 'CRON', 'complete PRE projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_pre_projection_every_three_hours'
      and schedule = '36 */3 * * *'
      and active
  )
union all
select 'FUNCTION', 'request complete runtime pipeline',
  to_regprocedure('public.request_complete_power_outage_runtime_pipeline()') is not null
union all
select 'FUNCTION', 'publish complete outage realtime change',
  to_regprocedure('public.publish_complete_power_outages_app_change()') is not null
union all
select 'TRIGGER', 'complete source state realtime',
  exists (
    select 1 from pg_trigger
    where tgname = 'complete_power_outage_sources_publish_app_change'
      and not tgisinternal
  )
union all
select 'TRIGGER', 'complete task state realtime',
  exists (
    select 1 from pg_trigger
    where tgname = 'complete_power_outage_tasks_publish_app_change'
      and not tgisinternal
  )
order by check_type, object_name;
