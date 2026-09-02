begin;

alter table public.complete_power_outage_companies
  add column if not exists evaluation_version integer not null default 0,
  add column if not exists evaluation_reasons text[] not null default '{}'::text[],
  add column if not exists evaluated_at timestamptz;

alter table public.complete_power_outage_companies
  drop constraint if exists cpo_companies_evaluation_version_check;
alter table public.complete_power_outage_companies
  add constraint cpo_companies_evaluation_version_check
  check (evaluation_version >= 0);

create index if not exists cpo_companies_evaluation_queue_idx
  on public.complete_power_outage_companies (evaluation_version, updated_at, id)
  where candidate_status not in ('dismissed', 'stale');

create or replace function public.merge_complete_power_outage_company_candidates(
  requested_survivor_id uuid,
  requested_duplicate_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  survivor public.complete_power_outage_companies%rowtype;
  duplicate public.complete_power_outage_companies%rowtype;
begin
  if requested_survivor_id is null or requested_duplicate_id is null
     or requested_survivor_id = requested_duplicate_id then
    return false;
  end if;

  select * into survivor from public.complete_power_outage_companies
  where id = requested_survivor_id for update;
  select * into duplicate from public.complete_power_outage_companies
  where id = requested_duplicate_id for update;
  if survivor.id is null or duplicate.id is null
     or survivor.outage_address_id <> duplicate.outage_address_id then
    return false;
  end if;
  if survivor.resolved_by is not null and duplicate.resolved_by is not null
     and survivor.candidate_status <> duplicate.candidate_status then
    return false;
  end if;

  insert into public.complete_power_outage_company_evidence (
    company_id, provider, provider_entity_id, evidence_kind, match_level,
    display_name, display_address, source_url, distance_meters, confidence,
    payload_sha256, observed_at, expires_at, metadata
  )
  select requested_survivor_id, provider, provider_entity_id, evidence_kind,
    match_level, display_name, display_address, source_url, distance_meters,
    confidence, payload_sha256, observed_at, expires_at, metadata
  from public.complete_power_outage_company_evidence
  where company_id = requested_duplicate_id
  on conflict (company_id, provider, provider_entity_id) do update set
    confidence = greatest(public.complete_power_outage_company_evidence.confidence, excluded.confidence),
    observed_at = greatest(public.complete_power_outage_company_evidence.observed_at, excluded.observed_at),
    display_address = coalesce(public.complete_power_outage_company_evidence.display_address, excluded.display_address),
    source_url = coalesce(public.complete_power_outage_company_evidence.source_url, excluded.source_url),
    metadata = public.complete_power_outage_company_evidence.metadata || excluded.metadata,
    updated_at = now();

  update public.complete_power_outage_companies set
    ico = coalesce(survivor.ico, duplicate.ico),
    legal_form = coalesce(survivor.legal_form, duplicate.legal_form),
    nace_codes = case when cardinality(survivor.nace_codes) > 0 then survivor.nace_codes else duplicate.nace_codes end,
    employee_category = coalesce(survivor.employee_category, duplicate.employee_category),
    ruian_address_id = coalesce(survivor.ruian_address_id, duplicate.ruian_address_id),
    display_address = coalesce(survivor.display_address, duplicate.display_address),
    latitude = coalesce(survivor.latitude, duplicate.latitude),
    longitude = coalesce(survivor.longitude, duplicate.longitude),
    first_seen_at = least(survivor.first_seen_at, duplicate.first_seen_at),
    last_seen_at = greatest(survivor.last_seen_at, duplicate.last_seen_at),
    last_verified_at = greatest(survivor.last_verified_at, duplicate.last_verified_at),
    resolved_at = coalesce(survivor.resolved_at, duplicate.resolved_at),
    resolved_by = coalesce(survivor.resolved_by, duplicate.resolved_by),
    candidate_status = case
      when survivor.resolved_by is not null then survivor.candidate_status
      when duplicate.resolved_by is not null then duplicate.candidate_status
      else survivor.candidate_status
    end,
    evaluation_version = 0,
    evaluation_reasons = '{}'::text[],
    evaluated_at = null,
    metadata = survivor.metadata || duplicate.metadata || jsonb_build_object('deduplicatedAt', now()),
    updated_at = now()
  where id = requested_survivor_id;

  delete from public.complete_power_outage_companies where id = requested_duplicate_id;
  return true;
end;
$$;

revoke all on function public.merge_complete_power_outage_company_candidates(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.merge_complete_power_outage_company_candidates(uuid, uuid)
  to service_role;

create or replace function public.request_complete_power_outage_company_reconciliation(
  requested_limit integer default 250
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(1000, greatest(1, coalesce(requested_limit, 250)));
  request_id bigint;
begin
  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url není platný.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí.';
  end if;
  select net.http_get(
    url := app_url || '/api/power-outages/complete/reconcile?limit=' || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Outages-Reconciliation/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_company_reconciliation(integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_company_reconciliation(integer)
  to service_role;

commit;
