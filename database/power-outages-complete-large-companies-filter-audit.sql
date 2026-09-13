with checks(check_type, object_name, is_correct) as (
  values
    (
      'FUNCTION',
      'large company eligibility version one exists',
      to_regprocedure('public.complete_power_outage_is_large_company_v1(text)') is not null
    ),
    (
      'DATA',
      'large companies selector is active and registered',
      exists (
        select 1
        from public.complete_power_outage_contact_discovery_selectors selector_row
        where selector_row.selector_key = 'large_companies_v1'
          and selector_row.display_name = 'VELKÉ FIRMY'
          and selector_row.commercial_filter = 'large_companies'
          and selector_row.lifecycle_status = 'active'
      )
    ),
    (
      'LOGIC',
      'large companies require at least fifty employees',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_selector_targets target
        join public.complete_power_outage_company_profiles profile
          on profile.ico = target.ico
        where target.selector_key = 'large_companies_v1'
          and coalesce(
            public.complete_power_outage_employee_category_min(
              profile.employee_category_code
            ),
            0
          ) < 50
      )
    ),
    (
      'LOGIC',
      'unknown employee size is excluded',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_selector_targets target
        join public.complete_power_outage_company_profiles profile
          on profile.ico = target.ico
        where target.selector_key = 'large_companies_v1'
          and public.complete_power_outage_employee_category_min(
            profile.employee_category_code
          ) is null
      )
    ),
    (
      'LOGIC',
      'large companies use the approved legal form allowlist',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_selector_targets target
        join public.complete_power_outage_company_profiles profile
          on profile.ico = target.ico
        where target.selector_key = 'large_companies_v1'
          and btrim(coalesce(profile.legal_form, '')) <> all (
            array['111','112','113','121','205','301','421']::text[]
          )
      )
    ),
    (
      'LOGIC',
      'terminated or liquidated subjects are excluded',
      not exists (
        select 1
        from public.complete_power_outage_contact_discovery_selector_targets target
        join public.complete_power_outage_company_profiles profile
          on profile.ico = target.ico
        where target.selector_key = 'large_companies_v1'
          and (
            coalesce(profile.is_in_liquidation, false)
            or coalesce(profile.is_terminated, false)
          )
      )
    ),
    (
      'DATA',
      'dynamic selector contains every current eligible large company ICO',
      not exists (
        select 1
        from public.complete_power_outage_companies company
        join public.complete_power_outage_addresses address
          on address.id = company.outage_address_id
        join public.complete_power_outages outage
          on outage.id = address.outage_id
        where company.candidate_status = 'confirmed'
          and company.business_relevance_status = 'eligible'
          and company.ico ~ '^[0-9]{8}$'
          and outage.ends_at >= now()
          and outage.source_status in ('scheduled', 'active')
          and public.complete_power_outage_is_large_company_v1(company.ico)
          and not exists (
            select 1
            from public.complete_power_outage_contact_discovery_selector_targets target
            where target.selector_key = 'large_companies_v1'
              and target.ico = company.ico
          )
      )
    ),
    (
      'DATA',
      'dynamic selector contains no duplicate ICO',
      not exists (
        select target.ico
        from public.complete_power_outage_contact_discovery_selector_targets target
        where target.selector_key = 'large_companies_v1'
        group by target.ico
        having count(*) > 1
      )
    ),
    (
      'LOGIC',
      'current page and count functions accept large companies',
      position(
        '''large_companies'''
        in pg_get_functiondef(
          'public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure
        )
      ) > 0
      and position(
        '''large_companies'''
        in pg_get_functiondef(
          'public.count_complete_power_outage_companies_v3(text,text,text,text,text,text,text)'::regprocedure
        )
      ) > 0
      and position(
        '''large_companies'''
        in pg_get_functiondef(
          'public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
        )
      ) > 0
      and position(
        '''large_companies'''
        in pg_get_functiondef(
          'public.count_complete_power_outage_companies_v5(text,text,text,text,text,text,text,boolean)'::regprocedure
        )
      ) > 0
    ),
    (
      'LOGIC',
      'selection counts expose large companies',
      position(
        '''largeCompanies'''
        in pg_get_functiondef(
          'public.get_complete_power_outage_commercial_selection_counts_v2(text,text,text,text,text,text)'::regprocedure
        )
      ) > 0
      and position(
        '''largeCompanies'''
        in pg_get_functiondef(
          'public.get_complete_power_outage_commercial_selection_counts_v4(text,text,text,text,text,text,boolean)'::regprocedure
        )
      ) > 0
    ),
    (
      'LOGIC',
      'contact selector stays dynamic for future outages',
      position(
        'complete_power_outage_companies'
        in pg_get_viewdef(
          'public.complete_power_outage_contact_discovery_selector_targets'::regclass,
          true
        )
      ) > 0
      and position(
        'complete_power_outage_is_large_company_v1'
        in pg_get_viewdef(
          'public.complete_power_outage_contact_discovery_selector_targets'::regclass,
          true
        )
      ) > 0
    ),
    (
      'GRANT',
      'authenticated cannot execute private large company eligibility',
      not has_function_privilege(
        'authenticated',
        'public.complete_power_outage_is_large_company_v1(text)',
        'EXECUTE'
      )
    ),
    (
      'GRANT',
      'authenticated cannot enumerate contact selector targets',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_contact_discovery_selector_targets',
        'SELECT'
      )
    ),
    (
      'ISOLATION',
      'large companies stay in COMPLETE scope',
      position(
        'complete_power_outage_companies'
        in pg_get_viewdef(
          'public.complete_power_outage_contact_discovery_selector_targets'::regclass,
          true
        )
      ) > 0
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
