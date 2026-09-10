begin;

-- Prvni experimentální TOP VYBER bezi pouze ve stinu. Nemeni bezne skore,
-- znamky A/B/C, candidate_status ani soucasny filtr v UI.
do $$
begin
  if to_regclass('public.complete_power_outage_top_selection_state') is null
     or to_regclass('public.complete_power_outage_company_top_selections') is null
     or to_regclass('public.complete_power_outage_company_score_inputs') is null
     or to_regclass('public.complete_power_outage_company_evidence') is null
     or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybi zaklad pro stinovy TOP VYBER v1.';
  end if;
end
$$;

create or replace function public.complete_power_outage_top_primary_nace_allowed(
  requested_code text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(regexp_replace(requested_code, '[^0-9]', '', 'g'), '') like any (array[
    -- Vyroba, zpracovani a provozy s technologickou zavislosti.
    '10%', '11%', '13%', '14%', '15%', '16%', '17%', '18%',
    '20%', '21%', '22%', '23%', '24%', '25%', '26%', '27%',
    '28%', '29%', '30%', '31%', '32%',
    -- Infrastruktura, voda, odpady a stavebni provozy. Skupina 43 zustava
    -- v prvnim stinovem vzorku; zjevne nevhodne specializace hlida nazev.
    '36%', '37%', '38%', '41%', '42%', '43%',
    -- Cileny velkoobchod chemikalii, skladovani a kriticka IT/telekom data.
    '4675%', '5210%', '6110%', '6120%', '6130%', '6190%', '6311%',
    -- Nemocnicni provozy.
    '8610%'
  ]);
$$;

create or replace function public.complete_power_outage_top_noncommercial_name(
  requested_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(requested_name, '')) ~
    '(^|[^[:alnum:]])(sh[[:space:]]*čms|sbor[[:space:]]+dobrovolných[[:space:]]+hasičů|sdh|mysliveck(é|e|ý|y)|honební|honebni|spolek|z[.]s[.])([^[:alnum:]]|$)';
$$;

create or replace function public.complete_power_outage_top_low_fit_name(
  requested_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(coalesce(requested_name, '')) ~
    '(pohřební[[:space:]]+služba|pohrebni[[:space:]]+sluzba|zahrad(y|a|nictví|nictvi)|závlah|zavlah|výškové[[:space:]]+práce|vyskove[[:space:]]+prace|party[[:space:]-]*stany|pneuservis)';
$$;

create or replace view public.complete_power_outage_top_selection_inputs
with (security_invoker = true)
as
with base as (
  select
    company.id as candidate_id,
    company.company_name,
    company.entity_kind,
    company.metadata as company_metadata,
    score_row.score,
    score_row.grade,
    score_row.score_status,
    score_input.primary_nace_code,
    score_input.starts_at,
    score_input.ends_at,
    score_input.is_in_liquidation,
    score_input.is_terminated,
    score_input.natural_person_office_only,
    score_input.registered_office_count,
    exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider = 'mapy'
        and evidence.evidence_kind = 'establishment'
        and evidence.match_level in ('exact_address', 'same_building')
    ) as exact_establishment_evidence,
    coalesce(company.metadata #>> '{evaluation,virtualOffice}' = 'true', false) as explicit_virtual_office,
    coalesce(company.metadata #>> '{evaluation,massRegisteredOffice}' = 'true', false) as explicit_mass_office
  from public.complete_power_outage_companies company
  join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  join public.complete_power_outage_company_score_inputs score_input
    on score_input.candidate_id = company.id
  where company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and score_row.score_status in ('complete', 'preliminary')
    and score_row.grade = 'A'
), evaluated as (
  select
    base.*,
    round((extract(epoch from (ends_at - starts_at)) / 3600)::numeric, 2) as outage_duration_hours,
    public.complete_power_outage_top_primary_nace_allowed(primary_nace_code) as primary_nace_allowed,
    public.complete_power_outage_top_noncommercial_name(company_name) as noncommercial_name,
    public.complete_power_outage_top_low_fit_name(company_name) as low_fit_name,
    coalesce(
      explicit_virtual_office
      or (
        entity_kind = 'registered_office'
        and not exact_establishment_evidence
        and (explicit_mass_office or registered_office_count >= 20)
      ),
      false
    ) as true_mass_or_virtual_office
  from base
), classified as (
  select
    evaluated.*,
    array_remove(array[
      case when primary_nace_allowed then 'operationally_relevant_primary_nace' end,
      case when exact_establishment_evidence then 'exact_establishment_evidence' end,
      case when outage_duration_hours >= 3 then 'minimum_three_hour_outage' end,
      'current_grade_a_candidate'
    ], null)::text[] as reason_codes,
    array_remove(array[
      case when primary_nace_code is null then 'missing_primary_nace' end,
      case when primary_nace_code is not null and not primary_nace_allowed then 'primary_nace_not_in_top_group' end,
      case when is_in_liquidation then 'company_in_liquidation' end,
      case when is_terminated then 'terminated_company' end,
      case when natural_person_office_only then 'natural_person_registered_office_only' end,
      case when noncommercial_name then 'noncommercial_association_firefighter_or_hunting_entity' end,
      case when low_fit_name then 'low_fit_business_name' end,
      case when true_mass_or_virtual_office then 'true_mass_or_virtual_office' end,
      case when outage_duration_hours < 3 then 'outage_shorter_than_three_hours' end
    ], null)::text[] as exclusion_codes
  from evaluated
)
select
  classified.*,
  case
    when primary_nace_code is null then 'needs_review'
    when cardinality(exclusion_codes) > 0 then 'excluded'
    else 'eligible'
  end as evaluation_status,
  case
    when primary_nace_code is null then false
    when cardinality(exclusion_codes) > 0 then false
    else true
  end as top_eligible,
  encode(digest(concat_ws('|',
    candidate_id::text,
    coalesce(company_name, ''),
    coalesce(primary_nace_code, ''),
    coalesce(score, -1)::text,
    coalesce(grade, ''),
    entity_kind,
    starts_at::text,
    ends_at::text,
    is_in_liquidation::text,
    is_terminated::text,
    natural_person_office_only::text,
    registered_office_count::text,
    exact_establishment_evidence::text,
    explicit_virtual_office::text,
    explicit_mass_office::text,
    true_mass_or_virtual_office::text,
    noncommercial_name::text,
    low_fit_name::text,
    '1'
  ), 'sha256'), 'hex') as calculation_input_hash
from classified;

create or replace function public.refresh_complete_power_outage_top_selection_shadow(
  requested_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(5000, greatest(1, coalesce(requested_limit, 1000)));
  current_version integer;
  processed_count integer := 0;
  removed_count integer := 0;
  eligible_count bigint := 0;
  excluded_count bigint := 0;
  review_count bigint := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('complete_power_outage_top_selection_shadow')) then
    return jsonb_build_object('status', 'busy', 'processedCount', 0);
  end if;

  select rules_version into current_version
  from public.complete_power_outage_top_selection_state
  where singleton and shadow_enabled;

  if not found then
    return jsonb_build_object('status', 'disabled', 'processedCount', 0);
  end if;

  -- Odvozeny stinovy vysledek drzi pouze aktualni univerzum A.
  delete from public.complete_power_outage_company_top_selections result_row
  where not exists (
    select 1
    from public.complete_power_outage_top_selection_inputs input
    where input.candidate_id = result_row.candidate_id
  );
  get diagnostics removed_count = row_count;

  with selected as materialized (
    select input.*
    from public.complete_power_outage_top_selection_inputs input
    left join public.complete_power_outage_company_top_selections result_row
      on result_row.candidate_id = input.candidate_id
    where result_row.candidate_id is null
       or result_row.rules_version <> current_version
       or result_row.calculation_input_hash is distinct from input.calculation_input_hash
       or result_row.evaluation_status = 'error'
    order by
      case when result_row.candidate_id is null then 0 else 1 end,
      input.starts_at,
      input.candidate_id
    limit safe_limit
  )
  insert into public.complete_power_outage_company_top_selections (
    candidate_id,
    evaluation_status,
    top_eligible,
    rules_version,
    primary_nace_code,
    reason_codes,
    exclusion_codes,
    evidence,
    calculation_input_hash,
    evaluated_at,
    last_error_code,
    last_error_message
  )
  select
    selected.candidate_id,
    selected.evaluation_status,
    selected.top_eligible,
    current_version,
    selected.primary_nace_code,
    selected.reason_codes,
    selected.exclusion_codes,
    jsonb_build_object(
      'contract', 'complete-top-selection-shadow-v1',
      'companyName', selected.company_name,
      'ordinaryScore', selected.score,
      'ordinaryGrade', selected.grade,
      'primaryNaceCode', selected.primary_nace_code,
      'outageDurationHours', selected.outage_duration_hours,
      'exactEstablishmentEvidence', selected.exact_establishment_evidence,
      'registeredOfficeCount', selected.registered_office_count,
      'trueMassOrVirtualOffice', selected.true_mass_or_virtual_office,
      'noncommercialName', selected.noncommercial_name,
      'lowFitName', selected.low_fit_name,
      'enrichmentCompletenessAffectsSelection', false
    ),
    selected.calculation_input_hash,
    now(),
    null,
    null
  from selected
  on conflict (candidate_id) do update
  set evaluation_status = excluded.evaluation_status,
      top_eligible = excluded.top_eligible,
      rules_version = excluded.rules_version,
      primary_nace_code = excluded.primary_nace_code,
      reason_codes = excluded.reason_codes,
      exclusion_codes = excluded.exclusion_codes,
      evidence = excluded.evidence,
      calculation_input_hash = excluded.calculation_input_hash,
      evaluated_at = excluded.evaluated_at,
      last_error_code = null,
      last_error_message = null;
  get diagnostics processed_count = row_count;

  select
    count(*) filter (where top_eligible),
    count(*) filter (where evaluation_status = 'excluded'),
    count(*) filter (where evaluation_status = 'needs_review')
  into eligible_count, excluded_count, review_count
  from public.complete_power_outage_company_top_selections;

  update public.complete_power_outage_top_selection_state
  set last_evaluation_at = now(),
      last_processed_count = processed_count,
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'contract', 'complete-top-selection-shadow-v1',
        'lastStatus', 'succeeded',
        'lastRemovedCount', removed_count,
        'eligibleCount', eligible_count,
        'excludedCount', excluded_count,
        'reviewCount', review_count
      )
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'processedCount', processed_count,
    'removedCount', removed_count,
    'eligibleCount', eligible_count,
    'excludedCount', excluded_count,
    'reviewCount', review_count,
    'rulesVersion', current_version
  );
exception when others then
  update public.complete_power_outage_top_selection_state
  set last_evaluation_at = now(),
      last_processed_count = 0,
      last_error_code = 'COMPLETE_TOP_SELECTION_SHADOW_FAILED',
      last_error_message = left(sqlerrm, 2000),
      metadata = metadata || jsonb_build_object('lastStatus', 'failed')
  where singleton;
  return jsonb_build_object(
    'status', 'failed',
    'processedCount', 0,
    'errorCode', 'COMPLETE_TOP_SELECTION_SHADOW_FAILED',
    'errorMessage', left(sqlerrm, 2000)
  );
end;
$$;

create or replace view public.complete_power_outage_top_selection_overview
with (security_invoker = true)
as
select
  state_row.shadow_enabled,
  state_row.ui_enabled,
  state_row.rules_version,
  count(input.candidate_id)::bigint as current_grade_a_count,
  count(result_row.candidate_id)::bigint as represented_count,
  count(*) filter (where result_row.top_eligible)::bigint as top_eligible_count,
  count(*) filter (where result_row.evaluation_status = 'excluded')::bigint as excluded_count,
  count(*) filter (where result_row.evaluation_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where result_row.evaluation_status = 'error')::bigint as error_count,
  state_row.last_evaluation_at,
  state_row.last_processed_count,
  state_row.last_error_code,
  state_row.last_error_message,
  state_row.metadata
from public.complete_power_outage_top_selection_state state_row
left join public.complete_power_outage_top_selection_inputs input on true
left join public.complete_power_outage_company_top_selections result_row
  on result_row.candidate_id = input.candidate_id
where state_row.singleton
group by
  state_row.shadow_enabled,
  state_row.ui_enabled,
  state_row.rules_version,
  state_row.last_evaluation_at,
  state_row.last_processed_count,
  state_row.last_error_code,
  state_row.last_error_message,
  state_row.metadata;

revoke all on function public.complete_power_outage_top_primary_nace_allowed(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_top_noncommercial_name(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_top_low_fit_name(text)
  from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_top_selection_shadow(integer)
  from public, anon, authenticated;

grant execute on function public.complete_power_outage_top_primary_nace_allowed(text) to service_role;
grant execute on function public.complete_power_outage_top_noncommercial_name(text) to service_role;
grant execute on function public.complete_power_outage_top_low_fit_name(text) to service_role;
grant execute on function public.refresh_complete_power_outage_top_selection_shadow(integer) to service_role;

revoke all on table public.complete_power_outage_top_selection_inputs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_top_selection_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_top_selection_inputs to service_role;
grant select on table public.complete_power_outage_top_selection_overview to service_role;

update public.complete_power_outage_top_selection_state
set shadow_enabled = true,
    ui_enabled = false,
    rules_version = 1,
    metadata = metadata || jsonb_build_object(
      'contract', 'complete-top-selection-shadow-v1',
      'activatedAt', now(),
      'candidateUniverse', 'current-visible-grade-a',
      'industryEvidence', 'primary-nace-only',
      'massOfficeEstablishmentException', true,
      'uiSelectionEnabled', false
    )
where singleton;

select public.refresh_complete_power_outage_top_selection_shadow(5000);

do $$
declare
  existing_job record;
begin
  if to_regnamespace('cron') is null then
    raise exception 'Rozsireni pg_cron neni dostupne.';
  end if;

  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete-power-outage-top-selection-shadow-v1'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete-power-outage-top-selection-shadow-v1',
    '* * * * *',
    'select public.refresh_complete_power_outage_top_selection_shadow(1000);'
  );
end
$$;

notify pgrst, 'reload schema';

commit;
