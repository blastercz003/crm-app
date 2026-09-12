with function_contract as (
  select pg_get_functiondef(
    'public.refresh_complete_power_outage_contact_classification_v2_shadow()'::regprocedure
  ) as definition
), checks as (
  select 'CRON'::text as check_type,
    'local contact classification v2 every minute'::text as object_name,
    count(*) = 1 and min(schedule) = '* * * * *' as is_correct
  from cron.job
  where jobname = 'complete_contact_classification_v2_shadow_every_minute'

  union all
  select 'DATA', 'every extracted SHADOW contact is classified exactly once',
    (select count(*) from public.complete_power_outage_contact_classification_v2_shadow)
      = (select count(*) from public.complete_power_outage_contact_extraction_shadow_results)
    and not exists (
      select 1
      from public.complete_power_outage_contact_extraction_shadow_results result_row
      left join public.complete_power_outage_contact_classification_v2_shadow classification
        on classification.shadow_contact_id = result_row.id
      where classification.shadow_contact_id is null
    )

  union all
  select 'DATA', 'manual contact decision history starts empty',
    count(*) = 0
  from public.complete_power_outage_contact_review_decisions

  union all
  select 'FUNCTION', 'deterministic local contact classification v2 exists',
    to_regprocedure(
      'public.refresh_complete_power_outage_contact_classification_v2_shadow()'
    ) is not null

  union all
  select 'GRANT', 'authenticated cannot inspect or mutate classification data',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_classification_v2_shadow',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_review_decisions',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.refresh_complete_power_outage_contact_classification_v2_shadow()',
      'EXECUTE'
    )

  union all
  select 'ISOLATION', 'classification v2 stays in COMPLETE SHADOW scope',
    function_contract.definition not ilike '%market_power_outage%'
      and function_contract.definition not ilike '%complete_power_outage_company_contacts%'
  from function_contract

  union all
  select 'ISOLATION', 'contact decision history cannot block SHADOW result replacement',
    not exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid
        = 'public.complete_power_outage_contact_review_decisions'::regclass
        and constraint_row.contype = 'f'
        and constraint_row.confrelid
          = 'public.complete_power_outage_contact_extraction_shadow_results'::regclass
    )

  union all
  select 'LOGIC', 'automatic e-mails use only approved role classes',
    not exists (
      select 1
      from public.complete_power_outage_contact_classification_v2_shadow
      where notification_eligible
        and (
          contact_type <> 'email'
          or contact_class not in ('operations', 'general', 'commercial')
          or classification_status <> 'automatic'
        )
    )

  union all
  select 'LOGIC', 'personal administrative and sensitive e-mails require review',
    not exists (
      select 1
      from public.complete_power_outage_contact_classification_v2_shadow
      where contact_type = 'email'
        and contact_class in ('personal', 'administrative', 'sensitive', 'unknown')
        and (classification_status <> 'needs_review' or notification_eligible)
    )

  union all
  select 'LOGIC', 'approved functional aliases are no longer personal',
    not exists (
      select 1
      from public.complete_power_outage_contact_classification_v2_shadow
      where split_part(normalized_value, '@', 1) in (
        'poptavky',
        'okna.priprava',
        'vysavace.odsavace',
        'alucomposite',
        'modrylom'
      )
        and contact_class not in ('operations', 'commercial')
    )

  union all
  select 'LOGIC', 'HTTP contacts remain eligible under approved policy',
    not exists (
      select 1
      from public.complete_power_outage_contact_classification_v2_shadow
      where contact_type = 'email'
        and contact_class in ('operations', 'general', 'commercial')
        and transport_security = 'http'
        and not notification_eligible
    )

  union all
  select 'LOGIC', 'phones are retained for display but never email automation',
    not exists (
      select 1
      from public.complete_power_outage_contact_classification_v2_shadow
      where contact_type = 'phone'
        and (classification_status <> 'informational' or notification_eligible)
    )

  union all
  select 'LOGIC', 'each company has at most one primary e-mail and phone',
    not exists (
      select ico, contact_type
      from public.complete_power_outage_contact_classification_v2_shadow
      where is_primary
      group by ico, contact_type
      having count(*) > 1
    )

  union all
  select 'LOGIC', 'every company with an eligible e-mail has one primary e-mail',
    not exists (
      select ico
      from public.complete_power_outage_contact_classification_v2_shadow
      where contact_type = 'email'
      group by ico
      having bool_or(notification_eligible)
        and count(*) filter (where is_primary) <> 1
    )

  union all
  select 'LOGIC', 'every company with a phone has one primary phone',
    not exists (
      select ico
      from public.complete_power_outage_contact_classification_v2_shadow
      where contact_type = 'phone'
      group by ico
      having count(*) filter (where is_primary) <> 1
    )

  union all
  select 'SAFETY', 'classification v2 makes no external requests',
    function_contract.definition not ilike '%http_get%'
      and function_contract.definition not ilike '%http_post%'
      and function_contract.definition not ilike '%brave%'
  from function_contract

  union all
  select 'SAFETY', 'classification v2 leaves production contacts unchanged',
    coalesce(
      (metadata ->> 'productionContactCountAtShadowActivation')::bigint
        = (select count(*) from public.complete_power_outage_company_contacts),
      false
    )
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'SAFETY', 'contact management planning and dispatch remain disabled',
    not contact_extraction_enabled
      and not email_planning_enabled
      and not email_dispatch_enabled
      and not coalesce((metadata ->> 'contactManagementUiEnabled')::boolean, false)
      and not coalesce((metadata ->> 'contactReviewDecisionUiEnabled')::boolean, false)
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'contact classification shadow version two is recorded',
    (metadata ->> 'contactClassificationShadowVersion')::integer = 2
      and metadata ->> 'contactClassificationShadowRevision' = '2.1'
      and (metadata ->> 'contactClassificationExternalRequests')::integer = 0
      and (metadata ->> 'contactClassificationProductionContactsPersisted')::boolean = false
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'STATE', 'contact review defaults to actionable companies only',
    metadata ->> 'contactReviewDefaultScope' = 'companies_without_automatic_email'
      and metadata ->> 'personalContactsDefaultVisibility' = 'collapsed'
  from public.complete_power_outage_contact_discovery_state
  where singleton

  union all
  select 'TABLE', 'immutable manual contact decisions are prepared',
    to_regclass('public.complete_power_outage_contact_review_decisions') is not null
      and exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.complete_power_outage_contact_review_decisions'::regclass
          and tgname = 'cpo_contact_review_decisions_immutable'
          and not tgisinternal
          and tgenabled <> 'D'
      )

  union all
  select 'TABLE', 'versioned contact classification v2 SHADOW exists',
    to_regclass(
      'public.complete_power_outage_contact_classification_v2_shadow'
    ) is not null
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

-- Vysledkove rozdeleni po nasazeni.
select
  contact_type,
  contact_class,
  classification_status,
  notification_eligible,
  count(*)::bigint as contact_count,
  count(distinct ico)::bigint as company_count
from public.complete_power_outage_contact_classification_v2_shadow
group by contact_type, contact_class, classification_status, notification_eligible
order by contact_type, classification_status, contact_class;
