begin;

-- Přesná adresa určuje, zda se odstávka týká nalezeného subjektu. Google je
-- ponechán pouze jako historický auditní zdroj a nevstupuje do rozhodování.
-- Obchodní skóre současně nesmí zaměnit chybějící NACE za nízkou relevanci.

do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_company_evidence') is null
     or to_regclass('public.complete_power_outage_company_scores') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regprocedure('public.refresh_complete_power_outage_company_scores(integer)') is null
     or to_regprocedure('public.get_complete_power_outage_company_evaluation_queue(integer)') is null
     or to_regprocedure('public.refresh_complete_power_outage_evaluation_progress_snapshot()') is null
     or to_regprocedure('public.complete_power_outage_pending_queue_since(text)') is null
  then
    raise exception 'Chybí závislosti pro přesné párování a obchodní skóre v2.';
  end if;
end
$$;

create or replace function public.complete_power_outage_mapy_industry_points(requested_labels text[])
returns integer
language sql
immutable
set search_path = ''
as $$
  with labels as (
    select lower(btrim(label)) as label
    from unnest(coalesce(requested_labels, array[]::text[])) label
    where btrim(coalesce(label, '')) <> ''
  )
  select case
    when exists (
      select 1 from labels
      where label ~ '(továr|vyrob|výrob|factory|manufactur|průmysl|industrial|nemocnic|hospital|datové centrum|data cent)'
    ) then 70
    when exists (
      select 1 from labels
      where label ~ '(supermarket|hypermarket|market|prodejna|obchod|retail|shop|drogeri|lékár|lekar|pharmacy|restaur|hotel|sklad|warehouse|logisti|čerpací|cerpaci|fuel|autoservis|car service|pekár|pekar|bakery|řeznict|reznict|butcher)'
    ) then 55
    when exists (select 1 from labels) then 35
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
    coalesce((
      select array_agg(distinct evidence.metadata ->> 'label' order by evidence.metadata ->> 'label')
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider = 'mapy'
        and evidence.evidence_kind = 'establishment'
        and btrim(coalesce(evidence.metadata ->> 'label', '')) <> ''
    ), array[]::text[]) as mapy_labels,
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
    case
      when cardinality(nace_codes) > 0 then public.complete_power_outage_industry_points(nace_codes)
      else coalesce(public.complete_power_outage_mapy_industry_points(mapy_labels), 35)
    end as industry_points,
    case
      when cardinality(nace_codes) > 0 then 'nace'
      when public.complete_power_outage_mapy_industry_points(mapy_labels) is not null then 'mapy_category'
      else 'neutral_unknown'
    end as industry_evidence_source,
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
      case when industry_evidence_source = 'mapy_category' then 'mapy_industry_category' end,
      case when industry_evidence_source = 'neutral_unknown' then 'unknown_industry_neutral' end,
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
  greatest(0, least(100, industry_points + outage_points + establishment_points - penalty_points))::integer as score,
  case
    when greatest(0, least(100, industry_points + outage_points + establishment_points - penalty_points)) >= 75 then 'A'
    when greatest(0, least(100, industry_points + outage_points + establishment_points - penalty_points)) >= 50 then 'B'
    else 'C'
  end as grade,
  case when company_profile_id is not null or enrichment_status = 'not_found'
    then 'complete' else 'preliminary' end as data_completeness,
  encode(digest(concat_ws('|',
    coalesce(ico, ''), coalesce(legal_form, ''), array_to_string(nace_codes, ','),
    array_to_string(mapy_labels, ','), industry_evidence_source,
    entity_kind, address_scope, starts_at::text, ends_at::text,
    registered_office_count::text, is_in_liquidation::text, is_terminated::text,
    coalesce(profile_payload_sha256, ''), current_date::text,
    mass_or_virtual_office::text, natural_person_office_only::text,
    incomplete_address::text, provider_conflict::text
  ), 'sha256'), 'hex') as calculation_input_hash
from calculated;

-- Posune provozní kontrakt fronty vyhodnocení z verze 2 na verzi 3, aniž by
-- měnil její váhy mezi distributory nebo ostatní bezpečnostní podmínky.
do $$
declare
  definition text;
  changed_definition text;
begin
  definition := pg_get_functiondef('public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure);
  changed_definition := replace(definition, 'company.evaluation_version < 2', 'company.evaluation_version < 3');
  if changed_definition = definition then
    raise exception 'Nelze bezpečně aktualizovat verzi fronty vyhodnocení.';
  end if;
  execute changed_definition;

  definition := pg_get_functiondef('public.refresh_complete_power_outage_evaluation_progress_snapshot()'::regprocedure);
  changed_definition := replace(definition, 'company.evaluation_version >= 2', 'company.evaluation_version >= 3');
  if changed_definition = definition then
    raise exception 'Nelze bezpečně aktualizovat snapshot vyhodnocení.';
  end if;
  execute changed_definition;

  definition := pg_get_functiondef('public.complete_power_outage_pending_queue_since(text)'::regprocedure);
  changed_definition := replace(definition, 'company.evaluation_version < 2', 'company.evaluation_version < 3');
  if changed_definition = definition then
    raise exception 'Nelze bezpečně aktualizovat detekci čekajícího vyhodnocení.';
  end if;
  execute changed_definition;

  definition := pg_get_functiondef('public.refresh_complete_power_outage_company_scores(integer)'::regprocedure);
  changed_definition := replace(
    definition,
    '''complete-commercial-score-v1''',
    '''complete-commercial-score-v2'''
  );
  if changed_definition = definition then
    raise exception 'Nelze bezpečně aktualizovat kontrakt výpočtu skóre.';
  end if;
  execute changed_definition;
end
$$;

-- Všechny aktuální automaticky řízené kandidáty nechá znovu projít novou
-- verzí vyhodnocení. Ručně uzavřený stav zůstává v aplikačním workeru zachován.
update public.complete_power_outage_companies company
set evaluation_version = 0,
    evaluation_reasons = array[]::text[],
    evaluated_at = null,
    business_relevance_version = case
      when company.business_relevance_override then company.business_relevance_version
      else 0
    end,
    business_relevance_evaluated_at = case
      when company.business_relevance_override then company.business_relevance_evaluated_at
      else null
    end,
    updated_at = now()
from public.complete_power_outage_addresses address,
     public.complete_power_outages outage
where address.id = company.outage_address_id
  and outage.id = address.outage_id
  and company.candidate_status in ('new', 'confirmed', 'needs_review')
  and outage.source_status in ('scheduled', 'active')
  and outage.ends_at >= now();

update public.complete_power_outage_commercial_selection_state
set scoring_version = greatest(scoring_version, 2),
    metadata = metadata || jsonb_build_object(
      'scoringContract', 'complete-commercial-score-v2',
      'matchingContract', 'complete-exact-address-match-v3',
      'googleAffectsMatching', false,
      'missingNacePolicy', 'mapy-category-or-neutral'
    ),
    updated_at = now()
where singleton and scoring_enabled;

update public.complete_power_outage_company_scores score_row
set score_status = 'stale',
    next_recalculation_at = now(),
    updated_at = now()
from public.complete_power_outage_companies company,
     public.complete_power_outage_addresses address,
     public.complete_power_outages outage
where company.id = score_row.candidate_id
  and address.id = company.outage_address_id
  and outage.id = address.outage_id
  and company.candidate_status in ('new', 'confirmed', 'needs_review')
  and outage.source_status in ('scheduled', 'active')
  and outage.ends_at >= now();

-- První dávka proběhne v této transakci, další zpracuje existující minutový
-- cron. Nedochází k externím požadavkům ani ke změně zdrojových odstávek.
select public.refresh_complete_power_outage_company_scores(1000);

select public.refresh_complete_power_outage_evaluation_progress_snapshot();

revoke all on function public.complete_power_outage_mapy_industry_points(text[])
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_mapy_industry_points(text[])
  to service_role;

revoke all on table public.complete_power_outage_company_score_inputs
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_score_inputs
  to service_role;

notify pgrst, 'reload schema';
commit;

select 'FUNCTION' as check_type, 'Mapy category supplies industry evidence' as object_name,
  to_regprocedure('public.complete_power_outage_mapy_industry_points(text[])') is not null
union all
select 'LOGIC', 'missing NACE uses neutral preliminary industry value',
  exists (
    select 1 from public.complete_power_outage_company_score_inputs
    where cardinality(nace_codes) = 0
      and industry_evidence_source = 'neutral_unknown'
      and industry_points = 35
  ) or not exists (
    select 1 from public.complete_power_outage_company_score_inputs
    where cardinality(nace_codes) = 0 and industry_evidence_source = 'neutral_unknown'
  )
union all
select 'LOGIC', 'evaluation queue uses matching version three',
  position('company.evaluation_version < 3' in pg_get_functiondef(
    'public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure
  )) > 0
union all
select 'LOGIC', 'evaluation progress uses matching version three',
  position('company.evaluation_version >= 3' in pg_get_functiondef(
    'public.refresh_complete_power_outage_evaluation_progress_snapshot()'::regprocedure
  )) > 0
union all
select 'STATE', 'commercial scoring version two is active',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and scoring_enabled and scoring_version >= 2
  )
union all
select 'FUNCTION', 'score rows use commercial score contract v2',
  position('complete-commercial-score-v2' in pg_get_functiondef(
    'public.refresh_complete_power_outage_company_scores(integer)'::regprocedure
  )) > 0
union all
select 'SAFETY', 'Google remains stored but is not required by database scoring',
  position('google' in lower(pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true))) = 0
union all
select 'ISOLATION', 'matching and scoring stay in COMPLETE scope',
  position('public.stores' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0
  and position('power_outage_store_matches' in pg_get_viewdef('public.complete_power_outage_company_score_inputs'::regclass, true)) = 0;
