-- KROK 4 / DOPLNKOVY OBSAHOVY AUDIT
-- Konkretni vybrane zaznamy, ktere pred aktivaci vyzaduji automaticke
-- zprisneni pravidel. Jde o read-only dotaz bez externich pozadavku.

with latest_run as (
  select state.latest_shadow_run_id as run_id
  from public.complete_power_outage_operational_sensitivity_state state
  join public.complete_power_outage_operational_sensitivity_shadow_runs run
    on run.id = state.latest_shadow_run_id
   and run.status = 'complete'
  where state.singleton
), eligible as (
  select
    result.*,
    profile.official_name,
    profile.is_in_liquidation,
    profile.is_terminated,
    profile.subject_status,
    profile.primary_nace_2025_code,
    profile.primary_nace_2008_code,
    profile.metadata ->> 'primaryNace2025Source' as primary_nace_2025_source,
    profile.metadata ->> 'primaryNace2008Source' as primary_nace_2008_source,
    rule.match_value as winning_match_value,
    coalesce((
      select bool_or(
        code like rule.match_value || '%'
        and length(regexp_replace(code, '[^0-9]', '', 'g')) >= 4
      )
      from unnest(result.primary_nace_codes) code
    ), false) as has_precise_matching_primary_nace,
    coalesce(
      profile.metadata ->> 'primaryNace2025Source' = 'czNacePrevazujici'
        and profile.primary_nace_2025_code like rule.match_value || '%',
      false
    ) or coalesce(
      profile.metadata ->> 'primaryNace2008Source' = 'czNacePrevazujici2008'
        and profile.primary_nace_2008_code like rule.match_value || '%',
      false
    ) as has_prevailing_matching_primary_nace,
    coalesce(
      profile.metadata ->> 'primaryNace2025Source' = 'firstCzNace'
        and profile.primary_nace_2025_code like rule.match_value || '%',
      false
    ) or coalesce(
      profile.metadata ->> 'primaryNace2008Source' = 'firstCzNace2008'
        and profile.primary_nace_2008_code like rule.match_value || '%',
      false
    ) as has_fallback_matching_primary_nace
  from public.complete_power_outage_operational_sensitivity_shadow_results result
  join latest_run on latest_run.run_id = result.run_id
  left join public.complete_power_outage_company_profiles profile
    on profile.ico = result.ico
  left join public.complete_power_outage_operational_sensitivity_rules rule
    on rule.rule_key = result.winning_rule_key
  where result.is_eligible
), flagged as (
  select
    eligible.*,
    array_remove(array[
      case
        when coalesce(eligible.is_in_liquidation, false)
          or coalesce(eligible.is_terminated, false)
          or eligible.company_name ~* 'v[[:space:]]+likvidaci'
          or eligible.official_name ~* 'v[[:space:]]+likvidaci'
          then 'inactive_or_liquidated_subject'
      end,
      case
        when eligible.decision_source = 'company_name'
          then 'company_name_is_only_direct_evidence'
      end,
      case
        when eligible.decision_source = 'ares_primary_nace'
          and not eligible.has_precise_matching_primary_nace
          then 'imprecise_primary_nace'
      end,
      case
        when eligible.decision_source = 'ares_primary_nace'
          and eligible.has_fallback_matching_primary_nace
          and not eligible.has_prevailing_matching_primary_nace
          then 'winning_nace_is_fallback_not_prevailing'
      end,
      case
        when eligible.decision_source = 'mapy_exact_label'
          and eligible.ico is null
          then 'mapy_entity_without_ico'
      end
    ]::text[], null) as risk_codes
  from eligible
)
select
  flagged.company_name,
  flagged.ico,
  flagged.outage_source,
  flagged.starts_at,
  flagged.ends_at,
  flagged.category,
  flagged.decision_source,
  flagged.winning_rule_key,
  flagged.primary_nace_codes,
  flagged.primary_nace_2025_code,
  flagged.primary_nace_2025_source,
  flagged.primary_nace_2008_code,
  flagged.primary_nace_2008_source,
  flagged.employee_count_min,
  flagged.exact_mapy_labels,
  flagged.subject_status,
  flagged.risk_codes
from flagged
where cardinality(flagged.risk_codes) > 0
order by flagged.risk_codes, flagged.company_name, flagged.starts_at;
