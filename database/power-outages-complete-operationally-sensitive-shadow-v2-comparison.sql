with latest_v1 as (
  select id
  from public.complete_power_outage_operational_sensitivity_shadow_runs
  where rules_version = 1 and status = 'complete'
  order by finished_at desc
  limit 1
), latest_v2 as (
  select id
  from public.complete_power_outage_operational_sensitivity_shadow_runs
  where rules_version = 2 and status = 'complete'
  order by finished_at desc
  limit 1
), v1_results as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_v1 on latest_v1.id = result.run_id
), v2_results as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_v2 on latest_v2.id = result.run_id
), compared as (
  select
    coalesce(v1.candidate_id, v2.candidate_id) as candidate_id,
    coalesce(v2.company_name, v1.company_name) as company_name,
    coalesce(v2.ico, v1.ico) as ico,
    coalesce(v2.outage_source, v1.outage_source) as outage_source,
    coalesce(v2.starts_at, v1.starts_at) as starts_at,
    coalesce(v1.is_eligible, false) as v1_eligible,
    coalesce(v2.is_eligible, false) as v2_eligible,
    v1.category as v1_category,
    v2.category as v2_category,
    v1.winning_rule_key as v1_rule,
    v2.winning_rule_key as v2_rule
  from v1_results v1
  full join v2_results v2
    on v2.candidate_id = v1.candidate_id
)
select
  case
    when v1_eligible and v2_eligible then 'ZŮSTÁVÁ ZAŘAZENO'
    when v1_eligible and not v2_eligible then 'V2 VYŘAZENO'
    when not v1_eligible and v2_eligible then 'V2 NOVĚ ZAŘAZENO'
    else 'STÁLE NEZAŘAZENO'
  end as comparison_result,
  count(*)::bigint as record_count,
  count(distinct ico) filter (where ico is not null)::bigint as unique_ico_count
from compared
group by comparison_result
order by comparison_result;
