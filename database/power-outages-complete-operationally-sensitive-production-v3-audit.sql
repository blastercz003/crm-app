with checks(check_type, object_name, is_correct) as (
  values
    ('STATE', 'operationally sensitive version three is active in the application',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and rules_version = 3 and rules_prepared
          and selector_enabled and ui_enabled
          and contact_selector_enabled and notification_selector_enabled
      )),
    ('FUNCTION', 'dynamic operationally sensitive selector exists',
      to_regprocedure('public.complete_power_outage_is_operationally_sensitive_v3(uuid)') is not null),
    ('FUNCTION', 'current page count and selection functions accept operationally sensitive',
      pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure)
        ilike '%operationally_sensitive%'
      and pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)'::regprocedure)
        ilike '%operationallySensitive%'),
    ('DATA', 'registered operationally sensitive selector is active',
      exists (
        select 1 from public.complete_power_outage_contact_discovery_selectors
        where selector_key = 'operationally_sensitive_v3'
          and commercial_filter = 'operationally_sensitive'
          and lifecycle_status = 'active'
      )),
    ('DATA', 'dynamic selector contains every current eligible ICO',
      not exists (
        select company.ico
        from public.complete_power_outage_companies company
        join public.complete_power_outage_addresses address on address.id = company.outage_address_id
        join public.complete_power_outages outage on outage.id = address.outage_id
        where company.candidate_status = 'confirmed'
          and company.business_relevance_status = 'eligible'
          and company.ico ~ '^[0-9]{8}$'
          and outage.ends_at >= now()
          and outage.source_status in ('scheduled', 'active')
          and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
        except
        select target.ico
        from public.complete_power_outage_contact_discovery_selector_targets target
        where target.selector_key = 'operationally_sensitive_v3'
      )),
    ('DATA', 'operationally sensitive contact selector contains no duplicate ICO',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_selector_targets
        where selector_key = 'operationally_sensitive_v3'
        group by ico having count(*) > 1
      )),
    ('LOGIC', 'operationally sensitive filter contains confirmed records only',
      not exists (
        select 1
        from public.complete_power_outage_companies company
        where company.candidate_status <> 'confirmed'
          and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
      )),
    ('LOGIC', 'missing Mapy evidence remains neutral',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and not mapy_absence_is_negative
      )),
    ('LOGIC', 'standard AI SELECT remains independent from client only scope',
      pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure)
        ilike '%coalesce(p_clients_only, false) and coalesce(client_match.is_client, false)%'),
    ('GRANT', 'authenticated cannot execute private operational sensitivity classifier',
      not has_function_privilege('authenticated', 'public.complete_power_outage_is_operationally_sensitive_v3(uuid)', 'EXECUTE')),
    ('GRANT', 'authenticated cannot query selector targets directly',
      not has_table_privilege('authenticated', 'public.complete_power_outage_contact_discovery_selector_targets', 'SELECT')),
    ('SAFETY', 'production activation does not change email runtime',
      coalesce((
        select (metadata ->> 'emailRuntimeChanged')::boolean = false
        from public.complete_power_outage_operational_sensitivity_state where singleton
      ), false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
