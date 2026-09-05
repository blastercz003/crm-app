begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_v2_audit_runs') is null
    or to_regclass('public.power_outage_cez_market_v2_audit_cases') is null
    or to_regclass('public.power_outage_cez_market_collector_state') is null
  then
    raise exception 'Nejdříve spusťte základní migrace auditu ČEZ MARKETY v2.';
  end if;
end
$$;

alter table public.power_outage_cez_market_v2_audit_runs
  drop constraint if exists po_cez_market_v2_audit_runs_counts_check;
alter table public.power_outage_cez_market_v2_audit_runs
  add constraint po_cez_market_v2_audit_runs_counts_check
  check (
    requested_sample_count between 20 and 2000
    and address_total_count between 0 and requested_sample_count
    and address_processed_count between 0 and address_total_count
    and address_success_count >= 0
    and address_error_count >= 0
    and risk_case_count >= 0
    and missing_loaded_outage_count >= 0
    and missing_exact_outage_count >= 0
    and missing_store_match_count >= 0
    and external_request_count >= 0
    and catalog_revision >= 0
  );

alter table public.power_outage_cez_market_v2_audit_cases
  add column if not exists missing_outage_details jsonb not null default '[]'::jsonb;

alter table public.power_outage_cez_market_v2_audit_cases
  drop constraint if exists po_cez_market_v2_audit_cases_json_check;
alter table public.power_outage_cez_market_v2_audit_cases
  add constraint po_cez_market_v2_audit_cases_json_check
  check (
    jsonb_typeof(store_ids) = 'array'
    and jsonb_typeof(exact_outage_ids) = 'array'
    and jsonb_typeof(town_outage_ids) = 'array'
    and jsonb_typeof(union_outage_ids) = 'array'
    and jsonb_typeof(production_loaded_outage_ids) = 'array'
    and jsonb_typeof(missing_loaded_outage_ids) = 'array'
    and jsonb_typeof(missing_exact_outage_ids) = 'array'
    and jsonb_typeof(missing_outage_details) = 'array'
    and jsonb_typeof(production_match_pairs) = 'array'
    and jsonb_typeof(missing_store_match_pairs) = 'array'
    and jsonb_typeof(metadata) = 'object'
  );

create or replace function public.claim_power_outage_cez_market_v2_audit_batch(
  requested_sample_count integer default 120,
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
  active_run_id uuid;
  safe_sample integer := least(2000, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(2, greatest(1, coalesce(requested_limit, 2)));
  current_revision bigint := 0;
  active_collector_version text;
begin
  select state.active_version
  into active_collector_version
  from public.power_outage_cez_market_collector_state state
  where state.singleton;

  if active_collector_version is distinct from 'v1' then
    raise exception 'Audit v2 vyžaduje aktivní produkční základ ČEZ v1.';
  end if;

  select coalesce(revision, 0)
  into current_revision
  from public.power_outage_store_catalog_state
  where singleton;

  update public.power_outage_cez_market_v2_audit_cases audit_case
  set status = case when audit_case.attempt_count >= 3 then 'failed' else 'pending' end,
      started_at = case when audit_case.attempt_count >= 3 then audit_case.started_at else null end,
      finished_at = case when audit_case.attempt_count >= 3 then now() else null end,
      lock_token = null,
      lock_expires_at = null,
      error_code = 'CEZ_V2_AUDIT_STALE',
      error_message = 'Auditní zámek vypršel.'
  where audit_case.status = 'running'
    and audit_case.lock_expires_at < now();

  select audit_run.id
  into active_run_id
  from public.power_outage_cez_market_v2_audit_runs audit_run
  where audit_run.status = 'running'
  order by audit_run.started_at desc
  limit 1
  for update;

  if active_run_id is null then
    insert into public.power_outage_cez_market_v2_audit_runs (
      requested_sample_count, catalog_revision, collector_version, metadata
    ) values (
      safe_sample,
      current_revision,
      'v1',
      jsonb_build_object(
        'contract', 'cez-market-v2-read-only-full-audit-v2',
        'productionWritesAllowed', false,
        'selection', 'all unique verified CEZ MARKET address IDs'
      )
    ) returning id into active_run_id;

    insert into public.power_outage_cez_market_v2_audit_cases (
      run_id, address_id, municipality, street, house_number,
      orientation_number, store_ids, store_count, municipality_store_count
    )
    with eligible as (
      select
        registry.ruian_address_id as selected_address_id,
        min(registry.store_city) as municipality,
        min(registry.store_address) as street,
        min(registry.house_number) as house_number,
        min(registry.orientation_number) as orientation_number,
        jsonb_agg(distinct registry.store_id)
          filter (where registry.store_id is not null) as store_ids,
        count(distinct registry.store_id)::integer as store_count,
        max(city_counts.store_count)::integer as municipality_store_count
      from public.power_outage_store_registry registry
      join (
        select normalized_municipality, count(distinct store_id) as store_count
        from public.power_outage_store_registry
        where is_active
          and distributor = 'cez'
          and verification_status = 'verified'
          and ruian_address_id is not null
          and store_id is not null
        group by normalized_municipality
      ) city_counts using (normalized_municipality)
      where registry.is_active
        and registry.distributor = 'cez'
        and registry.verification_status = 'verified'
        and registry.ruian_address_id is not null
        and registry.store_id is not null
      group by registry.ruian_address_id
    )
    select
      active_run_id,
      eligible.selected_address_id,
      eligible.municipality,
      eligible.street,
      eligible.house_number,
      eligible.orientation_number,
      eligible.store_ids,
      eligible.store_count,
      eligible.municipality_store_count
    from eligible
    order by eligible.selected_address_id
    limit safe_sample;

    update public.power_outage_cez_market_v2_audit_runs audit_run
    set address_total_count = (
      select count(*)::integer
      from public.power_outage_cez_market_v2_audit_cases audit_case
      where audit_case.run_id = active_run_id
    )
    where audit_run.id = active_run_id;
  end if;

  return query
  with selected as (
    select audit_case.id
    from public.power_outage_cez_market_v2_audit_cases audit_case
    where audit_case.run_id = active_run_id
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

revoke all on function public.claim_power_outage_cez_market_v2_audit_batch(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_power_outage_cez_market_v2_audit_batch(integer, integer)
  to service_role;

create or replace function public.request_power_outage_cez_market_v2_audit(
  requested_sample_count integer default 120,
  requested_limit integer default 2
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_sample integer := least(2000, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(2, greatest(1, coalesce(requested_limit, 2)));
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
    raise exception 'Vault secret weather_alerts_app_url neobsahuje platnou HTTPS adresu aplikace.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url
      || '/api/power-outages/cez/v2-audit?sample='
      || safe_sample::text
      || '&limit='
      || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-MARKETY-CEZ-v2-Full-Audit/2.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_power_outage_cez_market_v2_audit(integer, integer)
  from public, anon, authenticated;
grant execute on function public.request_power_outage_cez_market_v2_audit(integer, integer)
  to service_role;

-- Migrace audit pouze rozšiřuje. Nový audit se spustí až samostatným příkazem.
commit;
