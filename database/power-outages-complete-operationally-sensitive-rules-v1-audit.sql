with checks(check_type, object_name, is_correct) as (
  values
    ('TABLE', 'private operational sensitivity state exists',
      to_regclass('public.complete_power_outage_operational_sensitivity_state') is not null),
    ('TABLE', 'private operational sensitivity rule matrix exists',
      to_regclass('public.complete_power_outage_operational_sensitivity_rules') is not null),
    ('RLS', 'operational sensitivity private tables have row level security',
      coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_operational_sensitivity_state'::regclass), false)
      and coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_operational_sensitivity_rules'::regclass), false)),
    ('GRANT', 'authenticated cannot enumerate operational sensitivity rules',
      not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_state', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_rules', 'SELECT')),
    ('LOGIC', 'missing Mapy evidence is explicitly neutral',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and not mapy_absence_is_negative
          and metadata ->> 'missingMapyDisposition' = 'neutral'
      )),
    ('LOGIC', 'unknown employee size is not negative',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and not unknown_employee_size_is_negative
      )),
    ('LOGIC', 'ARES rules never require Mapy evidence',
      not exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where evidence_source in ('ares_primary_nace', 'ares_any_nace')
          and requires_mapy_evidence
      )),
    ('LOGIC', 'Mapy rules require exact site evidence',
      not exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where evidence_source = 'mapy_exact_label'
          and not requires_exact_site_evidence
      )),
    ('LOGIC', 'automotive manufacturing is included and automotive service excluded',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where rule_key = 'nace-primary-automotive-29' and effect = 'include'
      ) and exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where rule_key in ('nace-primary-auto-repair-452', 'nace-primary-new-auto-repair-9531')
          and effect = 'exclude'
      )),
    ('LOGIC', 'small outpatient practices are explicitly excluded',
      (select count(*) = 3
       from public.complete_power_outage_operational_sensitivity_rules
       where rule_key in (
         'nace-primary-general-practice-8621',
         'nace-primary-specialist-practice-8622',
         'nace-primary-dental-practice-8623'
       ) and effect = 'exclude')), 
    ('LOGIC', 'critical public services have explicit inclusion exceptions',
      (select count(*) = 2
       from public.complete_power_outage_operational_sensitivity_rules
       where rule_key in ('nace-primary-police-8424', 'nace-primary-fire-8425')
         and effect = 'include' and priority > 780)),
    ('LOGIC', 'secondary NACE never directly qualifies a company',
      not exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where evidence_source = 'ares_any_nace'
          and effect <> 'support'
      )),
    ('LOGIC', 'classification remains automatic without manual review',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and not manual_review_required
      )),
    ('ISOLATION', 'rule matrix uses no Google evidence source',
      not exists (
        select 1 from public.complete_power_outage_operational_sensitivity_rules
        where evidence_source like 'google%'
      )),
    ('SAFETY', 'step two leaves SHADOW selector and UI disabled',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and rules_prepared
          and not shadow_enabled and not selector_enabled and not ui_enabled
      )),
    ('SAFETY', 'step two leaves contacts and notifications disabled',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and not contact_selector_enabled and not notification_selector_enabled
      )),
    ('STATE', 'operational sensitivity rules version one is prepared',
      exists (
        select 1 from public.complete_power_outage_operational_sensitivity_state
        where singleton and rules_version = 1 and rules_prepared
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
