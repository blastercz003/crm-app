with checks as (
  select 'TABLE'::text as check_type,
    'official website evidence remains isolated'::text as object_name,
    not exists (
      select 1
      from public.complete_power_outage_company_websites website
      join public.complete_power_outage_contact_discovery_queue queue_row
        on queue_row.discovered_website_id = website.id
      where website.company_profile_id <> queue_row.company_profile_id
    ) as is_correct
  union all
  select 'DATA', 'website queue contains no duplicate ICO',
    count(*) = count(distinct ico)
    from public.complete_power_outage_contact_discovery_queue
  union all
  select 'DATA', 'verified website results reference verified evidence',
    not exists (
      select 1 from public.complete_power_outage_contact_discovery_queue queue_row
      left join public.complete_power_outage_company_websites website
        on website.id = queue_row.discovered_website_id
       and website.company_profile_id = queue_row.company_profile_id
      where queue_row.queue_status = 'website_ready'
        and (website.id is null or website.verification_status <> 'verified')
    )
  union all
  select 'LOGIC', 'review and missing website remain separate',
    not exists (
      select 1 from public.complete_power_outage_contact_discovery_queue
      where queue_status in ('needs_review', 'no_website')
        and discovered_website_id is not null
    )
  union all
  select 'LOGIC', 'only one website lookup can be processing',
    count(*) <= 1
    from public.complete_power_outage_contact_discovery_queue
    where queue_status = 'processing'
  union all
  select 'FUNCTION', 'controlled website discovery claim',
    to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is not null
  union all
  select 'FUNCTION', 'controlled website discovery completion',
    to_regprocedure('public.finish_complete_power_outage_contact_discovery_website(text,uuid,text,uuid,jsonb,text,text,boolean)') is not null
  union all
  select 'FUNCTION', 'safe website discovery pause',
    to_regprocedure('public.pause_complete_power_outage_contact_discovery_websites()') is not null
  union all
  select 'GRANT', 'authenticated cannot run website discovery worker',
    not has_function_privilege('authenticated', 'public.claim_complete_power_outage_contact_discovery(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_complete_power_outage_contact_discovery_website(text,uuid,text,uuid,jsonb,text,text,boolean)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.request_complete_power_outage_contact_discovery_websites()', 'EXECUTE')
  union all
  select 'ISOLATION', 'website discovery stays in COMPLETE scope',
    pg_get_functiondef('public.claim_complete_power_outage_contact_discovery(integer)'::regprocedure)
      not ilike '%market_power_outage%'
    and pg_get_functiondef('public.finish_complete_power_outage_contact_discovery_website(text,uuid,text,uuid,jsonb,text,text,boolean)'::regprocedure)
      not ilike '%market_power_outage%'
  union all
  select 'SAFETY', 'contact extraction remains disabled',
    not contact_extraction_enabled
    from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'SAFETY', 'email planning and dispatch remain disabled',
    not email_planning_enabled and not email_dispatch_enabled
    from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'SAFETY', 'contact discovery UI remains disabled',
    not ui_enabled
    from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'STATE', 'official website discovery is active',
    discovery_enabled and website_lookup_enabled
    from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'CRON', 'official website discovery every fifteen seconds',
    count(*) = 1
    from cron.job
    where jobname = 'complete_contact_discovery_websites_every_fifteen_seconds'
      and schedule = '15 seconds'
  union all
  select 'VIEW', 'official website discovery operational overview',
    to_regclass('public.complete_power_outage_contact_discovery_operational_overview') is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
