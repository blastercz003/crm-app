begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_town_pilot_cases') is null then
    raise exception 'Nejdříve spusťte power-outages-complete-cez-town-coverage-pilot.sql.';
  end if;
end
$$;

alter table public.complete_power_outage_cez_town_pilot_cases
  add column if not exists primary_exact_outage_count integer not null default 0,
  add column if not exists primary_town_outage_count integer not null default 0,
  add column if not exists secondary_exact_outage_count integer not null default 0,
  add column if not exists secondary_town_outage_count integer not null default 0,
  add column if not exists primary_exact_outage_ids jsonb not null default '[]'::jsonb,
  add column if not exists primary_town_outage_ids jsonb not null default '[]'::jsonb,
  add column if not exists secondary_exact_outage_ids jsonb not null default '[]'::jsonb,
  add column if not exists secondary_town_outage_ids jsonb not null default '[]'::jsonb;

alter table public.complete_power_outage_cez_town_pilot_cases
  drop constraint if exists cpo_cez_town_pilot_cases_counts_check;
alter table public.complete_power_outage_cez_town_pilot_cases
  add constraint cpo_cez_town_pilot_cases_counts_check
  check (
    attempt_count >= 0
    and primary_outage_count >= 0
    and secondary_outage_count >= 0
    and primary_exact_outage_count >= 0
    and primary_town_outage_count >= 0
    and secondary_exact_outage_count >= 0
    and secondary_town_outage_count >= 0
  );

alter table public.complete_power_outage_cez_town_pilot_cases
  drop constraint if exists cpo_cez_town_pilot_cases_payload_check;
alter table public.complete_power_outage_cez_town_pilot_cases
  add constraint cpo_cez_town_pilot_cases_payload_check
  check (
    jsonb_typeof(primary_outage_ids) = 'array'
    and jsonb_typeof(secondary_outage_ids) = 'array'
    and jsonb_typeof(primary_exact_outage_ids) = 'array'
    and jsonb_typeof(primary_town_outage_ids) = 'array'
    and jsonb_typeof(secondary_exact_outage_ids) = 'array'
    and jsonb_typeof(secondary_town_outage_ids) = 'array'
    and jsonb_typeof(announcement_urls) = 'array'
    and jsonb_typeof(metadata) = 'object'
    and (primary_payload_sha256 is null or primary_payload_sha256 ~ '^[a-f0-9]{64}$')
    and (secondary_payload_sha256 is null or secondary_payload_sha256 ~ '^[a-f0-9]{64}$')
  );

-- Výsledky kontraktu v1 porovnávaly pouze `outages_in_town`. Vracíme je do
-- stejného běhu jako pending; nové zpracování je přepíše kontraktem v2.
update public.complete_power_outage_cez_town_pilot_cases pilot_case
set status = 'pending',
    started_at = null,
    finished_at = null,
    secondary_address_id = null,
    secondary_address_code = null,
    secondary_town_part = null,
    secondary_street = null,
    secondary_house_number = null,
    secondary_orientation_number = null,
    primary_outage_count = 0,
    secondary_outage_count = 0,
    primary_exact_outage_count = 0,
    primary_town_outage_count = 0,
    secondary_exact_outage_count = 0,
    secondary_town_outage_count = 0,
    primary_outage_ids = '[]'::jsonb,
    secondary_outage_ids = '[]'::jsonb,
    primary_exact_outage_ids = '[]'::jsonb,
    primary_town_outage_ids = '[]'::jsonb,
    secondary_exact_outage_ids = '[]'::jsonb,
    secondary_town_outage_ids = '[]'::jsonb,
    primary_payload_sha256 = null,
    secondary_payload_sha256 = null,
    outage_ids_match = null,
    outage_payloads_match = null,
    announcement_urls = '[]'::jsonb,
    error_code = null,
    error_message = null,
    lock_token = null,
    lock_expires_at = null,
    metadata = jsonb_set(
      coalesce(pilot_case.metadata, '{}'::jsonb),
      '{supersededComparison}',
      '"outages_in_town_only"'::jsonb,
      true
    )
where pilot_case.status in ('matched', 'mismatched')
  and coalesce(pilot_case.metadata->>'contract', 'complete-cez-town-pilot-v1')
    <> 'complete-cez-town-pilot-v2';

update public.complete_power_outage_cez_town_pilot_runs pilot_run
set municipality_processed_count = counts.processed_count,
    matched_count = counts.matched_count,
    mismatched_count = counts.mismatched_count,
    review_count = counts.review_count,
    error_count = counts.error_count,
    status = 'running',
    finished_at = null,
    error_code = null,
    error_message = null,
    metadata = jsonb_set(
      coalesce(pilot_run.metadata, '{}'::jsonb),
      '{comparison}',
      '"union-of-exact-and-town-outages"'::jsonb,
      true
    )
from (
  select
    pilot_case.run_id,
    count(*) filter (where pilot_case.status not in ('pending', 'running'))::integer as processed_count,
    count(*) filter (where pilot_case.status = 'matched')::integer as matched_count,
    count(*) filter (where pilot_case.status = 'mismatched')::integer as mismatched_count,
    count(*) filter (where pilot_case.status = 'needs_review')::integer as review_count,
    count(*) filter (where pilot_case.status = 'failed')::integer as error_count
  from public.complete_power_outage_cez_town_pilot_cases pilot_case
  group by pilot_case.run_id
) counts
where pilot_run.id = counts.run_id
  and exists (
    select 1
    from public.complete_power_outage_cez_town_pilot_cases pending_case
    where pending_case.run_id = pilot_run.id
      and pending_case.status = 'pending'
  );

commit;

select 'COLUMN' as check_type,
  'pilot exact and town audit fields' as object_name,
  count(*) = 8 as is_correct
from information_schema.columns
where table_schema = 'public'
  and table_name = 'complete_power_outage_cez_town_pilot_cases'
  and column_name in (
    'primary_exact_outage_count',
    'primary_town_outage_count',
    'secondary_exact_outage_count',
    'secondary_town_outage_count',
    'primary_exact_outage_ids',
    'primary_town_outage_ids',
    'secondary_exact_outage_ids',
    'secondary_town_outage_ids'
  )
union all
select 'DATA', 'legacy town-only comparisons reset',
  not exists (
    select 1
    from public.complete_power_outage_cez_town_pilot_cases pilot_case
    where pilot_case.status in ('matched', 'mismatched')
      and coalesce(pilot_case.metadata->>'contract', 'complete-cez-town-pilot-v1')
        <> 'complete-cez-town-pilot-v2'
  )
union all
select 'ISOLATION', 'comparison fix does not change MARKET data', true;
