begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_projection_state') is null
    or to_regclass('public.complete_power_outage_cez_projection_runs') is null
    or to_regclass('public.complete_power_outage_cez_projection_outages') is null
    or to_regclass('public.complete_power_outage_cez_projection_addresses') is null
  then
    raise exception 'Nejdříve spusťte migrace stínové projekce a providerového mostu ČEZ.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_projection_state
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references auth.users(id) on delete set null,
  add column if not exists previous_source text;

alter table public.complete_power_outage_cez_projection_state
  drop constraint if exists cpo_cez_projection_state_previous_source_check;
alter table public.complete_power_outage_cez_projection_state
  add constraint cpo_cez_projection_state_previous_source_check
  check (previous_source is null or previous_source in ('legacy', 'shadow'));

create or replace view public.complete_power_outage_cez_new_status
with (security_invoker = true)
as
with municipality as (
  select
    count(*) filter (where is_active)::bigint as catalog_total,
    count(*) filter (where is_active and representative_status in ('resolved', 'no_address'))::bigint as representative_done,
    count(*) filter (where is_active and representative_status in ('needs_review', 'error'))::bigint as representative_error,
    count(*) filter (where is_active and (
      representative_status = 'no_address'
      or (representative_status = 'resolved' and mapping_status in ('resolved', 'not_cez'))
    ))::bigint as mapping_done,
    count(*) filter (where is_active and mapping_status in ('needs_review', 'error'))::bigint as mapping_error,
    count(*) filter (where is_active and representative_status = 'resolved'
      and mapping_status = 'resolved' and distribution_status = 'cez')::bigint as cez_mapped
  from public.complete_power_outage_cez_municipalities
), latest_cycle as (
  select cycle.*
  from public.complete_power_outage_cez_scan_cycles cycle
  where not cycle.is_pilot and cycle.snapshot_contract_version = 2
  order by cycle.started_at desc, cycle.id desc
  limit 1
), complete_cycles as (
  select count(*)::bigint as completed_count
  from public.complete_power_outage_cez_scan_cycles
  where not is_pilot and snapshot_contract_version = 2
    and status in ('succeeded', 'no_change') and snapshot_status = 'complete' and snapshot_publishable
), staged as (
  select
    count(address.id)::bigint as address_total,
    count(address.id) filter (where address.normalization_version >= 3
      and address.normalization_status = 'succeeded')::bigint as normalized_count,
    count(address.id) filter (where address.normalization_status in ('error', 'needs_review'))::bigint as error_count,
    max(address.normalized_at) as last_normalized_at
  from latest_cycle cycle
  join public.complete_power_outage_cez_cycle_outages member on member.cycle_id = cycle.id
  join public.complete_power_outage_cez_staged_addresses address
    on address.outage_external_id = member.outage_external_id
), projection as (
  select
    count(*)::bigint as outage_count,
    count(*) filter (where missing_since is null)::bigint as current_outage_count,
    max(updated_at) as last_outage_at
  from public.complete_power_outage_cez_projection_outages
), projection_addresses as (
  select count(*)::bigint as address_count, max(updated_at) as last_address_at
  from public.complete_power_outage_cez_projection_addresses
), last_projection as (
  select run.* from public.complete_power_outage_cez_projection_runs run
  order by run.started_at desc, run.id desc limit 1
), base as (
  select municipality.*,
    greatest(0, municipality.catalog_total - municipality.representative_done)::bigint as representative_remaining,
    greatest(0, municipality.catalog_total - municipality.mapping_done)::bigint as mapping_remaining,
    coalesce(latest_cycle.id, null) as cycle_id,
    coalesce(latest_cycle.status, 'waiting') as cycle_status,
    coalesce(latest_cycle.municipality_total_count, 0)::bigint as scan_total,
    coalesce(latest_cycle.municipality_processed_count, 0)::bigint as scan_processed,
    coalesce(latest_cycle.municipality_error_count, 0)::bigint as scan_error,
    coalesce(latest_cycle.outage_count, 0)::bigint as scan_outage_count,
    coalesce(latest_cycle.address_count, 0)::bigint as scan_address_count,
    latest_cycle.started_at as scan_started_at,
    latest_cycle.finished_at as scan_finished_at,
    latest_cycle.error_code as scan_error_code,
    latest_cycle.error_message as scan_error_message,
    coalesce(staged.address_total, 0)::bigint as normalization_total,
    coalesce(staged.normalized_count, 0)::bigint as normalization_done,
    greatest(0, coalesce(staged.address_total, 0) - coalesce(staged.normalized_count, 0))::bigint as normalization_remaining,
    coalesce(staged.error_count, 0)::bigint as normalization_error,
    staged.last_normalized_at,
    coalesce(projection.outage_count, 0)::bigint as projected_outage_count,
    coalesce(projection.current_outage_count, 0)::bigint as projected_current_outage_count,
    coalesce(projection_addresses.address_count, 0)::bigint as projected_address_count,
    coalesce(last_projection.status, 'waiting') as projection_status,
    last_projection.started_at as projection_started_at,
    last_projection.finished_at as projection_finished_at,
    last_projection.pending_normalization_count as projection_pending_count,
    last_projection.error_code as projection_error_code,
    last_projection.error_message as projection_error_message,
    state.active_source,
    state.latest_applied_cycle_id,
    state.latest_complete_cycle_id,
    state.last_projection_at,
    coalesce(complete_cycles.completed_count, 0)::bigint as publishable_cycle_count,
    ruian.status as ruian_runner_status,
    ruian.last_error as ruian_runner_error,
    mapping.status as mapping_runner_status,
    mapping.last_error as mapping_runner_error,
    scanner.status as scan_runner_status,
    scanner.last_error as scan_runner_error
  from municipality
  cross join public.complete_power_outage_cez_projection_state state
  left join latest_cycle on true
  left join staged on true
  left join projection on true
  left join projection_addresses on true
  left join last_projection on true
  left join complete_cycles on true
  left join public.complete_power_outage_cez_ruian_bootstrap_state ruian on ruian.singleton
  left join public.complete_power_outage_cez_mapping_bootstrap_state mapping on mapping.singleton
  left join public.complete_power_outage_cez_scan_runner_state scanner on scanner.singleton
  where state.singleton
)
select base.*,
  case
    when representative_remaining > 0 then 'ruian'
    when mapping_remaining > 0 then 'mapping'
    when cycle_status = 'running' or latest_complete_cycle_id is null then 'scan'
    when normalization_remaining > 0 then 'normalization'
    when projection_status not in ('ready', 'partial_ready') then 'projection'
    else 'ready'
  end as current_stage,
  case
    when coalesce(ruian_runner_status, '') = 'failed'
      or coalesce(mapping_runner_status, '') = 'failed'
      or coalesce(scan_runner_status, '') = 'error'
      or projection_status = 'failed'
      or scan_error > 0 or normalization_error > 0 then 'error'
    when representative_error > 0 or mapping_error > 0 then 'partial'
    when representative_remaining > 0 or mapping_remaining > 0
      or cycle_status = 'running' or normalization_remaining > 0
      or projection_status in ('building', 'partial_ready') then 'processing'
    when publishable_cycle_count >= 2 and projection_status = 'ready' then 'ready'
    else 'waiting'
  end as overall_status,
  case
    when representative_remaining > 0 then representative_done
    when mapping_remaining > 0 then mapping_done
    when cycle_status = 'running' or latest_complete_cycle_id is null then scan_processed
    when normalization_remaining > 0 then normalization_done
    else projected_outage_count
  end::bigint as progress_done,
  case
    when representative_remaining > 0 then catalog_total
    when mapping_remaining > 0 then catalog_total
    when cycle_status = 'running' or latest_complete_cycle_id is null then scan_total
    when normalization_remaining > 0 then normalization_total
    else projected_outage_count
  end::bigint as progress_total,
  coalesce(projection_error_message, scan_error_message, scan_runner_error,
    mapping_runner_error, ruian_runner_error) as last_error_message
from base;

revoke all on table public.complete_power_outage_cez_new_status from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_new_status to authenticated, service_role;

do $$
begin
  if to_regprocedure('public.publish_complete_power_outages_app_change()') is null then
    raise exception 'Chybí realtime publikační funkce režimu KOMPLETNÍ.';
  end if;
end
$$;

-- Každá tabulka publikuje pouze jednu událost za dokončený SQL příkaz.
-- UI tak dostává živý postup bez realtime zprávy pro každý jednotlivý řádek.
drop trigger if exists cpo_cez_new_ruian_publish_app_change
  on public.complete_power_outage_cez_ruian_bootstrap_state;
create trigger cpo_cez_new_ruian_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_ruian_bootstrap_state
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists cpo_cez_new_mapping_publish_app_change
  on public.complete_power_outage_cez_mapping_bootstrap_state;
create trigger cpo_cez_new_mapping_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_mapping_bootstrap_state
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists cpo_cez_new_scan_runner_publish_app_change
  on public.complete_power_outage_cez_scan_runner_state;
create trigger cpo_cez_new_scan_runner_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_scan_runner_state
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists cpo_cez_new_scan_cycle_publish_app_change
  on public.complete_power_outage_cez_scan_cycles;
create trigger cpo_cez_new_scan_cycle_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_scan_cycles
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists cpo_cez_new_projection_run_publish_app_change
  on public.complete_power_outage_cez_projection_runs;
create trigger cpo_cez_new_projection_run_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_projection_runs
for each statement execute function public.publish_complete_power_outages_app_change();

drop trigger if exists cpo_cez_new_projection_state_publish_app_change
  on public.complete_power_outage_cez_projection_state;
create trigger cpo_cez_new_projection_state_publish_app_change
after insert or update or delete on public.complete_power_outage_cez_projection_state
for each statement execute function public.publish_complete_power_outages_app_change();

-- Přepnutí je ruční, vratné a odmítne se, dokud nejsou splněny všechny brány.
create or replace function public.set_complete_power_outage_cez_source(requested_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_source text := lower(btrim(coalesce(requested_source, '')));
  status_row record;
  prior_source text;
begin
  if safe_source not in ('legacy', 'shadow') then
    raise exception 'Zdroj musí být legacy nebo shadow.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_activation')
  );
  select active_source into prior_source
  from public.complete_power_outage_cez_projection_state
  where singleton for update;

  if safe_source = 'shadow' then
    select * into status_row from public.complete_power_outage_cez_new_status;
    if status_row.representative_remaining > 0
      or status_row.mapping_remaining > 0
      or status_row.representative_error > 0
      or status_row.mapping_error > 0
      or status_row.scan_error > 0
      or status_row.normalization_remaining > 0
      or status_row.normalization_error > 0
      or status_row.projection_status <> 'ready'
      or status_row.publishable_cycle_count < 2
      or status_row.latest_complete_cycle_id is null
    then
      raise exception 'Nový ČEZ zdroj nesplňuje aktivační podmínky.';
    end if;
  end if;

  update public.complete_power_outage_cez_projection_state
  set previous_source = prior_source,
    active_source = safe_source,
    activated_at = now(),
    activated_by = auth.uid(),
    updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'lastSourceChangeAt', now(),
      'lastSourceChangeFrom', prior_source,
      'lastSourceChangeTo', safe_source
    )
  where singleton;

  return jsonb_build_object('ok', true, 'previousSource', prior_source,
    'activeSource', safe_source, 'changed', prior_source is distinct from safe_source);
end;
$$;

revoke all on function public.set_complete_power_outage_cez_source(text)
  from public, anon, authenticated;
grant execute on function public.set_complete_power_outage_cez_source(text) to service_role;

commit;
