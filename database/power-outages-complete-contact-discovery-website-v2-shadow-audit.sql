with prepared_batch as (
  select nullif(state_row.metadata ->> 'preparedBatchId', '')::uuid as batch_id
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton
), expected as (
  select count(distinct queue_row.ico)::bigint as item_count
  from prepared_batch
  join public.complete_power_outage_contact_discovery_queue queue_row
    on queue_row.origin_batch_id = prepared_batch.batch_id
  where queue_row.company_profile_id is not null
), function_contract as (
  select
    pg_get_functiondef(
      'public.finish_complete_power_outage_contact_discovery_website_v2(text,uuid,text,text,text,text,numeric,text[],text[],jsonb,text,text,boolean)'::regprocedure
    ) as finish_definition,
    pg_get_functiondef(
      'public.claim_complete_power_outage_contact_discovery_website_v2()'::regprocedure
    ) as claim_definition
), checks as (
  select 'CRON'::text as check_type,
    'official website v2 SHADOW every fifteen seconds'::text as object_name,
    count(*) = 1 as is_correct
  from cron.job
  where jobname = 'complete_contact_discovery_websites_v2_every_fifteen_seconds'
    and schedule = '15 seconds'

  union all
  select 'CRON', 'obsolete official website discovery schedules are absent',
    count(*) = 0
  from cron.job
  where jobname in (
    'complete_contact_discovery_websites_every_minute',
    'complete_contact_discovery_websites_every_fifteen_seconds'
  )

  union all
  select 'DATA', 'v2 SHADOW contains the complete prepared batch',
    (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results)
      = (select item_count from expected)

  union all
  select 'DATA', 'v2 SHADOW contains no duplicate ICO',
    count(*) = count(distinct ico)
  from public.complete_power_outage_contact_discovery_website_v2_results

  union all
  select 'DATA', 'v2 SHADOW profiles belong to the same ICO',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v2_results result_row
      left join public.complete_power_outage_company_profiles profile
        on profile.id = result_row.company_profile_id
       and profile.ico = result_row.ico
      where profile.id is null
    )

  union all
  select 'DATA', 'verified v2 results contain strict first-party evidence',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_website_v2_results result_row
      where result_row.result_status in ('verified_company', 'verified_group')
        and (
          result_row.confidence < 0.9
          or result_row.candidate_url !~* '^https?://'
          or nullif(btrim(result_row.normalized_domain), '') is null
          or not ('same_domain_email' = any(result_row.verification_methods))
        )
    )

  union all
  select 'FUNCTION', 'controlled official website v2 SHADOW claim',
    to_regprocedure('public.claim_complete_power_outage_contact_discovery_website_v2()') is not null

  union all
  select 'FUNCTION', 'controlled official website v2 SHADOW completion',
    to_regprocedure('public.finish_complete_power_outage_contact_discovery_website_v2(text,uuid,text,text,text,text,numeric,text[],text[],jsonb,text,text,boolean)') is not null

  union all
  select 'FUNCTION', 'safe official website v2 SHADOW pause',
    to_regprocedure('public.pause_complete_power_outage_contact_discovery_website_v2()') is not null

  union all
  select 'GRANT', 'authenticated cannot run or inspect website v2 SHADOW',
    not has_function_privilege('authenticated', 'public.claim_complete_power_outage_contact_discovery_website_v2()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_complete_power_outage_contact_discovery_website_v2(text,uuid,text,text,text,text,numeric,text[],text[],jsonb,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.request_complete_power_outage_contact_discovery_website_v2()', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_contact_discovery_website_v2_results', 'SELECT,INSERT,UPDATE,DELETE')

  union all
  select 'ISOLATION', 'website v2 SHADOW stays in COMPLETE scope',
    function_contract.claim_definition not ilike '%market_power_outage%'
    and function_contract.finish_definition not ilike '%market_power_outage%'
  from function_contract

  union all
  select 'LOGIC', 'only one website v2 lookup can be processing',
    count(*) <= 1
  from public.complete_power_outage_contact_discovery_website_v2_results
  where result_status = 'processing'

  union all
  select 'LOGIC', 'v2 completion cannot write official website production data',
    function_contract.finish_definition not ilike '%complete_power_outage_company_websites%'
    and function_contract.finish_definition not ilike '%complete_power_outage_company_contacts%'
  from function_contract

  union all
  select 'SAFETY', 'v2 database completion does not mutate v1 results',
    function_contract.finish_definition not ilike '%complete_power_outage_contact_discovery_queue%'
    and function_contract.finish_definition not ilike '%complete_power_outage_company_websites%'
  from function_contract

  union all
  select 'SAFETY', 'contact extraction UI and all email phases remain disabled',
    not contact_extraction_enabled
    and not ui_enabled
    and not email_planning_enabled
    and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'official website v2 SHADOW is active while v1 worker is paused',
    discovery_enabled
    and website_verification_v2_enabled
    and not website_lookup_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'TABLE', 'official website v2 results remain isolated',
    to_regclass('public.complete_power_outage_contact_discovery_website_v2_results') is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
