begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_observations') is null
    or to_regclass('public.power_outage_cez_market_cycles') is null
    or to_regprocedure('public.record_power_outage_cez_market_observation(text,text,uuid,uuid,boolean,boolean,timestamptz,jsonb)') is null
  then
    raise exception 'Nejdříve spusťte databázový základ a runtime ČEZ MARKETY v2.';
  end if;
end
$$;

create table if not exists public.power_outage_cez_market_version_state (
  collector_version text primary key
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  cadence interval not null,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_complete_at timestamptz,
  last_complete_cycle_id uuid references public.power_outage_cez_market_cycles(id) on delete set null,
  last_target_count integer not null default 0,
  last_outage_count integer not null default 0,
  consecutive_failure_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint po_cez_market_version_state_version_check check (collector_version in ('v1', 'v2')),
  constraint po_cez_market_version_state_cadence_check check (cadence between interval '1 hour' and interval '7 days'),
  constraint po_cez_market_version_state_counts_check check (
    last_target_count >= 0 and last_outage_count >= 0 and consecutive_failure_count >= 0
  ),
  constraint po_cez_market_version_state_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.power_outage_cez_market_version_state (
  collector_version, cadence, last_attempt_at, last_success_at, last_complete_at,
  last_target_count, last_outage_count, metadata
)
select
  'v1', interval '24 hours', source.last_attempt_at, source.last_success_at,
  nullif(source.metadata ->> 'lastFullScanAt', '')::timestamptz, 0,
  (select count(*)::integer from public.power_outage_cez_market_observations where collector_version = 'v1'),
  jsonb_build_object('seededFromLegacySourceState', true)
from public.power_outage_source_state source
where source.source = 'cez'
on conflict (collector_version) do update set cadence = interval '24 hours';

insert into public.power_outage_cez_market_version_state (collector_version, cadence, metadata)
values ('v2', interval '6 hours', jsonb_build_object('activationState', 'inactive'))
on conflict (collector_version) do update set cadence = interval '6 hours';

drop trigger if exists po_cez_market_version_state_set_updated_at
  on public.power_outage_cez_market_version_state;
create trigger po_cez_market_version_state_set_updated_at
before update on public.power_outage_cez_market_version_state
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_cez_market_version_state enable row level security;
drop policy if exists po_cez_market_version_state_authorized_read
  on public.power_outage_cez_market_version_state;
create policy po_cez_market_version_state_authorized_read
  on public.power_outage_cez_market_version_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());
revoke all on table public.power_outage_cez_market_version_state from public, anon, authenticated;
grant select on table public.power_outage_cez_market_version_state to authenticated;
grant all on table public.power_outage_cez_market_version_state to service_role;

create or replace function public.reconcile_power_outage_cez_market_union_missing()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  restored_count integer := 0;
  missing_count integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Stav nálezů ČEZ MARKETY může vyhodnotit pouze service role.';
  end if;

  with runtime as (
    select case operating_mode
      when 'dual' then array['v1', 'v2']::text[]
      when 'v2_only' then array['v2']::text[]
      else array['v1']::text[]
    end as active_versions
    from public.power_outage_cez_market_collector_state where singleton
  )
  update public.power_outages outage
  set missing_since = null
  from runtime
  where outage.source = 'cez'
    and outage.missing_since is not null
    and exists (
      select 1
      from public.power_outage_cez_market_observations observation
      where observation.external_id = outage.external_id
        and observation.collector_version = any(runtime.active_versions)
        and observation.missing_since is null
    );
  get diagnostics restored_count = row_count;

  with runtime as (
    select case operating_mode
      when 'dual' then array['v1', 'v2']::text[]
      when 'v2_only' then array['v2']::text[]
      else array['v1']::text[]
    end as active_versions
    from public.power_outage_cez_market_collector_state where singleton
  )
  update public.power_outages outage
  set missing_since = now()
  from runtime
  where outage.source = 'cez'
    and outage.missing_since is null
    and not exists (
      select 1
      from unnest(runtime.active_versions) active_version(version)
      left join public.power_outage_cez_market_version_state version_state
        on version_state.collector_version = active_version.version
      left join public.power_outage_cez_market_observations observation
        on observation.collector_version = active_version.version
       and observation.external_id = outage.external_id
      where version_state.last_complete_at is null
        or version_state.last_complete_at < outage.last_seen_at
        or (observation.external_id is not null and observation.missing_since is null)
    );
  get diagnostics missing_count = row_count;

  return jsonb_build_object(
    'restoredCount', restored_count,
    'missingCount', missing_count,
    'evaluatedAt', now()
  );
end;
$$;

create or replace function public.finish_power_outage_cez_market_v1_snapshot(
  requested_external_ids jsonb,
  requested_observed_at timestamptz,
  requested_target_count integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  outage_count integer := 0;
  lifecycle_result jsonb;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Snapshot ČEZ MARKETY v1 může dokončit pouze service role.';
  end if;
  if jsonb_typeof(requested_external_ids) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(requested_external_ids) item
      where jsonb_typeof(item) <> 'string'
    )
  then
    raise exception 'ID odstávek snapshotu ČEZ v1 musí být JSON pole textů.';
  end if;

  select jsonb_array_length(requested_external_ids) into outage_count;
  update public.power_outage_cez_market_observations observation
  set missing_since = case
    when requested_external_ids ? observation.external_id then null
    else coalesce(observation.missing_since, requested_observed_at)
  end,
      last_complete_cycle_id = null
  where observation.collector_version = 'v1';

  update public.power_outage_cez_market_version_state
  set last_attempt_at = requested_observed_at,
      last_success_at = requested_observed_at,
      last_complete_at = requested_observed_at,
      last_complete_cycle_id = null,
      last_target_count = greatest(0, coalesce(requested_target_count, 0)),
      last_outage_count = outage_count,
      consecutive_failure_count = 0,
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object('lastSnapshotContract', 'cez-market-v1-complete-v1')
  where collector_version = 'v1';

  lifecycle_result := public.reconcile_power_outage_cez_market_union_missing();
  return jsonb_build_object('outageCount', outage_count, 'lifecycle', lifecycle_result);
end;
$$;

create or replace function public.update_power_outage_cez_market_v2_version_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.collector_version <> 'v2' then return new; end if;
  if new.status = 'running' and old.status is distinct from 'running' then
    update public.power_outage_cez_market_version_state
    set last_attempt_at = coalesce(new.started_at, now())
    where collector_version = 'v2';
  elsif new.status = 'succeeded' and old.status is distinct from 'succeeded' then
    update public.power_outage_cez_market_version_state
    set last_success_at = new.finished_at,
        last_complete_at = new.finished_at,
        last_complete_cycle_id = new.id,
        last_target_count = new.target_count,
        last_outage_count = new.discovered_outage_count,
        consecutive_failure_count = 0,
        last_error_code = null,
        last_error_message = null,
        metadata = metadata || jsonb_build_object('lastSnapshotContract', 'cez-market-v2-complete-v1')
    where collector_version = 'v2';
    perform public.reconcile_power_outage_cez_market_union_missing();
  elsif new.status in ('partial', 'failed') and old.status is distinct from new.status then
    update public.power_outage_cez_market_version_state
    set consecutive_failure_count = consecutive_failure_count + 1,
        last_error_code = new.error_code,
        last_error_message = new.error_message
    where collector_version = 'v2';
  end if;
  return new;
end;
$$;

drop trigger if exists po_cez_market_v2_cycle_updates_version_state
  on public.power_outage_cez_market_cycles;
create trigger po_cez_market_v2_cycle_updates_version_state
after update on public.power_outage_cez_market_cycles
for each row execute function public.update_power_outage_cez_market_v2_version_state();

revoke all on function public.reconcile_power_outage_cez_market_union_missing()
  from public, anon, authenticated;
revoke all on function public.finish_power_outage_cez_market_v1_snapshot(jsonb,timestamptz,integer)
  from public, anon, authenticated;
revoke all on function public.update_power_outage_cez_market_v2_version_state()
  from public, anon, authenticated;
grant execute on function public.reconcile_power_outage_cez_market_union_missing() to service_role;
grant execute on function public.finish_power_outage_cez_market_v1_snapshot(jsonb,timestamptz,integer) to service_role;

commit;

select 'FUNCTION' as check_type, 'union-safe CEZ MARKET missing reconciliation' as object_name,
  to_regprocedure('public.reconcile_power_outage_cez_market_union_missing()') is not null as is_correct
union all
select 'FUNCTION', 'complete CEZ MARKET v1 version snapshot',
  to_regprocedure('public.finish_power_outage_cez_market_v1_snapshot(jsonb,timestamptz,integer)') is not null
union all
select 'GRANT', 'authenticated cannot finalize CEZ MARKET lifecycle',
  not has_function_privilege('authenticated', 'public.reconcile_power_outage_cez_market_union_missing()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_power_outage_cez_market_v1_snapshot(jsonb,timestamptz,integer)', 'EXECUTE')
union all
select 'ISOLATION', 'dual lifecycle does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(
    pg_get_functiondef('public.reconcile_power_outage_cez_market_union_missing()'::regprocedure)
    || pg_get_functiondef('public.finish_power_outage_cez_market_v1_snapshot(jsonb,timestamptz,integer)'::regprocedure)
  )) = 0
union all
select 'LOGIC', 'dual missing requires both v1 and v2 complete evidence',
  position('array[''v1'', ''v2'']' in pg_get_functiondef(
    'public.reconcile_power_outage_cez_market_union_missing()'::regprocedure
  )) > 0
union all
select 'SAFETY', 'lifecycle migration started no CEZ MARKET v2 cycle',
  not exists (select 1 from public.power_outage_cez_market_cycles where collector_version = 'v2')
union all
select 'STATE', 'CEZ MARKET remains v1 only before activation',
  coalesce((select operating_mode = 'v1_only' and activation_ready is false
    from public.power_outage_cez_market_collector_state where singleton), false)
union all
select 'STATE', 'CEZ MARKET v1 cadence is 24 hours',
  coalesce((select cadence = interval '24 hours'
    from public.power_outage_cez_market_version_state where collector_version = 'v1'), false)
union all
select 'STATE', 'CEZ MARKET v2 cycle cadence is 6 hours',
  coalesce((select cadence = interval '6 hours'
    from public.power_outage_cez_market_version_state where collector_version = 'v2'), false)
union all
select 'TRIGGER', 'successful v2 cycle updates union lifecycle',
  exists (select 1 from pg_trigger
    where tgname = 'po_cez_market_v2_cycle_updates_version_state' and not tgisinternal)
order by check_type, object_name;
