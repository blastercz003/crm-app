begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_collector_state') is null
    or to_regclass('public.power_outage_cez_market_version_state') is null
    or to_regclass('public.power_outage_cez_market_cycles') is null
    or to_regclass('public.power_outage_cez_market_observations') is null
    or to_regclass('public.power_outages') is null
  then
    raise exception 'Nejdříve spusťte databázový základ a lifecycle ČEZ MARKETY v1 + v2.';
  end if;
end
$$;

-- Dva malé read-only přehledy slouží výhradně administračnímu UI MARKETY.
-- Nezakládají cyklus, nemění režim sběrače a neprovádějí žádné produkční zápisy.
create or replace view public.power_outage_cez_market_version_overview
with (security_invoker = true)
as
with runtime as (
  select
    state.operating_mode,
    state.primary_version,
    state.secondary_version,
    state.activation_ready,
    state.switched_at
  from public.power_outage_cez_market_collector_state state
  where state.singleton
),
current_observations as (
  select
    observation.collector_version,
    observation.external_id,
    observation.returned_for_exact_address,
    observation.returned_for_town
  from public.power_outage_cez_market_observations observation
  join public.power_outages outage
    on outage.id = observation.outage_id
   and outage.source = 'cez'
  where observation.missing_since is null
    and outage.missing_since is null
    and outage.archived_at is null
    and outage.source_status in ('scheduled', 'active')
    and outage.archive_at > now()
),
observation_totals as (
  select
    observation.collector_version,
    count(distinct observation.external_id)::integer as observed_outage_count,
    count(distinct observation.external_id)
      filter (where observation.returned_for_exact_address)::integer as exact_outage_count,
    count(distinct observation.external_id)
      filter (where observation.returned_for_town)::integer as town_outage_count
  from current_observations observation
  group by observation.collector_version
)
select
  version.version as collector_version,
  version.display_name,
  runtime.operating_mode,
  runtime.primary_version,
  runtime.secondary_version,
  runtime.activation_ready,
  runtime.switched_at,
  case
    when version.version = 'v1' then runtime.operating_mode in ('v1_only', 'dual')
    when version.version = 'v2' then runtime.operating_mode in ('dual', 'v2_only')
    else false
  end as is_enabled,
  version.version = runtime.primary_version as is_primary,
  extract(epoch from version_state.cadence)::integer as cadence_seconds,
  version_state.last_attempt_at,
  version_state.last_success_at,
  version_state.last_complete_at,
  version_state.last_target_count,
  version_state.last_outage_count,
  version_state.consecutive_failure_count,
  version_state.last_error_code,
  version_state.last_error_message,
  latest_cycle.id as latest_cycle_id,
  latest_cycle.status as latest_cycle_status,
  latest_cycle.target_count,
  latest_cycle.processed_count,
  latest_cycle.success_count,
  latest_cycle.error_count,
  latest_cycle.discovered_outage_count,
  latest_cycle.exact_outage_count as cycle_exact_outage_count,
  latest_cycle.town_outage_count as cycle_town_outage_count,
  latest_cycle.started_at as cycle_started_at,
  latest_cycle.finished_at as cycle_finished_at,
  latest_cycle.error_code as cycle_error_code,
  latest_cycle.error_message as cycle_error_message,
  coalesce(observation_totals.observed_outage_count, 0) as observed_outage_count,
  coalesce(observation_totals.exact_outage_count, 0) as exact_outage_count,
  coalesce(observation_totals.town_outage_count, 0) as town_outage_count,
  case
    when not (
      (version.version = 'v1' and runtime.operating_mode in ('v1_only', 'dual'))
      or (version.version = 'v2' and runtime.operating_mode in ('dual', 'v2_only'))
    ) then 'inactive'
    when latest_cycle.status in ('pending', 'running') then 'processing'
    when latest_cycle.status in ('failed', 'partial')
      or version_state.last_error_code is not null then 'error'
    when version_state.last_complete_at is null then 'waiting'
    when version_state.last_complete_at + (version_state.cadence * 3 / 2) < now() then 'delayed'
    else 'current'
  end as health_status
from public.power_outage_cez_market_collector_versions version
cross join runtime
left join public.power_outage_cez_market_version_state version_state
  on version_state.collector_version = version.version
left join observation_totals
  on observation_totals.collector_version = version.version
left join lateral (
  select cycle.*
  from public.power_outage_cez_market_cycles cycle
  where cycle.collector_version = version.version
  order by cycle.created_at desc
  limit 1
) latest_cycle on true
where version.version in ('v1', 'v2');

create or replace view public.power_outage_cez_market_union_overview
with (security_invoker = true)
as
with runtime as (
  select
    state.operating_mode,
    state.primary_version,
    state.secondary_version,
    state.activation_ready,
    state.switched_at
  from public.power_outage_cez_market_collector_state state
  where state.singleton
),
current_observations as (
  select distinct
    observation.collector_version,
    observation.external_id
  from public.power_outage_cez_market_observations observation
  join public.power_outages outage
    on outage.id = observation.outage_id
   and outage.source = 'cez'
  where observation.missing_since is null
    and outage.missing_since is null
    and outage.archived_at is null
    and outage.source_status in ('scheduled', 'active')
    and outage.archive_at > now()
),
by_outage as (
  select
    observation.external_id,
    bool_or(observation.collector_version = 'v1') as found_by_v1,
    bool_or(observation.collector_version = 'v2') as found_by_v2
  from current_observations observation
  group by observation.external_id
)
select
  runtime.operating_mode,
  runtime.primary_version,
  runtime.secondary_version,
  runtime.activation_ready,
  runtime.switched_at,
  count(*) filter (where by_outage.found_by_v1)::integer as v1_outage_count,
  count(*) filter (where by_outage.found_by_v2)::integer as v2_outage_count,
  count(*) filter (where by_outage.found_by_v1 and by_outage.found_by_v2)::integer
    as shared_outage_count,
  count(*) filter (where by_outage.found_by_v1 and not by_outage.found_by_v2)::integer
    as v1_only_outage_count,
  count(*) filter (where by_outage.found_by_v2 and not by_outage.found_by_v1)::integer
    as v2_only_outage_count,
  count(by_outage.external_id)::integer as unique_outage_count,
  now() as calculated_at
from runtime
left join by_outage on true
group by
  runtime.operating_mode,
  runtime.primary_version,
  runtime.secondary_version,
  runtime.activation_ready,
  runtime.switched_at;

revoke all on table public.power_outage_cez_market_version_overview
  from public, anon, authenticated;
revoke all on table public.power_outage_cez_market_union_overview
  from public, anon, authenticated;
grant select on table public.power_outage_cez_market_version_overview to authenticated;
grant select on table public.power_outage_cez_market_union_overview to authenticated;
grant select on table public.power_outage_cez_market_version_overview to service_role;
grant select on table public.power_outage_cez_market_union_overview to service_role;

comment on view public.power_outage_cez_market_version_overview is
  'Read-only provozní přehled oddělených sběračů ČEZ v1 a v2 pro tab MARKETY.';
comment on view public.power_outage_cez_market_union_overview is
  'Read-only deduplikovaný souhrn nálezů ČEZ v1 + v2 pro tab MARKETY.';

commit;

select 'DATA' as check_type, 'CEZ MARKET overview contains v1 and v2' as object_name,
  (select array_agg(collector_version order by collector_version)
     from public.power_outage_cez_market_version_overview) = array['v1', 'v2']::text[] as is_correct
union all
select 'GRANT', 'authenticated reads CEZ MARKET overview only',
  has_table_privilege('authenticated', 'public.power_outage_cez_market_version_overview', 'SELECT')
  and not has_table_privilege('authenticated', 'public.power_outage_cez_market_cycles', 'INSERT,UPDATE,DELETE')
union all
select 'ISOLATION', 'CEZ MARKET overview does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(
    pg_get_viewdef('public.power_outage_cez_market_version_overview'::regclass, true)
    || pg_get_viewdef('public.power_outage_cez_market_union_overview'::regclass, true)
  )) = 0
union all
select 'LOGIC', 'CEZ MARKET union count is deduplicated',
  coalesce((select unique_outage_count = v1_only_outage_count + v2_only_outage_count + shared_outage_count
    from public.power_outage_cez_market_union_overview), false)
union all
select 'SAFETY', 'overview migration started no CEZ MARKET v2 cycle',
  not exists (select 1 from public.power_outage_cez_market_cycles where collector_version = 'v2')
union all
select 'SAFETY', 'overview migration created no CEZ MARKET production cron',
  not exists (
    select 1 from cron.job
    where jobname in ('power-outages-market-cez-v2', 'power-outages-market-cez-v2-production')
      or lower(command) like '%/api/power-outages/cez/v2%'
  )
union all
select 'STATE', 'CEZ MARKET remains v1 only before activation',
  coalesce((select operating_mode = 'v1_only' and activation_ready is false
    from public.power_outage_cez_market_collector_state where singleton), false)
union all
select 'VIEW', 'CEZ MARKET per-version overview exists',
  to_regclass('public.power_outage_cez_market_version_overview') is not null
union all
select 'VIEW', 'CEZ MARKET deduplicated union overview exists',
  to_regclass('public.power_outage_cez_market_union_overview') is not null
order by check_type, object_name;
