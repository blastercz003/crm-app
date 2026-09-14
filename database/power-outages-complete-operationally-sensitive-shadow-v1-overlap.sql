-- KROK 4 / VYSTUP 2: prekryv s TOP VYBER a VELKE FIRMY.
-- Vyhodnoceni TOP pouziva aktivni verzovany kontrakt; VELKE FIRMY stejny
-- privatni predikat jako soucasny dynamicky selector.

with latest_run as (
  select state.latest_shadow_run_id as run_id
  from public.complete_power_outage_operational_sensitivity_state state
  join public.complete_power_outage_operational_sensitivity_shadow_runs run
    on run.id = state.latest_shadow_run_id
   and run.status = 'complete'
  where state.singleton
), eligible as (
  select result.*
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_run on latest_run.run_id = result.run_id
  where result.is_eligible
), classified as (
  select
    eligible.*,
    exists (
      select 1
      from public.complete_power_outage_contact_discovery_selectors selector_row
      join public.complete_power_outage_top_selection_versions version_row
        on version_row.version_key = selector_row.selection_version_key
       and version_row.lifecycle_status in ('active', 'archived')
      join public.complete_power_outage_company_top_selections top_row
        on top_row.candidate_id = eligible.candidate_id
       and top_row.rules_version = version_row.internal_rules_version
       and top_row.evaluation_status = 'eligible'
       and top_row.top_eligible
      where selector_row.selector_key = 'top_v1'
        and selector_row.lifecycle_status = 'active'
    ) as in_top_selection,
    coalesce(
      public.complete_power_outage_is_large_company_v1(eligible.ico),
      false
    ) as in_large_companies
  from eligible
), overlap_groups as (
  select
    case
      when in_top_selection and in_large_companies then 'TOP VÝBĚR + VELKÉ FIRMY'
      when in_top_selection then 'POUZE TOP VÝBĚR'
      when in_large_companies then 'POUZE VELKÉ FIRMY'
      else 'BEZ PŘEKRYVU'
    end as overlap_group,
    *
  from classified
)
select
  overlap_group,
  count(*)::bigint as record_count,
  count(distinct ico) filter (where ico is not null)::bigint as unique_ico_count,
  count(*) filter (where outage_source = 'cez')::bigint as cez_count,
  count(*) filter (where outage_source = 'egd')::bigint as egd_count,
  count(*) filter (where outage_source = 'pre')::bigint as pre_count,
  round(100.0 * count(*) / nullif(sum(count(*)) over (), 0), 2)
    as share_of_operationally_sensitive_percent
from overlap_groups
group by overlap_group
order by record_count desc, overlap_group;
