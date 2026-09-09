-- Krok 8: čistě čtecí audit rozdělení obchodního skóre A/B/C.
-- Nemění prahy, skóre, zdrojová data, běhy ani stav UI.
with current_rows as materialized (
  select
    company.id as candidate_id,
    company.ico,
    company.created_at as candidate_created_at,
    outage.source,
    score_row.company_profile_id,
    score_row.score_status,
    score_row.score,
    score_row.grade,
    score_row.selection_eligible,
    score_row.data_completeness,
    score_row.industry_points,
    score_row.outage_points,
    score_row.establishment_points,
    score_row.penalty_points,
    score_row.reason_codes,
    score_row.penalty_codes,
    score_row.scoring_version,
    score_row.calculated_at
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  where company.candidate_status <> 'stale'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
), totals as (
  select
    count(*)::bigint as current_count,
    count(*) filter (where score is not null)::bigint as scored_count
  from current_rows
), checks as (
  select 10 as sort_order, 'KONTROLA'::text as section,
    'Žádný kandidát starší než 5 minut nechybí ve skóre'::text as segment,
    null::text as source, null::text as grade, null::text as completeness,
    count(*) filter (
      where score_status is null
        and candidate_created_at < now() - interval '5 minutes'
    )::bigint as item_count,
    null::numeric as share_percent, null::numeric as average_score,
    null::bigint as eligible_count,
    (count(*) filter (
      where score_status is null
        and candidate_created_at < now() - interval '5 minutes'
    ) = 0) as is_correct,
    concat(
      'Starší chybějící: ', count(*) filter (
        where score_status is null
          and candidate_created_at < now() - interval '5 minutes'
      ),
      ' · všechny nové čekající na první evidenci: ', count(*) filter (where score_status is null)
    )::text as detail
  from current_rows

  union all
  select 11, 'KONTROLA', 'Všechna evidovaná skóre jsou dopočítaná',
    null, null, null,
    count(*) filter (where score_status is not null and score is null),
    null, null, null,
    count(*) filter (where score_status is not null and score is null) = 0,
    'item_count = počet kandidátů čekajících na výpočet; při běhu cronu může dočasně růst'
  from current_rows

  union all
  select 12, 'KONTROLA', 'Žádné aktuální skóre není v chybovém stavu',
    null, null, null,
    count(*) filter (where score_status = 'error'),
    null, null, null,
    count(*) filter (where score_status = 'error') = 0,
    'item_count = počet reálných chyb skórování; očekává se 0'
  from current_rows

  union all
  select 13, 'KONTROLA', 'Známky odpovídají hranicím A/B/C',
    null, null, null,
    count(*) filter (
      where score is not null and grade is distinct from case
        when score >= 75 then 'A'
        when score >= 50 then 'B'
        else 'C'
      end
    ),
    null, null, null,
    count(*) filter (
      where score is not null and grade is distinct from case
        when score >= 75 then 'A'
        when score >= 50 then 'B'
        else 'C'
      end
    ) = 0,
    'A = 75–100, B = 50–74, C = 0–49'
  from current_rows

  union all
  select 14, 'KONTROLA', 'Výběrově způsobilé záznamy mají nejméně 50 bodů',
    null, null, null,
    count(*) filter (where selection_eligible and coalesce(score, -1) < 50),
    null, null, null,
    count(*) filter (where selection_eligible and coalesce(score, -1) < 50) = 0,
    'Záznam může mít 50+ bodů a přesto nebýt způsobilý kvůli vylučující penalizaci'
  from current_rows

  union all
  select 15, 'KONTROLA', 'Skórování je aktivní a AI SELECT zůstává skrytý',
    null, null, null, 0,
    null, null, null,
    exists (
      select 1
      from public.complete_power_outage_commercial_selection_state
      where singleton and scoring_enabled and scoring_version = 1 and not ui_enabled
    ),
    'Audit nic nezapíná a nemění uživatelské rozhraní'
), summary_rows as (
  select 20 as sort_order, 'SOUHRN'::text as section,
    'Aktuální kandidáti'::text as segment,
    null::text as source, null::text as grade, null::text as completeness,
    total.current_count as item_count,
    100::numeric as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    'Pouze aktuální budoucí nebo právě probíhající odstávky'::text as detail
  from current_rows row cross join totals total
  group by total.current_count

  union all
  select 21, 'SOUHRN', 'Dopočítané skóre',
    null, null, null,
    total.scored_count,
    round(100 * total.scored_count::numeric / nullif(total.current_count, 0), 1),
    round(avg(row.score)::numeric, 1),
    count(*) filter (where row.selection_eligible),
    null,
    'Podíl kandidátů, u kterých již proběhl lokální výpočet'
  from current_rows row cross join totals total
  group by total.current_count, total.scored_count

  union all
  select 22, 'SOUHRN', 'Čeká na výpočet',
    null, null, null,
    total.current_count - total.scored_count,
    round(100 * (total.current_count - total.scored_count)::numeric / nullif(total.current_count, 0), 1),
    null, null, null,
    'Při aktivním minutovém cronu se tato skupina automaticky zmenšuje'
  from totals total
), grade_rows as (
  select
    30 + case row.grade when 'A' then 1 when 'B' then 2 else 3 end as sort_order,
    'ZNÁMKY CELKEM'::text as section,
    ('Známka ' || row.grade)::text as segment,
    null::text as source,
    row.grade,
    null::text as completeness,
    count(*)::bigint as item_count,
    round(100 * count(*)::numeric / nullif(total.scored_count, 0), 1) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    case row.grade
      when 'A' then 'Nejvyšší obchodní potenciál'
      when 'B' then 'Střední obchodní potenciál'
      else 'Nízký obchodní potenciál'
    end::text as detail
  from current_rows row cross join totals total
  where row.score is not null
  group by row.grade, total.scored_count
), source_progress_rows as (
  select
    25 + dense_rank() over (order by row.source) as sort_order,
    'DOKONČENÍ PODLE DISTRIBUTORA'::text as section,
    upper(row.source)::text as segment,
    row.source,
    null::text as grade,
    null::text as completeness,
    count(*)::bigint as item_count,
    round(
      100 * (count(*) filter (where row.score is not null))::numeric
      / nullif(count(*), 0),
      1
    ) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    concat(
      'Dopočítáno ', count(*) filter (where row.score is not null),
      ' z ', count(*),
      ' · čeká ', count(*) filter (where row.score is null)
    )::text as detail
  from current_rows row
  group by row.source
), source_grade_rows as (
  select
    40 + dense_rank() over (order by row.source)
      + case row.grade when 'A' then 0 when 'B' then 10 else 20 end as sort_order,
    'ZNÁMKY PODLE DISTRIBUTORA'::text as section,
    (upper(row.source) || ' · ' || row.grade)::text as segment,
    row.source,
    row.grade,
    null::text as completeness,
    count(*)::bigint as item_count,
    round(
      100 * count(*)::numeric
      / nullif(sum(count(*)) over (partition by row.source), 0),
      1
    ) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    'Podíl se počítá uvnitř daného distributora'::text as detail
  from current_rows row
  where row.score is not null
  group by row.source, row.grade
), completeness_grade_rows as (
  select
    80 + dense_rank() over (order by case
      when row.data_completeness = 'complete' and row.company_profile_id is not null then 'res_profile'
      when row.data_completeness = 'complete' then 'res_not_found'
      else 'preliminary'
    end)
      + case row.grade when 'A' then 0 when 'B' then 10 else 20 end as sort_order,
    'ÚPLNOST PROFILU'::text as section,
    (case
      when row.data_completeness = 'complete' and row.company_profile_id is not null then 'Doplněný profil RES'
      when row.data_completeness = 'complete' then 'RES bez dostupného profilu'
      else 'Předběžný profil'
    end
      || ' · ' || row.grade)::text as segment,
    null::text as source,
    row.grade,
    row.data_completeness as completeness,
    count(*)::bigint as item_count,
    round(
      100 * count(*)::numeric
      / nullif(sum(count(*)) over (partition by case
          when row.data_completeness = 'complete' and row.company_profile_id is not null then 'res_profile'
          when row.data_completeness = 'complete' then 'res_not_found'
          else 'preliminary'
        end), 0),
      1
    ) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    'Umožňuje oddělit doplněný profil, uzavřený nenález a skóre čekající na RES'
  from current_rows row
  where row.score is not null
  group by row.data_completeness, row.company_profile_id is not null, row.grade
), score_profile as (
  select
    120 as sort_order,
    'PROFIL SKÓRE'::text as section,
    'Percentily skóre'::text as segment,
    null::text as source, null::text as grade, null::text as completeness,
    count(*)::bigint as item_count,
    null::numeric as share_percent,
    round(avg(score)::numeric, 1) as average_score,
    count(*) filter (where selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    concat(
      'P10 ', percentile_disc(0.10) within group (order by score),
      ' · P25 ', percentile_disc(0.25) within group (order by score),
      ' · medián ', percentile_disc(0.50) within group (order by score),
      ' · P75 ', percentile_disc(0.75) within group (order by score),
      ' · P90 ', percentile_disc(0.90) within group (order by score)
    )::text as detail
  from current_rows
  where score is not null
), reason_rows as (
  select
    130 + row_number() over (order by count(*) desc, reason.reason_code) as sort_order,
    'PLUSOVÉ DŮVODY'::text as section,
    reason.reason_code::text as segment,
    null::text as source, null::text as grade, null::text as completeness,
    count(*)::bigint as item_count,
    round(100 * count(*)::numeric / nullif(total.scored_count, 0), 1) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    'Jeden kandidát může mít více důvodů'::text as detail
  from current_rows row
  cross join lateral unnest(coalesce(row.reason_codes, array[]::text[])) reason(reason_code)
  cross join totals total
  where row.score is not null
  group by reason.reason_code, total.scored_count
), penalty_rows as (
  select
    160 + row_number() over (order by count(*) desc, penalty.penalty_code) as sort_order,
    'PENALIZACE'::text as section,
    penalty.penalty_code::text as segment,
    null::text as source, null::text as grade, null::text as completeness,
    count(*)::bigint as item_count,
    round(100 * count(*)::numeric / nullif(total.scored_count, 0), 1) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    count(*) filter (where row.selection_eligible)::bigint as eligible_count,
    null::boolean as is_correct,
    'Jeden kandidát může mít více penalizací'::text as detail
  from current_rows row
  cross join lateral unnest(coalesce(row.penalty_codes, array[]::text[])) penalty(penalty_code)
  cross join totals total
  where row.score is not null
  group by penalty.penalty_code, total.scored_count
), eligibility_blocker_rows as (
  select
    200 + row_number() over (order by count(*) desc, blocker.blocker_code) as sort_order,
    'BLOKACE VÝBĚRU 50+'::text as section,
    blocker.blocker_code::text as segment,
    null::text as source,
    null::text as grade,
    null::text as completeness,
    count(*)::bigint as item_count,
    round(
      100 * count(*)::numeric
      / nullif((
        select count(*)
        from current_rows blocked
        where blocked.score >= 50 and not blocked.selection_eligible
      ), 0),
      1
    ) as share_percent,
    round(avg(row.score)::numeric, 1) as average_score,
    0::bigint as eligible_count,
    null::boolean as is_correct,
    'Jeden kandidát může mít více blokací; jde o skóre A/B vyřazené z AI SELECT'::text as detail
  from current_rows row
  cross join lateral unnest(coalesce(row.penalty_codes, array[]::text[])) blocker(blocker_code)
  where row.score >= 50
    and not row.selection_eligible
    and blocker.blocker_code in (
      'mass_or_virtual_registered_office',
      'natural_person_registered_office_only',
      'company_in_liquidation',
      'terminated_company'
    )
  group by blocker.blocker_code
)
select section, segment, source, grade, completeness, item_count,
  share_percent, average_score, eligible_count, is_correct, detail
from (
  select * from checks
  union all select * from summary_rows
  union all select * from source_progress_rows
  union all select * from grade_rows
  union all select * from source_grade_rows
  union all select * from completeness_grade_rows
  union all select * from score_profile
  union all select * from reason_rows
  union all select * from penalty_rows
  union all select * from eligibility_blocker_rows
) audit_rows
order by sort_order, section, segment;
