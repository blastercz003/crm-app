begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_municipalities') is null then
    raise exception 'Nejdříve spusťte migrace katalogu a mapování obcí ČEZ pro režim KOMPLETNÍ.';
  end if;
  if to_regprocedure('public.current_user_can_view_power_outages()') is null
    or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybí společné bezpečnostní funkce monitoringu odstávek.';
  end if;
end
$$;

-- Pilot je záměrně oddělený od produkčního skenovacího cyklu. Neukládá
-- odstávky do stagingu a nemůže měnit žádnou tabulku režimu MARKETY.
create table if not exists public.complete_power_outage_cez_town_pilot_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  requested_sample_count integer not null,
  municipality_total_count integer not null default 0,
  municipality_processed_count integer not null default 0,
  matched_count integer not null default 0,
  mismatched_count integer not null default 0,
  review_count integer not null default 0,
  error_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_town_pilot_runs_status_check
    check (status in ('running', 'succeeded', 'partial', 'failed', 'cancelled')),
  constraint cpo_cez_town_pilot_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint cpo_cez_town_pilot_runs_counts_check
    check (
      requested_sample_count between 20 and 200
      and municipality_total_count between 0 and requested_sample_count
      and municipality_processed_count between 0 and municipality_total_count
      and matched_count >= 0
      and mismatched_count >= 0
      and review_count >= 0
      and error_count >= 0
      and matched_count + mismatched_count + review_count + error_count
        <= municipality_processed_count
    ),
  constraint cpo_cez_town_pilot_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists cpo_cez_town_pilot_runs_one_running_uidx
  on public.complete_power_outage_cez_town_pilot_runs ((true))
  where status = 'running';

create index if not exists cpo_cez_town_pilot_runs_timeline_idx
  on public.complete_power_outage_cez_town_pilot_runs (started_at desc);

create table if not exists public.complete_power_outage_cez_town_pilot_cases (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.complete_power_outage_cez_town_pilot_runs(id) on delete cascade,
  municipality_code text not null
    references public.complete_power_outage_cez_municipalities(municipality_code) on delete restrict,
  municipality_name text not null,
  sample_kind text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,

  primary_address_id bigint not null,
  primary_address_code text not null,
  primary_town_part text,
  primary_street text,
  primary_sjtsk_y double precision,
  primary_sjtsk_x double precision,
  secondary_address_id bigint,
  secondary_address_code text,
  secondary_town_part text,
  secondary_street text,
  secondary_house_number text,
  secondary_orientation_number text,

  primary_outage_count integer not null default 0,
  secondary_outage_count integer not null default 0,
  primary_outage_ids jsonb not null default '[]'::jsonb,
  secondary_outage_ids jsonb not null default '[]'::jsonb,
  primary_payload_sha256 text,
  secondary_payload_sha256 text,
  outage_ids_match boolean,
  outage_payloads_match boolean,
  announcement_urls jsonb not null default '[]'::jsonb,

  public_verification_status text not null default 'pending',
  public_verification_note text,
  public_verified_at timestamptz,
  ruian_source_url text,
  ruian_source_valid_on date,
  error_code text,
  error_message text,
  lock_token uuid,
  lock_expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_town_pilot_cases_run_municipality_unique
    unique (run_id, municipality_code),
  constraint cpo_cez_town_pilot_cases_sample_kind_check
    check (sample_kind in ('active_outage', 'large_city', 'no_street', 'multiple_part_candidate', 'standard')),
  constraint cpo_cez_town_pilot_cases_status_check
    check (status in ('pending', 'running', 'matched', 'mismatched', 'needs_review', 'failed')),
  constraint cpo_cez_town_pilot_cases_finished_check
    check (
      (status = 'pending' and started_at is null and finished_at is null)
      or (status = 'running' and started_at is not null and finished_at is null)
      or (status not in ('pending', 'running') and started_at is not null and finished_at is not null)
    ),
  constraint cpo_cez_town_pilot_cases_lock_check
    check (
      (status = 'running' and lock_token is not null and lock_expires_at is not null)
      or (status <> 'running' and lock_token is null and lock_expires_at is null)
    ),
  constraint cpo_cez_town_pilot_cases_ids_check
    check (
      primary_address_id > 0
      and primary_address_code ~ '^[0-9]+$'
      and (secondary_address_id is null or secondary_address_id > 0)
      and (secondary_address_code is null or secondary_address_code ~ '^[0-9]+$')
    ),
  constraint cpo_cez_town_pilot_cases_counts_check
    check (attempt_count >= 0 and primary_outage_count >= 0 and secondary_outage_count >= 0),
  constraint cpo_cez_town_pilot_cases_payload_check
    check (
      jsonb_typeof(primary_outage_ids) = 'array'
      and jsonb_typeof(secondary_outage_ids) = 'array'
      and jsonb_typeof(announcement_urls) = 'array'
      and jsonb_typeof(metadata) = 'object'
      and (primary_payload_sha256 is null or primary_payload_sha256 ~ '^[a-f0-9]{64}$')
      and (secondary_payload_sha256 is null or secondary_payload_sha256 ~ '^[a-f0-9]{64}$')
    ),
  constraint cpo_cez_town_pilot_cases_match_check
    check (
      status not in ('matched', 'mismatched')
      or (
        secondary_address_id is not null
        and outage_ids_match is not null
        and outage_payloads_match is not null
        and (status <> 'matched' or (outage_ids_match and outage_payloads_match))
        and (status <> 'mismatched' or not (outage_ids_match and outage_payloads_match))
      )
    ),
  constraint cpo_cez_town_pilot_cases_public_check
    check (
      public_verification_status in ('pending', 'verified', 'mismatched', 'not_available')
      and (public_verification_status = 'pending' or public_verified_at is not null)
    )
);

create index if not exists cpo_cez_town_pilot_cases_queue_idx
  on public.complete_power_outage_cez_town_pilot_cases (run_id, status, municipality_code);

create index if not exists cpo_cez_town_pilot_cases_result_idx
  on public.complete_power_outage_cez_town_pilot_cases (status, sample_kind, finished_at desc);

drop trigger if exists cpo_cez_town_pilot_runs_set_updated_at
  on public.complete_power_outage_cez_town_pilot_runs;
create trigger cpo_cez_town_pilot_runs_set_updated_at
before update on public.complete_power_outage_cez_town_pilot_runs
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_cez_town_pilot_cases_set_updated_at
  on public.complete_power_outage_cez_town_pilot_cases;
create trigger cpo_cez_town_pilot_cases_set_updated_at
before update on public.complete_power_outage_cez_town_pilot_cases
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_town_pilot_runs enable row level security;
alter table public.complete_power_outage_cez_town_pilot_cases enable row level security;

drop policy if exists cpo_cez_town_pilot_runs_authorized_read
  on public.complete_power_outage_cez_town_pilot_runs;
create policy cpo_cez_town_pilot_runs_authorized_read
  on public.complete_power_outage_cez_town_pilot_runs
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_town_pilot_cases_authorized_read
  on public.complete_power_outage_cez_town_pilot_cases;
create policy cpo_cez_town_pilot_cases_authorized_read
  on public.complete_power_outage_cez_town_pilot_cases
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_town_pilot_runs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_cez_town_pilot_cases
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_town_pilot_runs to authenticated;
grant select on table public.complete_power_outage_cez_town_pilot_cases to authenticated;
grant all on table public.complete_power_outage_cez_town_pilot_runs to service_role;
grant all on table public.complete_power_outage_cez_town_pilot_cases to service_role;

create or replace function public.claim_complete_power_outage_cez_town_pilot_batch(
  requested_sample_count integer default 120,
  requested_limit integer default 3
)
returns table (
  run_id uuid,
  case_id uuid,
  municipality_code text,
  municipality_name text,
  sample_kind text,
  primary_address_id bigint,
  primary_address_code text,
  primary_town_part text,
  primary_street text,
  primary_sjtsk_y double precision,
  primary_sjtsk_x double precision,
  lock_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_sample_count integer := least(200, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(4, greatest(1, coalesce(requested_limit, 3)));
  active_run public.complete_power_outage_cez_town_pilot_runs%rowtype;
  batch_token uuid := gen_random_uuid();
  inserted_count integer;
begin
  update public.complete_power_outage_cez_town_pilot_cases pilot_case
  set status = 'failed',
      finished_at = now(),
      lock_token = null,
      lock_expires_at = null,
      error_code = 'CEZ_TOWN_PILOT_LOCK_EXPIRED',
      error_message = 'Předchozí pilotní kontrola obce nebyla dokončena v bezpečnostním limitu.'
  where pilot_case.status = 'running'
    and pilot_case.lock_expires_at <= now();

  select * into active_run
  from public.complete_power_outage_cez_town_pilot_runs pilot_run
  where pilot_run.status = 'running'
  order by pilot_run.started_at desc
  limit 1
  for update;

  if not found then
    insert into public.complete_power_outage_cez_town_pilot_runs (
      status,
      requested_sample_count,
      metadata
    ) values (
      'running',
      safe_sample_count,
      jsonb_build_object(
        'contract', 'complete-cez-town-pilot-v1',
        'comparison', 'two-ruian-addresses-outages-in-town'
      )
    ) returning * into active_run;

    with classified as (
      select
        municipality.*,
        case
          when municipality.latest_outage_count > 0 then 'active_outage'
          when municipality.municipality_name in (
            'Praha', 'Brno', 'Ostrava', 'Plzeň', 'Liberec', 'Olomouc',
            'České Budějovice', 'Hradec Králové', 'Pardubice', 'Zlín',
            'Jihlava', 'Karlovy Vary', 'Ústí nad Labem'
          ) then 'large_city'
          when municipality.representative_street is null then 'no_street'
          when nullif(municipality.metadata #>> '{ruianAddressImport,townPart}', '') is not null
            and lower(btrim(municipality.metadata #>> '{ruianAddressImport,townPart}'))
              <> lower(btrim(municipality.municipality_name))
            then 'multiple_part_candidate'
          else 'standard'
        end as pilot_sample_kind
      from public.complete_power_outage_cez_municipalities municipality
      where municipality.is_active
        and municipality.representative_status = 'resolved'
        and municipality.mapping_status = 'resolved'
        and municipality.distribution_status = 'cez'
        and municipality.cez_address_id is not null
        and municipality.representative_address_code is not null
        and not exists (
          select 1
          from public.complete_power_outage_cez_town_pilot_cases previous_case
          where previous_case.municipality_code = municipality.municipality_code
            and previous_case.status = 'matched'
            and previous_case.finished_at >= now() - interval '90 days'
        )
    ), ranked as (
      select
        classified.*,
        row_number() over (
          partition by classified.pilot_sample_kind
          order by pg_catalog.hashtextextended(classified.municipality_code, 20260904)
        ) as kind_rank
      from classified
    ), selected as (
      select *
      from ranked
      order by kind_rank, pilot_sample_kind, municipality_code
      limit safe_sample_count
    )
    insert into public.complete_power_outage_cez_town_pilot_cases (
      run_id,
      municipality_code,
      municipality_name,
      sample_kind,
      primary_address_id,
      primary_address_code,
      primary_town_part,
      primary_street,
      primary_sjtsk_y,
      primary_sjtsk_x
    )
    select
      active_run.id,
      selected.municipality_code,
      selected.municipality_name,
      selected.pilot_sample_kind,
      selected.cez_address_id,
      selected.representative_address_code,
      nullif(selected.metadata #>> '{ruianAddressImport,townPart}', ''),
      selected.representative_street,
      selected.representative_sjtsk_y,
      selected.representative_sjtsk_x
    from selected;

    get diagnostics inserted_count = row_count;
    if inserted_count = 0 then
      update public.complete_power_outage_cez_town_pilot_runs
      set status = 'failed',
          finished_at = now(),
          error_code = 'CEZ_TOWN_PILOT_NO_CANDIDATES',
          error_message = 'Pro pilot nejsou dostupné žádné zmapované obce ČEZ.'
      where id = active_run.id;
      return;
    end if;

    update public.complete_power_outage_cez_town_pilot_runs
    set municipality_total_count = inserted_count
    where id = active_run.id
    returning * into active_run;
  end if;

  return query
  with candidates as (
    select pilot_case.id
    from public.complete_power_outage_cez_town_pilot_cases pilot_case
    where pilot_case.run_id = active_run.id
      and pilot_case.status = 'pending'
    order by
      case pilot_case.sample_kind
        when 'active_outage' then 0
        when 'large_city' then 1
        when 'multiple_part_candidate' then 2
        when 'no_street' then 3
        else 4
      end,
      pilot_case.municipality_code
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_cez_town_pilot_cases pilot_case
    set status = 'running',
        attempt_count = pilot_case.attempt_count + 1,
        started_at = now(),
        finished_at = null,
        lock_token = batch_token,
        lock_expires_at = now() + interval '10 minutes',
        error_code = null,
        error_message = null
    from candidates
    where pilot_case.id = candidates.id
    returning pilot_case.*
  )
  select
    active_run.id,
    claimed.id,
    claimed.municipality_code,
    claimed.municipality_name,
    claimed.sample_kind,
    claimed.primary_address_id,
    claimed.primary_address_code,
    claimed.primary_town_part,
    claimed.primary_street,
    claimed.primary_sjtsk_y,
    claimed.primary_sjtsk_x,
    claimed.lock_token
  from claimed
  order by claimed.municipality_code;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_town_pilot_batch(integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_town_pilot_batch(integer, integer)
  to service_role;

create or replace function public.finish_complete_power_outage_cez_town_pilot_run(
  requested_run_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.complete_power_outage_cez_town_pilot_runs%rowtype;
  v_processed_count integer;
  v_matched_count integer;
  v_mismatched_count integer;
  v_review_count integer;
  v_error_count integer;
  final_status text;
begin
  select * into run_row
  from public.complete_power_outage_cez_town_pilot_runs pilot_run
  where pilot_run.id = requested_run_id
  for update;

  if not found then
    raise exception 'Pilotní běh ČEZ neexistuje.';
  end if;
  if run_row.status <> 'running' then
    return run_row.status;
  end if;

  select
    count(*) filter (where pilot_case.status not in ('pending', 'running'))::integer,
    count(*) filter (where pilot_case.status = 'matched')::integer,
    count(*) filter (where pilot_case.status = 'mismatched')::integer,
    count(*) filter (where pilot_case.status = 'needs_review')::integer,
    count(*) filter (where pilot_case.status = 'failed')::integer
  into v_processed_count, v_matched_count, v_mismatched_count, v_review_count, v_error_count
  from public.complete_power_outage_cez_town_pilot_cases pilot_case
  where pilot_case.run_id = requested_run_id;

  update public.complete_power_outage_cez_town_pilot_runs
  set municipality_processed_count = v_processed_count,
      matched_count = v_matched_count,
      mismatched_count = v_mismatched_count,
      review_count = v_review_count,
      error_count = v_error_count
  where id = requested_run_id;

  if v_processed_count < run_row.municipality_total_count then
    return 'running';
  end if;

  final_status := case
    when v_error_count = run_row.municipality_total_count then 'failed'
    when v_mismatched_count = 0 and v_review_count = 0 and v_error_count = 0 then 'succeeded'
    else 'partial'
  end;

  update public.complete_power_outage_cez_town_pilot_runs
  set status = final_status,
      finished_at = now(),
      error_code = case
        when v_mismatched_count > 0 then 'CEZ_TOWN_PILOT_MISMATCH'
        when v_review_count > 0 then 'CEZ_TOWN_PILOT_REVIEW_REQUIRED'
        when v_error_count > 0 then 'CEZ_TOWN_PILOT_ERRORS'
        else null
      end,
      error_message = case
        when v_mismatched_count > 0 then v_mismatched_count::text || ' obcí vrátilo rozdílný městský seznam odstávek.'
        when v_review_count > 0 then v_review_count::text || ' obcí vyžaduje ruční kontrolu.'
        when v_error_count > 0 then v_error_count::text || ' obcí nebylo možné ověřit.'
        else null
      end
  where id = requested_run_id;

  return final_status;
end;
$$;

revoke all on function public.finish_complete_power_outage_cez_town_pilot_run(uuid)
  from public, anon, authenticated;
grant execute on function public.finish_complete_power_outage_cez_town_pilot_run(uuid)
  to service_role;

create or replace function public.request_complete_power_outage_cez_town_pilot(
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
  safe_sample_count integer := least(200, greatest(20, coalesce(requested_sample_count, 120)));
  safe_limit integer := least(4, greatest(1, coalesce(requested_limit, 3)));
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
    url := app_url
      || '/api/power-outages/complete/cez/pilot?sample='
      || safe_sample_count::text
      || '&limit='
      || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-CEZ-Town-Pilot/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_cez_town_pilot(integer, integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_cez_town_pilot(integer, integer)
  to service_role;

commit;

-- Ověřovací výstup po spuštění migrace v Supabase SQL Editoru.
select 'FUNCTION' as check_type,
  'claim complete CEZ town pilot batch' as object_name,
  to_regprocedure('public.claim_complete_power_outage_cez_town_pilot_batch(integer,integer)') is not null as is_correct
union all
select 'FUNCTION', 'finish complete CEZ town pilot run',
  to_regprocedure('public.finish_complete_power_outage_cez_town_pilot_run(uuid)') is not null
union all
select 'FUNCTION', 'request complete CEZ town pilot',
  to_regprocedure('public.request_complete_power_outage_cez_town_pilot(integer,integer)') is not null
union all
select 'ISOLATION', 'pilot functions do not use MARKET tables',
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'claim_complete_power_outage_cez_town_pilot_batch',
        'finish_complete_power_outage_cez_town_pilot_run',
        'request_complete_power_outage_cez_town_pilot'
      )
      and lower(pg_get_functiondef(procedure.oid)) ~ '(from|join|update|into)[[:space:]]+public\.(stores|power_outages|power_outage_addresses)([^a-z_]|$)'
  )
union all
select 'RLS', 'complete CEZ town pilot cases',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.complete_power_outage_cez_town_pilot_cases'::regclass
  ), false)
union all
select 'RLS', 'complete CEZ town pilot runs',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.complete_power_outage_cez_town_pilot_runs'::regclass
  ), false)
union all
select 'SAFETY', 'no automatic complete CEZ town pilot cron exists',
  not exists (
    select 1 from cron.job
    where jobname ilike '%cez%pilot%'
  )
union all
select 'TABLE', 'complete_power_outage_cez_town_pilot_cases',
  to_regclass('public.complete_power_outage_cez_town_pilot_cases') is not null
union all
select 'TABLE', 'complete_power_outage_cez_town_pilot_runs',
  to_regclass('public.complete_power_outage_cez_town_pilot_runs') is not null;
