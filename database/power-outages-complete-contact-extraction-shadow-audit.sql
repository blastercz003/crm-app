with function_contract as (
  select
    pg_get_functiondef(
      'public.claim_complete_power_outage_contact_extraction_shadow()'::regprocedure
    ) as claim_definition,
    pg_get_functiondef(
      'public.finish_complete_power_outage_contact_extraction_shadow(text,uuid,text,jsonb,jsonb,text,text,boolean)'::regprocedure
    ) as finish_definition
), checks as (
  select 'CRON'::text as check_type,
    'contact extraction SHADOW every fifteen seconds'::text as object_name,
    count(*) = 1 and min(schedule) = '15 seconds' as is_correct
  from cron.job
  where jobname = 'complete_contact_extraction_shadow_every_fifteen_seconds'

  union all
  select 'DATA', 'automatic extraction queue contains every verified v3 company',
    (
      select count(*)
      from public.complete_power_outage_contact_extraction_shadow_queue
      where authorization_source = 'automatic_v3'
    ) = (
      select count(*)
      from public.complete_power_outage_contact_discovery_website_v3_results
      where result_status = 'verified_company'
    )

  union all
  select 'DATA', 'automatic extraction queue contains only verified v3 companies',
    not exists (
      select 1
      from public.complete_power_outage_contact_extraction_shadow_queue queue_row
      left join public.complete_power_outage_contact_discovery_website_v3_results v3
        on v3.ico = queue_row.ico
       and v3.company_profile_id = queue_row.company_profile_id
       and v3.candidate_url = queue_row.website_url
       and v3.normalized_domain = queue_row.normalized_domain
       and v3.result_status = 'verified_company'
      where queue_row.authorization_source = 'automatic_v3'
        and v3.ico is null
    )

  union all
  select 'DATA', 'manual domain decision history starts empty',
    count(*) = 0
  from public.complete_power_outage_contact_domain_review_decisions

  union all
  select 'DATA', 'SHADOW contacts belong to their queued company and domain',
    not exists (
      select 1
      from public.complete_power_outage_contact_extraction_shadow_results result_row
      left join public.complete_power_outage_contact_extraction_shadow_queue queue_row
        on queue_row.ico = result_row.ico
       and queue_row.company_profile_id = result_row.company_profile_id
       and queue_row.normalized_domain = result_row.normalized_domain
      where queue_row.ico is null
    )

  union all
  select 'FUNCTION', 'controlled contact extraction SHADOW capture',
    to_regprocedure('public.capture_complete_power_outage_contact_extraction_shadow()') is not null

  union all
  select 'FUNCTION', 'controlled contact extraction SHADOW claim',
    to_regprocedure('public.claim_complete_power_outage_contact_extraction_shadow()') is not null

  union all
  select 'FUNCTION', 'controlled contact extraction SHADOW completion',
    to_regprocedure(
      'public.finish_complete_power_outage_contact_extraction_shadow(text,uuid,text,jsonb,jsonb,text,text,boolean)'
    ) is not null

  union all
  select 'GRANT', 'authenticated cannot inspect or mutate SHADOW contacts',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_extraction_shadow_queue',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_extraction_shadow_results',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_domain_review_decisions',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.claim_complete_power_outage_contact_extraction_shadow()',
      'EXECUTE'
    )

  union all
  select 'ISOLATION', 'contact extraction SHADOW stays in COMPLETE scope',
    function_contract.claim_definition not ilike '%market_power_outage%'
      and function_contract.finish_definition not ilike '%market_power_outage%'
  from function_contract

  union all
  select 'ISOLATION', 'contact extraction does not block replacement of v3 results',
    not exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.contype = 'f'
        and constraint_row.conrelid in (
          'public.complete_power_outage_contact_domain_review_decisions'::regclass,
          'public.complete_power_outage_contact_extraction_shadow_queue'::regclass
        )
        and constraint_row.confrelid
          = 'public.complete_power_outage_contact_discovery_website_v3_results'::regclass
    )

  union all
  select 'LOGIC', 'only one contact extraction item can be processing',
    count(*) <= 1
  from public.complete_power_outage_contact_extraction_shadow_queue
  where queue_status = 'processing'

  union all
  select 'LOGIC', 'manual domain decision history is immutable',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid
        = 'public.complete_power_outage_contact_domain_review_decisions'::regclass
        and trigger_row.tgname = 'cpo_contact_domain_review_decisions_immutable'
        and not trigger_row.tgisinternal
        and trigger_row.tgenabled <> 'D'
    )

  union all
  select 'LOGIC', 'personal e-mails are explicitly flagged for review',
    not exists (
      select 1
      from public.complete_power_outage_contact_extraction_shadow_results
      where contact_type = 'email'
        and is_personal
        and not ('possible_personal_contact' = any(review_flags))
    )

  union all
  select 'LOGIC', 'contact extraction stores only Czech normalized phones',
    not exists (
      select 1
      from public.complete_power_outage_contact_extraction_shadow_results
      where contact_type = 'phone'
        and normalized_value !~ '^\+420[1-9][0-9]{8}$'
    )

  union all
  select 'SAFETY', 'production company contacts remain unchanged',
    coalesce((
      select (metadata ->> 'productionContactCountAtShadowActivation')::bigint
        = (select count(*) from public.complete_power_outage_company_contacts)
      from public.complete_power_outage_contact_discovery_state
      where singleton
    ), false)

  union all
  select 'SAFETY', 'SHADOW completion cannot write production contacts or websites',
    function_contract.finish_definition not ilike '%complete_power_outage_company_contacts%'
      and function_contract.finish_definition not ilike '%complete_power_outage_company_websites%'
  from function_contract

  union all
  select 'SAFETY', 'contact extraction UI planning and dispatch remain disabled',
    contact_extraction_shadow_enabled
      and not contact_extraction_enabled
      and not ui_enabled
      and not email_planning_enabled
      and not email_dispatch_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'contact extraction SHADOW is active',
    contact_extraction_shadow_enabled and website_verification_v3_enabled
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'TABLE', 'auditable manual domain decisions are prepared',
    to_regclass('public.complete_power_outage_contact_domain_review_decisions') is not null

  union all
  select 'TABLE', 'isolated contact extraction SHADOW queue and results exist',
    to_regclass('public.complete_power_outage_contact_extraction_shadow_queue') is not null
      and to_regclass('public.complete_power_outage_contact_extraction_shadow_results') is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
