with function_contract as (
  select pg_get_functiondef(
    'public.refresh_complete_power_outage_contact_discovery_website_v3()'::regprocedure
  ) as definition
), checks as (
  select 'CRON'::text as check_type,
    'paid website v2 schedule is paused after v3 snapshot'::text as object_name,
    count(*) = 0 as is_correct
  from cron.job
  where jobname = 'complete_contact_discovery_websites_v2_every_fifteen_seconds'

  union all
  select 'DATA', 'v3 SHADOW contains every v2 result',
    (select count(*) from public.complete_power_outage_contact_discovery_website_v3_results)
      = (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results)

  union all
  select 'DATA', 'v3 SHADOW contains no duplicate ICO',
    count(*) = count(distinct ico)
  from public.complete_power_outage_contact_discovery_website_v3_results

  union all
  select 'DATA', 'verified v3 results satisfy every first-party guard',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v3_results
      where result_status = 'verified_company'
        and (
          not exact_ico_evidence
          or not same_domain_email_evidence
          or not first_party_domain_match
          or shared_domain_count <> 1
          or cardinality(decision_codes) <> 0
        )
    )

  union all
  select 'FUNCTION', 'deterministic website v3 evaluator exists',
    to_regprocedure('public.refresh_complete_power_outage_contact_discovery_website_v3()') is not null

  union all
  select 'GRANT', 'authenticated cannot inspect or recalculate website v3',
    not has_function_privilege(
      'authenticated',
      'public.refresh_complete_power_outage_contact_discovery_website_v3()',
      'EXECUTE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_discovery_website_v3_results',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_discovery_domain_policies',
      'SELECT,INSERT,UPDATE,DELETE'
    )

  union all
  select 'ISOLATION', 'website v3 remains in COMPLETE scope',
    function_contract.definition not ilike '%market_power_outage%'
  from function_contract

  union all
  select 'LOGIC', 'known third-party domains are never v3 verified',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v3_results v3
      join public.complete_power_outage_contact_discovery_domain_policies policy
        on v3.normalized_domain = policy.normalized_domain
          or v3.normalized_domain like '%.' || policy.normalized_domain
      where policy.policy_type = 'third_party_directory'
        and v3.result_status = 'verified_company'
    )

  union all
  select 'LOGIC', 'shared domains are never v3 verified',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v3_results
      where shared_domain_count > 1 and result_status = 'verified_company'
    )

  union all
  select 'LOGIC', 'missing exact ICO evidence is never v3 verified',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v3_results
      where not exact_ico_evidence and result_status = 'verified_company'
    )

  union all
  select 'LOGIC', 'v3 never promotes an unverified v2 result',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v3_results
      where v2_result_status not in ('verified_company', 'verified_group')
        and result_status = 'verified_company'
    )

  union all
  select 'SAFETY', 'website v3 makes no external requests',
    function_contract.definition not ilike '%net.http%'
      and function_contract.definition not ilike '%brave%'
  from function_contract

  union all
  select 'SAFETY', 'contact extraction UI and email phases remain disabled',
    not contact_extraction_enabled
      and not ui_enabled
      and not email_planning_enabled
      and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'SAFETY', 'v1 and v2 result tables remain unchanged by evaluator',
    function_contract.definition not ilike '%update public.complete_power_outage_contact_discovery_website_v2_results%'
      and function_contract.definition not ilike '%delete from public.complete_power_outage_contact_discovery_website_v2_results%'
      and function_contract.definition not ilike '%update public.complete_power_outage_contact_discovery_queue%'
  from function_contract

  union all
  select 'STATE', 'website v3 SHADOW is active',
    website_verification_v3_enabled
      and not website_verification_v2_enabled
      and not website_lookup_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'TABLE', 'versioned website v3 SHADOW results exist',
    to_regclass('public.complete_power_outage_contact_discovery_website_v3_results') is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
