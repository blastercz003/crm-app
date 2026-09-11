with expected as (
  select
    selector_row.selector_key,
    company.ico
  from public.complete_power_outage_contact_discovery_selectors selector_row
  join public.complete_power_outage_companies company
    on company.candidate_status = 'confirmed'
   and company.business_relevance_status = 'eligible'
   and company.ico is not null
   and company.ico ~ '^[0-9]{8}$'
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  left join public.complete_power_outage_top_selection_versions top_version
    on top_version.version_key = selector_row.selection_version_key
  where selector_row.lifecycle_status = 'active'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
    and (
      selector_row.commercial_filter = 'all'
      or selector_row.commercial_filter = 'grade_a'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
      or selector_row.commercial_filter = 'grade_b'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'B'
      or selector_row.commercial_filter = 'top'
        and top_version.lifecycle_status in ('active', 'archived')
        and top_row.rules_version = top_version.internal_rules_version
        and top_row.evaluation_status = 'eligible'
        and top_row.top_eligible
    )
  group by selector_row.selector_key, company.ico
), checks as (
  select 'DATA'::text as check_type,
    'four initial selectors are supported by adapter'::text as object_name,
    (
      select count(*) = 4
        and bool_and(commercial_filter in ('top', 'grade_a', 'grade_b', 'all'))
      from public.complete_power_outage_contact_discovery_selectors
      where lifecycle_status = 'active'
        and selector_key in ('top_v1', 'grade_a', 'grade_b', 'all_confirmed')
    ) as is_correct
  union all
  select 'DATA', 'selector target rows are unique by selector and ICO',
    not exists (
      select selector_key, ico
      from public.complete_power_outage_contact_discovery_selector_targets
      group by selector_key, ico
      having count(*) > 1
    )
  union all
  select 'DATA', 'selector adapter matches current AI SELECT contracts',
    not exists (
      select selector_key, ico from expected
      except
      select selector_key, ico
      from public.complete_power_outage_contact_discovery_selector_targets
    )
    and not exists (
      select selector_key, ico
      from public.complete_power_outage_contact_discovery_selector_targets
      except
      select selector_key, ico from expected
    )
  union all
  select 'DATA', 'company profiles are joined only by the same ICO',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_selector_targets target
      join public.complete_power_outage_company_profiles profile
        on profile.id = target.company_profile_id
      where profile.ico is distinct from target.ico
    )
  union all
  select 'VIEW', 'contact discovery selector adapter exists',
    to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is not null
  union all
  select 'GRANT', 'authenticated cannot enumerate contact discovery targets',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_discovery_selector_targets',
      'SELECT'
    )
    and has_table_privilege(
      'service_role',
      'public.complete_power_outage_contact_discovery_selector_targets',
      'SELECT'
    )
  union all
  select 'ISOLATION', 'contact discovery selector stays in COMPLETE scope',
    position('market_power_outage' in lower(pg_get_viewdef(
      'public.complete_power_outage_contact_discovery_selector_targets'::regclass,
      true
    ))) = 0
    and position('store_power_outage' in lower(pg_get_viewdef(
      'public.complete_power_outage_contact_discovery_selector_targets'::regclass,
      true
    ))) = 0
  union all
  select 'LOGIC', 'all confirmed contains every narrower selector target',
    not exists (
      select target.ico
      from public.complete_power_outage_contact_discovery_selector_targets target
      where target.selector_key in ('top_v1', 'grade_a', 'grade_b')
      except
      select target.ico
      from public.complete_power_outage_contact_discovery_selector_targets target
      where target.selector_key = 'all_confirmed'
    )
  union all
  select 'LOGIC', 'selector targets contain confirmed current firms only',
    not exists (
      select 1
      from public.complete_power_outage_contact_discovery_selector_targets target
      where not exists (
        select 1
        from public.complete_power_outage_companies company
        join public.complete_power_outage_addresses address
          on address.id = company.outage_address_id
        join public.complete_power_outages outage
          on outage.id = address.outage_id
        where company.ico = target.ico
          and company.candidate_status = 'confirmed'
          and company.business_relevance_status = 'eligible'
          and outage.ends_at >= now()
          and outage.source_status in ('scheduled', 'active')
      )
    )
  union all
  select 'LOGIC', 'published TOP selector is version bound',
    not exists (
      select target.ico
      from public.complete_power_outage_contact_discovery_selector_targets target
      where target.selector_key = 'top_v1'
        and not exists (
          select 1
          from public.complete_power_outage_companies company
          join public.complete_power_outage_company_top_selections top_row
            on top_row.candidate_id = company.id
          join public.complete_power_outage_top_selection_versions top_version
            on top_version.version_key = target.selection_version_key
          join public.complete_power_outage_addresses address
            on address.id = company.outage_address_id
          join public.complete_power_outages outage
            on outage.id = address.outage_id
          where company.ico = target.ico
            and company.candidate_status = 'confirmed'
            and company.business_relevance_status = 'eligible'
            and outage.ends_at >= now()
            and outage.source_status in ('scheduled', 'active')
            and top_row.rules_version = top_version.internal_rules_version
            and top_row.evaluation_status = 'eligible'
            and top_row.top_eligible
        )
    )
  union all
  select 'LOGIC', 'selector output is dynamic and includes future matching firms',
    exists (
      select 1
      from pg_class relation
      where relation.oid =
        'public.complete_power_outage_contact_discovery_selector_targets'::regclass
        and relation.relkind = 'v'
    )
  union all
  select 'SAFETY', 'contact discovery remains fully disabled',
    exists (
      select 1
      from public.complete_power_outage_contact_discovery_state
      where singleton
        and not discovery_enabled
        and not website_lookup_enabled
        and not contact_extraction_enabled
        and not ui_enabled
        and not email_planning_enabled
        and not email_dispatch_enabled
    )
  union all
  select 'SAFETY', 'selector step creates no discovery queue or worker',
    to_regclass('public.complete_power_outage_contact_discovery_queue') is null
    and to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is null
    and to_regprocedure('public.request_complete_power_outage_contact_discovery(integer)') is null
  union all
  select 'SAFETY', 'selector step creates no contact discovery cron',
    not exists (
      select 1
      from cron.job
      where lower(coalesce(command, '')) like
        '%complete_power_outage_contact_discovery%'
    )
  union all
  select 'SAFETY', 'selector step does not create website evidence or contacts',
    (select count(*) from public.complete_power_outage_company_websites) = 0
    and not exists (
      select 1
      from public.complete_power_outage_company_contacts
      where source_registry in ('official_website', 'official_branch_website')
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
