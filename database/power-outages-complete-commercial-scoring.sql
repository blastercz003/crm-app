begin;

do $$
begin
  if to_regclass('public.complete_power_outage_company_scores') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_companies') is null then
    raise exception 'Chybí základ bezpečného obchodního skórování KOMPLETNÍ.';
  end if;
end
$$;

alter table public.complete_power_outage_commercial_selection_state
  add column if not exists scoring_last_success_at timestamptz,
  add column if not exists scoring_last_processed_count integer not null default 0,
  add column if not exists scoring_consecutive_failure_count integer not null default 0,
  add column if not exists scoring_last_error_code text,
  add column if not exists scoring_last_error_message text;

create or replace function public.complete_power_outage_industry_points(requested_nace_codes text[])
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when exists (
      select 1 from unnest(coalesce(requested_nace_codes, array[]::text[])) code
      where code like any (array[
        '10%', '11%', '21%', '24%', '25%', '26%', '27%', '28%', '29%',
        '30%', '32%', '36%', '37%', '38%', '52%', '61%', '6311%', '86%', '87%'
      ])
    ) then 70
    when exists (
      select 1 from unnest(coalesce(requested_nace_codes, array[]::text[])) code
      where code like any (array[
        '01%', '03%', '13%', '14%', '15%', '16%', '17%', '18%', '19%', '20%',
        '22%', '23%', '31%', '33%', '35%', '39%', '45%', '46%', '47%', '49%',
        '50%', '51%', '53%', '55%', '56%', '62%', '63%', '72%', '75%', '88%'
      ])
    ) then 55
    when exists (
      select 1 from unnest(coalesce(requested_nace_codes, array[]::text[])) code
      where code like any (array[
        '41%', '42%', '43%', '58%', '59%', '60%', '68%', '69%', '71%', '74%',
        '77%', '78%', '79%', '80%', '81%', '82%', '85%', '90%', '91%', '93%',
        '95%', '96%'
      ])
    ) then 35
    else 15
  end;
$$;

create or replace function public.complete_power_outage_is_natural_person_form(requested_legal_form text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(btrim(requested_legal_form), '') = any (
    array['100','101','102','103','104','105','106','107','108','424','425']
  );
$$;

create or replace function public.complete_power_outage_normalize_nace_code(requested_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when regexp_replace(coalesce(requested_code, ''), '[^0-9]', '', 'g') ~ '^[0-9]{2,6}$'
      then regexp_replace(requested_code, '[^0-9]', '', 'g')
    else null
  end;
$$;

create or replace view public.complete_power_outage_company_score_inputs
with (security_invoker = true)
as
with registered_office_counts as (
  select company.outage_address_id, count(*)::integer as registered_office_count
  from public.complete_power_outage_companies company
  where company.entity_kind in ('registered_office', 'mixed')
    and company.candidate_status <> 'stale'
  group by company.outage_address_id
), source_rows as (
  select
    company.id as candidate_id,
    profile.id as company_profile_id,
    company.ico,
    coalesce(profile.legal_form, company.legal_form) as legal_form,
    case when cardinality(coalesce(profile.nace_codes, array[]::text[])) > 0
      then profile.nace_codes
      else array(
        select distinct normalized_code
        from unnest(coalesce(company.nace_codes, array[]::text[])) as raw_codes(raw_code)
        cross join lateral (
          select public.complete_power_outage_normalize_nace_code(raw_code) as normalized_code
        ) normalized
        where normalized_code is not null
        order by normalized_code
      )
    end as nace_codes,
    coalesce(
      profile.primary_nace_code,
      profile.nace_codes[1],
      (
        select public.complete_power_outage_normalize_nace_code(raw_code)
        from unnest(coalesce(company.nace_codes, array[]::text[])) with ordinality as raw_codes(raw_code, code_order)
        where public.complete_power_outage_normalize_nace_code(raw_code) is not null
        order by code_order
        limit 1
      )
    ) as primary_nace_code,
    company.entity_kind,
    company.metadata as company_metadata,
    address.address_scope,
    address.street,
    address.house_number,
    address.orientation_number,
    outage.starts_at,
    outage.ends_at,
    coalesce(office_count.registered_office_count, 0) as registered_office_count,
    coalesce(profile.is_in_liquidation, false) as is_in_liquidation,
    coalesce(profile.is_terminated, false) as is_terminated,
    profile.payload_sha256 as profile_payload_sha256,
    profile.fetched_at as profile_fetched_at,
    enrichment.queue_status as enrichment_status
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_profiles profile on profile.ico = company.ico
  left join public.complete_power_outage_company_enrichment_queue enrichment on enrichment.ico = company.ico
  left join registered_office_counts office_count on office_count.outage_address_id = company.outage_address_id
  where company.candidate_status <> 'stale'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
), normalized as (
  select source_rows.*,
    public.complete_power_outage_industry_points(source_rows.nace_codes) as industry_points,
    case
      when extract(epoch from (ends_at - starts_at)) >= 8 * 3600 then 15
      when extract(epoch from (ends_at - starts_at)) >= 6 * 3600 then 12
      when extract(epoch from (ends_at - starts_at)) >= 4 * 3600 then 9
      when extract(epoch from (ends_at - starts_at)) >= 3 * 3600 then 6
      else 0
    end
    + case
      when starts_at >= now() + interval '21 days' then 10
      when starts_at >= now() + interval '14 days' then 8
      when starts_at >= now() + interval '7 days' then 5
      when starts_at >= now() + interval '3 days' then 2
      else 0
    end as outage_points,
    case when entity_kind in ('establishment', 'mixed') then 5 else 0 end as establishment_points,
    coalesce(
      registered_office_count >= 20
      or company_metadata #>> '{evaluation,massRegisteredOffice}' = 'true'
      or company_metadata #>> '{evaluation,virtualOffice}' = 'true',
      false
    ) as mass_or_virtual_office,
    coalesce(
      public.complete_power_outage_is_natural_person_form(legal_form)
      and entity_kind = 'registered_office',
      false
    ) as natural_person_office_only,
    coalesce(address_scope <> 'exact', true) as incomplete_address,
    coalesce(company_metadata #>> '{evaluation,nameConflict}' = 'true', false) as provider_conflict,
    coalesce(extract(epoch from (ends_at - starts_at)) < 3 * 3600, false) as short_outage,
    coalesce(starts_at < now() + interval '3 days', false) as insufficient_notice
  from source_rows
), calculated as (
  select normalized.*,
    least(100, case when mass_or_virtual_office then 25 else 0 end
      + case when natural_person_office_only then 40 else 0 end
      + case when incomplete_address then 20 else 0 end
      + case when provider_conflict then 20 else 0 end
      + case when is_in_liquidation then 50 else 0 end
      + case when is_terminated then 100 else 0 end
      + case when short_outage then 20 else 0 end
      + case when insufficient_notice then 15 else 0 end
    )::integer as penalty_points,
    array_remove(array[
      case when industry_points = 70 then 'high_operational_dependency' end,
      case when industry_points = 55 then 'medium_operational_dependency' end,
      case when entity_kind in ('establishment', 'mixed') then 'establishment_evidence' end,
      case when extract(epoch from (ends_at - starts_at)) >= 8 * 3600 then 'long_outage' end,
      case when starts_at >= now() + interval '14 days' then 'sufficient_notice' end
    ], null)::text[] as reason_codes,
    array_remove(array[
      case when mass_or_virtual_office then 'mass_or_virtual_registered_office' end,
      case when natural_person_office_only then 'natural_person_registered_office_only' end,
      case when incomplete_address then 'incomplete_address' end,
      case when provider_conflict then 'provider_conflict' end,
      case when is_in_liquidation then 'company_in_liquidation' end,
      case when is_terminated then 'terminated_company' end,
      case when short_outage then 'outage_shorter_than_three_hours' end,
      case when insufficient_notice then 'insufficient_notice_under_three_days' end
    ], null)::text[] as penalty_codes
  from normalized
)
select
  calculated.*,
  greatest(0, least(100,
    industry_points + outage_points + establishment_points - penalty_points
  ))::integer as score,
  case
    when greatest(0, least(100, industry_points + outage_points + establishment_points - penalty_points)) >= 75 then 'A'
    when greatest(0, least(100, industry_points + outage_points + establishment_points - penalty_points)) >= 50 then 'B'
    else 'C'
  end as grade,
  case when company_profile_id is not null or enrichment_status = 'not_found'
    then 'complete' else 'preliminary' end as data_completeness,
  encode(digest(concat_ws('|',
    coalesce(ico, ''), coalesce(legal_form, ''), array_to_string(nace_codes, ','),
    entity_kind, address_scope, starts_at::text, ends_at::text,
    registered_office_count::text, is_in_liquidation::text, is_terminated::text,
    coalesce(profile_payload_sha256, ''), current_date::text,
    mass_or_virtual_office::text, natural_person_office_only::text,
    incomplete_address::text, provider_conflict::text
  ), 'sha256'), 'hex') as calculation_input_hash
from calculated;

create or replace function public.refresh_complete_power_outage_company_scores(requested_limit integer default 1000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(5000, greatest(1, coalesce(requested_limit, 1000)));
  current_version integer;
  updated_count integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('complete_power_outage_company_scoring_v1')) then
    return jsonb_build_object('status', 'busy', 'processedCount', 0);
  end if;

  select scoring_version into current_version
  from public.complete_power_outage_commercial_selection_state
  where singleton and scoring_enabled;
  if not found then
    return jsonb_build_object('status', 'disabled', 'processedCount', 0);
  end if;

  insert into public.complete_power_outage_company_scores (
    candidate_id, company_profile_id, score_status, data_completeness, scoring_version
  )
  select input.candidate_id, input.company_profile_id, 'pending', input.data_completeness, current_version
  from public.complete_power_outage_company_score_inputs input
  on conflict (candidate_id) do nothing;

  with selected as materialized (
    select input.*
    from public.complete_power_outage_company_score_inputs input
    join public.complete_power_outage_company_scores score_row on score_row.candidate_id = input.candidate_id
    where score_row.score_status in ('pending', 'stale', 'error')
      or score_row.scoring_version <> current_version
      or score_row.calculation_input_hash is distinct from input.calculation_input_hash
      or score_row.next_recalculation_at <= now()
    order by
      case score_row.score_status when 'error' then 0 when 'stale' then 1 when 'pending' then 2 else 3 end,
      score_row.next_recalculation_at nulls first,
      input.candidate_id
    limit safe_limit
  )
  update public.complete_power_outage_company_scores score_row
  set company_profile_id = selected.company_profile_id,
      score_status = case when selected.data_completeness = 'complete' then 'complete' else 'preliminary' end,
      score = selected.score,
      grade = selected.grade,
      selection_eligible = coalesce(
        selected.score >= 50
        and not selected.is_terminated
        and not selected.is_in_liquidation
        and not selected.natural_person_office_only
        and not selected.mass_or_virtual_office,
        false
      ),
      data_completeness = selected.data_completeness,
      industry_points = selected.industry_points,
      outage_points = selected.outage_points,
      establishment_points = selected.establishment_points,
      penalty_points = selected.penalty_points,
      primary_nace_code = selected.primary_nace_code,
      reason_codes = selected.reason_codes,
      penalty_codes = selected.penalty_codes,
      breakdown = jsonb_build_object(
        'contract', 'complete-commercial-score-v1',
        'industryPoints', selected.industry_points,
        'outagePoints', selected.outage_points,
        'establishmentPoints', selected.establishment_points,
        'penaltyPoints', selected.penalty_points,
        'outageDurationHours', round((extract(epoch from (selected.ends_at - selected.starts_at)) / 3600)::numeric, 2),
        'noticeDays', round((extract(epoch from (selected.starts_at - now())) / 86400)::numeric, 2),
        'registeredOfficeCount', selected.registered_office_count,
        'excludedInputs', jsonb_build_array(
          'repeat_outages', 'distance', 'transport_economics', 'contact_history',
          'client_relationship', 'company_age', 'last_change', 'institutional_sector',
          'employee_count'
        )
      ),
      scoring_version = current_version,
      calculation_input_hash = selected.calculation_input_hash,
      calculated_at = now(),
      next_recalculation_at = date_trunc('day', now()) + interval '1 day 5 minutes',
      last_error_code = null,
      last_error_message = null
  from selected
  where score_row.candidate_id = selected.candidate_id;
  get diagnostics updated_count = row_count;

  update public.complete_power_outage_commercial_selection_state
  set last_scoring_activity_at = now(),
      scoring_last_success_at = now(),
      scoring_last_processed_count = updated_count,
      scoring_consecutive_failure_count = 0,
      scoring_last_error_code = null,
      scoring_last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'lastScoringProcessedCount', updated_count,
        'lastScoringVersion', current_version,
        'lastScoringStatus', 'succeeded'
      )
  where singleton;

  return jsonb_build_object('status', 'succeeded', 'processedCount', updated_count, 'scoringVersion', current_version);
exception when others then
  update public.complete_power_outage_commercial_selection_state
  set last_scoring_activity_at = now(),
      scoring_last_processed_count = 0,
      scoring_consecutive_failure_count = scoring_consecutive_failure_count + 1,
      scoring_last_error_code = 'COMPLETE_COMMERCIAL_SCORING_FAILED',
      scoring_last_error_message = left(sqlerrm, 2000),
      metadata = metadata || jsonb_build_object('lastScoringStatus', 'failed')
  where singleton;
  raise;
end;
$$;

create or replace function public.pause_complete_power_outage_company_scoring()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.complete_power_outage_commercial_selection_state
  set scoring_enabled = false,
      metadata = metadata || jsonb_build_object('scoringPausedAt', now())
  where singleton and scoring_enabled;
  return found;
end;
$$;

create or replace view public.complete_power_outage_company_scoring_overview
with (security_invoker = true)
as
with current_candidates as (
  select company.id as candidate_id
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where company.candidate_status <> 'stale'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
)
select
  state_row.scoring_enabled,
  state_row.ui_enabled,
  state_row.scoring_version,
  count(current_candidate.candidate_id)::bigint as current_candidate_count,
  count(score_row.candidate_id)::bigint as represented_count,
  count(*) filter (where score_row.score_status = 'pending')::bigint as pending_count,
  count(*) filter (where score_row.score_status = 'preliminary')::bigint as preliminary_count,
  count(*) filter (where score_row.score_status = 'complete')::bigint as complete_count,
  count(*) filter (where score_row.score_status in ('stale', 'error'))::bigint as attention_count,
  count(*) filter (where score_row.grade = 'A')::bigint as grade_a_count,
  count(*) filter (where score_row.grade = 'B')::bigint as grade_b_count,
  count(*) filter (where score_row.grade = 'C')::bigint as grade_c_count,
  state_row.last_scoring_activity_at,
  state_row.scoring_last_success_at,
  state_row.scoring_last_processed_count,
  state_row.scoring_consecutive_failure_count,
  state_row.scoring_last_error_code,
  state_row.scoring_last_error_message
from public.complete_power_outage_commercial_selection_state state_row
left join current_candidates current_candidate on true
left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = current_candidate.candidate_id
where state_row.singleton
group by state_row.scoring_enabled, state_row.ui_enabled, state_row.scoring_version,
  state_row.last_scoring_activity_at, state_row.scoring_last_success_at,
  state_row.scoring_last_processed_count, state_row.scoring_consecutive_failure_count,
  state_row.scoring_last_error_code, state_row.scoring_last_error_message;

revoke all on function public.complete_power_outage_industry_points(text[]) from public, anon, authenticated;
revoke all on function public.complete_power_outage_is_natural_person_form(text) from public, anon, authenticated;
revoke all on function public.complete_power_outage_normalize_nace_code(text) from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_company_scores(integer) from public, anon, authenticated;
revoke all on function public.pause_complete_power_outage_company_scoring() from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_company_scores(integer) to service_role;
grant execute on function public.pause_complete_power_outage_company_scoring() to service_role;

revoke all on table public.complete_power_outage_company_score_inputs from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_scoring_overview from public, anon, authenticated;
grant select on table public.complete_power_outage_company_scoring_overview to authenticated, service_role;

update public.complete_power_outage_commercial_selection_state
set scoring_enabled = true,
    scoring_version = greatest(scoring_version, 1),
    metadata = metadata || jsonb_build_object(
      'scoringActivatedAt', now(),
      'scoringContract', 'complete-commercial-score-v1',
      'uiSelectionEnabled', false
    )
where singleton;

select public.refresh_complete_power_outage_company_scores(1000);

do $$
declare existing_job bigint;
begin
  if to_regnamespace('cron') is null then
    raise exception 'Rozšíření pg_cron není dostupné.';
  end if;
  for existing_job in select jobid from cron.job where jobname = 'complete-power-outage-commercial-scoring-v1' loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'complete-power-outage-commercial-scoring-v1',
    '* * * * *',
    'select public.refresh_complete_power_outage_company_scores(1000);'
  );
end
$$;

notify pgrst, 'reload schema';
commit;
