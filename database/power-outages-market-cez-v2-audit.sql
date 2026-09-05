begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_collector_versions') is null
    or to_regclass('public.power_outage_cez_market_collector_state') is null
  then
    raise exception 'Nejdříve spusťte verzování sběrače ČEZ pro MARKETY.';
  end if;
  if to_regclass('public.power_outage_store_registry') is null
    or to_regclass('public.power_outages') is null
    or to_regclass('public.power_outage_store_matches') is null
  then
    raise exception 'Chybí produkční tabulky monitoringu odstávek MARKETY.';
  end if;
end
$$;

-- Audit v2 je fyzicky oddělený. Produkční tabulky pouze čte a žádná jeho
-- funkce do nich nesmí zapisovat.
create table if not exists public.power_outage_cez_market_v2_audit_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  requested_sample_count integer not null,
  address_total_count integer not null default 0,
  address_processed_count integer not null default 0,
  address_success_count integer not null default 0,
  address_error_count integer not null default 0,
  risk_case_count integer not null default 0,
  missing_loaded_outage_count integer not null default 0,
  missing_exact_outage_count integer not null default 0,
  missing_store_match_count integer not null default 0,
  external_request_count integer not null default 0,
  catalog_revision bigint not null,
  collector_version text not null default 'v1',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint po_cez_market_v2_audit_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed', 'cancelled')),
  constraint po_cez_market_v2_audit_runs_counts_check
    check (
      requested_sample_count between 20 and 500
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
    ),
  constraint po_cez_market_v2_audit_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint po_cez_market_v2_audit_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists po_cez_market_v2_audit_one_running_uidx
  on public.power_outage_cez_market_v2_audit_runs ((true))
  where status = 'running';

create table if not exists public.power_outage_cez_market_v2_audit_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.power_outage_cez_market_v2_audit_runs(id) on delete cascade,
  address_id bigint not null,
  municipality text not null,
  street text not null,
  house_number text,
  orientation_number text,
  store_ids jsonb not null,
  store_count integer not null,
  municipality_store_count integer not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  exact_outage_ids jsonb not null default '[]'::jsonb,
  town_outage_ids jsonb not null default '[]'::jsonb,
  union_outage_ids jsonb not null default '[]'::jsonb,
  production_loaded_outage_ids jsonb not null default '[]'::jsonb,
  missing_loaded_outage_ids jsonb not null default '[]'::jsonb,
  missing_exact_outage_ids jsonb not null default '[]'::jsonb,
  production_match_pairs jsonb not null default '[]'::jsonb,
  missing_store_match_pairs jsonb not null default '[]'::jsonb,
  risk_detected boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  lock_token uuid,
  lock_expires_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint po_cez_market_v2_audit_cases_run_address_unique
    unique (run_id, address_id),
  constraint po_cez_market_v2_audit_cases_address_check
    check (address_id > 0 and btrim(municipality) <> '' and btrim(street) <> ''),
  constraint po_cez_market_v2_audit_cases_counts_check
    check (store_count > 0 and municipality_store_count > 0 and attempt_count >= 0),
  constraint po_cez_market_v2_audit_cases_status_check
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  constraint po_cez_market_v2_audit_cases_lock_check
    check (
      (status = 'running' and lock_token is not null and lock_expires_at is not null)
      or (status <> 'running' and lock_token is null and lock_expires_at is null)
    ),
  constraint po_cez_market_v2_audit_cases_finished_check
    check (
      (status = 'pending' and started_at is null and finished_at is null)
      or (status = 'running' and started_at is not null and finished_at is null)
      or (status in ('succeeded', 'failed') and started_at is not null and finished_at is not null)
    ),
  constraint po_cez_market_v2_audit_cases_json_check
    check (
      jsonb_typeof(store_ids) = 'array'
      and jsonb_typeof(exact_outage_ids) = 'array'
      and jsonb_typeof(town_outage_ids) = 'array'
      and jsonb_typeof(union_outage_ids) = 'array'
      and jsonb_typeof(production_loaded_outage_ids) = 'array'
      and jsonb_typeof(missing_loaded_outage_ids) = 'array'
      and jsonb_typeof(missing_exact_outage_ids) = 'array'
      and jsonb_typeof(production_match_pairs) = 'array'
      and jsonb_typeof(missing_store_match_pairs) = 'array'
      and jsonb_typeof(metadata) = 'object'
    )
);

create index if not exists po_cez_market_v2_audit_cases_queue_idx
  on public.power_outage_cez_market_v2_audit_cases (run_id, status, address_id);
create index if not exists po_cez_market_v2_audit_cases_risk_idx
  on public.power_outage_cez_market_v2_audit_cases (run_id, risk_detected, municipality)
  where risk_detected;

drop trigger if exists po_cez_market_v2_audit_runs_set_updated_at
  on public.power_outage_cez_market_v2_audit_runs;
create trigger po_cez_market_v2_audit_runs_set_updated_at
before update on public.power_outage_cez_market_v2_audit_runs
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists po_cez_market_v2_audit_cases_set_updated_at
  on public.power_outage_cez_market_v2_audit_cases;
create trigger po_cez_market_v2_audit_cases_set_updated_at
before update on public.power_outage_cez_market_v2_audit_cases
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_cez_market_v2_audit_runs enable row level security;
alter table public.power_outage_cez_market_v2_audit_cases enable row level security;

drop policy if exists po_cez_market_v2_audit_runs_authorized_read
  on public.power_outage_cez_market_v2_audit_runs;
create policy po_cez_market_v2_audit_runs_authorized_read
  on public.power_outage_cez_market_v2_audit_runs
  for select to authenticated
  using (public.current_user_can_view_power_outages());
drop policy if exists po_cez_market_v2_audit_cases_authorized_read
  on public.power_outage_cez_market_v2_audit_cases;
create policy po_cez_market_v2_audit_cases_authorized_read
  on public.power_outage_cez_market_v2_audit_cases
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_cez_market_v2_audit_runs
  from public, anon, authenticated;
revoke all on table public.power_outage_cez_market_v2_audit_cases
  from public, anon, authenticated;
grant select on table public.power_outage_cez_market_v2_audit_runs to authenticated;
grant select on table public.power_outage_cez_market_v2_audit_cases to authenticated;
grant all on table public.power_outage_cez_market_v2_audit_runs to service_role;
grant all on table public.power_outage_cez_market_v2_audit_cases to service_role;

create or replace function public.claim_power_outage_cez_market_v2_audit_batch(
  requested_sample_count integer default 120,
  requested_limit integer default 3
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
  safe_sample integer := least(500, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(5, greatest(1, coalesce(requested_limit, 3)));
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
      requested_sample_count,
      catalog_revision,
      collector_version,
      metadata
    ) values (
      safe_sample,
      current_revision,
      'v1',
      jsonb_build_object(
        'contract', 'cez-market-v2-read-only-audit-v1',
        'productionWritesAllowed', false,
        'selection', 'verified CEZ address IDs; cities with multiple stores first'
      )
    ) returning id into active_run_id;

    insert into public.power_outage_cez_market_v2_audit_cases (
      run_id,
      address_id,
      municipality,
      street,
      house_number,
      orientation_number,
      store_ids,
      store_count,
      municipality_store_count
    )
    with eligible as (
      select
        registry.ruian_address_id as address_id,
        min(registry.store_city) as municipality,
        min(registry.store_address) as street,
        min(registry.house_number) as house_number,
        min(registry.orientation_number) as orientation_number,
        jsonb_agg(distinct registry.store_id) filter (where registry.store_id is not null) as store_ids,
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
    ), sampled as (
      select *
      from eligible
      order by
        eligible.municipality_store_count desc,
        eligible.store_count desc,
        md5(eligible.address_id::text)
      limit safe_sample
    )
    select
      active_run_id,
      sampled.address_id,
      sampled.municipality,
      sampled.street,
      sampled.house_number,
      sampled.orientation_number,
      sampled.store_ids,
      sampled.store_count,
      sampled.municipality_store_count
    from sampled;

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

create or replace function public.finish_power_outage_cez_market_v2_audit_run(
  requested_run_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  total_count integer;
  processed_count integer;
  success_count integer;
  failed_count integer;
  risk_count integer;
  missing_loaded_count integer;
  missing_exact_count integer;
  missing_match_count integer;
  final_status text;
begin
  select address_total_count
  into total_count
  from public.power_outage_cez_market_v2_audit_runs
  where id = requested_run_id and status = 'running'
  for update;

  if not found then
    select status into final_status
    from public.power_outage_cez_market_v2_audit_runs
    where id = requested_run_id;
    return coalesce(final_status, 'missing');
  end if;

  select
    count(*) filter (where status in ('succeeded', 'failed'))::integer,
    count(*) filter (where status = 'succeeded')::integer,
    count(*) filter (where status = 'failed')::integer,
    count(*) filter (where risk_detected)::integer,
    coalesce(sum(jsonb_array_length(missing_loaded_outage_ids)), 0)::integer,
    coalesce(sum(jsonb_array_length(missing_exact_outage_ids)), 0)::integer,
    coalesce(sum(jsonb_array_length(missing_store_match_pairs)), 0)::integer
  into processed_count, success_count, failed_count, risk_count,
    missing_loaded_count, missing_exact_count, missing_match_count
  from public.power_outage_cez_market_v2_audit_cases
  where run_id = requested_run_id;

  update public.power_outage_cez_market_v2_audit_runs
  set address_processed_count = processed_count,
      address_success_count = success_count,
      address_error_count = failed_count,
      risk_case_count = risk_count,
      missing_loaded_outage_count = missing_loaded_count,
      missing_exact_outage_count = missing_exact_count,
      missing_store_match_count = missing_match_count,
      external_request_count = processed_count
  where id = requested_run_id;

  if processed_count < total_count then
    return 'running';
  end if;

  final_status := case
    when failed_count = total_count and total_count > 0 then 'failed'
    when failed_count > 0 then 'partial'
    else 'succeeded'
  end;

  update public.power_outage_cez_market_v2_audit_runs
  set status = final_status,
      finished_at = now(),
      error_code = case when failed_count > 0 then 'CEZ_V2_AUDIT_CASE_ERRORS' else null end,
      error_message = case when failed_count > 0 then failed_count::text || ' adres nebylo možné ověřit.' else null end
  where id = requested_run_id;

  return final_status;
end;
$$;

revoke all on function public.finish_power_outage_cez_market_v2_audit_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finish_power_outage_cez_market_v2_audit_run(uuid)
  to service_role;

create or replace function public.request_power_outage_cez_market_v2_audit(
  requested_sample_count integer default 120,
  requested_limit integer default 3
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_sample integer := least(500, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(5, greatest(1, coalesce(requested_limit, 3)));
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
      'User-Agent', 'B-Energy-MARKETY-CEZ-v2-Audit/1.0'
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

commit;
