begin;

do $$
begin
  if to_regprocedure('public.build_complete_power_outage_cez_shadow_projection()') is null
    or to_regprocedure('public.request_power_outages_endpoint(text)') is null
    or to_regclass('public.complete_power_outage_cez_projection_state') is null
  then
    raise exception 'Nejdříve spusťte migraci průběžné stínové projekce ČEZ.';
  end if;
end
$$;

-- Jediný pravidelný krok nejprve aktualizuje stínový katalog. Po budoucím
-- řízeném přepnutí požádá stávající endpoint KOMPLETNÍ o převzetí nových dat;
-- ten vytvoří adresní cíle ve stejné frontě ARES/Mapy/Google jako EG.D a PRE.
create or replace function public.advance_complete_power_outage_cez_projection()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  projection_result jsonb;
  source_mode text;
  complete_cycle_id uuid;
  publish_request_id bigint;
begin
  projection_result := public.build_complete_power_outage_cez_shadow_projection();

  -- Kompatibilní doplnění pro již nasazenou první verzi projekce: záznam,
  -- který bezpečný úplný cyklus označil jako chybějící, nesmí znovu vstoupit
  -- do providerové fronty jako plánovaný.
  update public.complete_power_outage_cez_projection_outages
  set source_status = 'cancelled', updated_at = now()
  where missing_since is not null
    and source_status in ('scheduled', 'active');

  select state.active_source, state.latest_complete_cycle_id
  into source_mode, complete_cycle_id
  from public.complete_power_outage_cez_projection_state state
  where state.singleton;

  if source_mode <> 'shadow' then
    return projection_result || jsonb_build_object(
      'publishStatus', 'disabled',
      'publishReason', 'legacy_source_active'
    );
  end if;

  if complete_cycle_id is null then
    return projection_result || jsonb_build_object(
      'publishStatus', 'blocked',
      'publishReason', 'no_complete_cycle'
    );
  end if;

  publish_request_id := public.request_power_outages_endpoint(
    '/api/power-outages/complete/sync?source=cez'
  );
  return projection_result || jsonb_build_object(
    'publishStatus', 'requested',
    'publishRequestId', publish_request_id
  );
end;
$$;

revoke all on function public.advance_complete_power_outage_cez_projection()
  from public, anon, authenticated;
grant execute on function public.advance_complete_power_outage_cez_projection()
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_cez_shadow_projection_every_five_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_cez_shadow_projection_every_five_minutes',
    '3-59/5 * * * *',
    $job$select public.advance_complete_power_outage_cez_projection();$job$
  );
end
$$;

commit;
