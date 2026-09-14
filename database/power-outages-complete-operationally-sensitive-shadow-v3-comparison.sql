with latest_v2 as (
  select id
  from public.complete_power_outage_operational_sensitivity_shadow_runs
  where rules_version = 2 and status = 'complete'
  order by finished_at desc
  limit 1
), latest_v3 as (
  select id
  from public.complete_power_outage_operational_sensitivity_shadow_runs
  where rules_version = 3 and status = 'complete'
  order by finished_at desc
  limit 1
), v2_results as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_v2 on latest_v2.id = result.run_id
), v3_results as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_v3 on latest_v3.id = result.run_id
), compared as (
  select
    coalesce(v2.candidate_id, v3.candidate_id) as candidate_id,
    coalesce(v3.company_name, v2.company_name) as company_name,
    coalesce(v3.ico, v2.ico) as ico,
    coalesce(v2.is_eligible, false) as v2_eligible,
    coalesce(v3.is_eligible, false) as v3_eligible,
    v2.category as v2_category,
    v3.category as v3_category,
    v2.winning_rule_key as v2_rule,
    v3.winning_rule_key as v3_rule
  from v2_results v2
  full join v3_results v3
    on v3.candidate_id = v2.candidate_id
)
select
  case
    when v2_eligible and v3_eligible then 'ZŮSTÁVÁ ZAŘAZENO'
    when v2_eligible and not v3_eligible then 'V3 VYŘAZENO'
    when not v2_eligible and v3_eligible then 'V3 NOVĚ ZAŘAZENO'
    else 'STÁLE NEZAŘAZENO'
  end as comparison_result,
  count(*)::bigint as record_count,
  count(distinct ico) filter (where ico is not null)::bigint as unique_ico_count,
  array_agg(distinct company_name order by company_name) filter (
    where v2_eligible is distinct from v3_eligible
  ) as changed_company_names
from compared
group by comparison_result
order by comparison_result;
