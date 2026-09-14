with latest_shadow as (
  select state.latest_shadow_run_id
  from public.complete_power_outage_operational_sensitivity_state state
  where state.singleton
), checks(check_type, object_name, is_correct) as (
  values
    ('TABLE', 'fast operational sensitivity membership projection exists',
      to_regclass('public.complete_power_outage_operational_sensitivity_membership_v3') is not null),
    ('DATA', 'published membership contains every still current approved SHADOW v3 result',
      not exists (
        select result.candidate_id
        from latest_shadow state
        join public.complete_power_outage_operational_sensitivity_shadow_results result
          on result.run_id = state.latest_shadow_run_id
        join public.complete_power_outage_companies company
          on company.id = result.candidate_id
         and company.candidate_status = 'confirmed'
         and company.business_relevance_status = 'eligible'
        join public.complete_power_outage_addresses address
          on address.id = company.outage_address_id
        join public.complete_power_outages outage
          on outage.id = address.outage_id
         and outage.ends_at >= now()
         and outage.source_status in ('scheduled', 'active')
        where result.is_eligible
        except
        select membership.candidate_id
        from public.complete_power_outage_operational_sensitivity_membership_v3 membership
      )),
    ('DATA', 'published membership contains no duplicate candidate',
      not exists (
        select candidate_id
        from public.complete_power_outage_operational_sensitivity_membership_v3
        group by candidate_id having count(*) > 1
      )),
    ('FUNCTION', 'automatic membership refresh exists',
      to_regprocedure('public.refresh_complete_power_outage_operational_sensitivity_membership_v3()') is not null),
    ('LOGIC', 'selector membership uses fast projection instead of live full classifier',
      pg_get_functiondef('public.complete_power_outage_is_operationally_sensitive_v3(uuid)'::regprocedure)
        ilike '%complete_power_outage_operational_sensitivity_membership_v3%'
      and pg_get_functiondef('public.complete_power_outage_is_operationally_sensitive_v3(uuid)'::regprocedure)
        not ilike '%classify_complete_power_outage_operational_sensitivity_v3%'),
    ('CRON', 'operational sensitivity membership refresh runs every five minutes',
      exists (
        select 1 from cron.job
        where jobname = 'complete-operational-sensitivity-membership-v3-refresh'
          and schedule = '*/5 * * * *'
          and active
      )),
    ('RLS', 'fast operational sensitivity membership has row level security',
      coalesce((
        select relrowsecurity from pg_class
        where oid = 'public.complete_power_outage_operational_sensitivity_membership_v3'::regclass
      ), false)),
    ('GRANT', 'authenticated cannot inspect or refresh operational membership',
      not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_membership_v3', 'SELECT')
      and not has_function_privilege('authenticated', 'public.refresh_complete_power_outage_operational_sensitivity_membership_v3()', 'EXECUTE')),
    ('SAFETY', 'membership refresh performs no external request or email change',
      coalesce((
        select (metadata ->> 'externalRequestMade')::boolean = false
          and (metadata ->> 'emailRuntimeChanged')::boolean = false
        from public.complete_power_outage_operational_sensitivity_state
        where singleton
      ), false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
