select *
from (values
  ('FUNCTION', 'automatic COMPLETE activity writers exist',
    to_regprocedure('public.activities_log_cpo_communication_event_v1()') is not null
    and to_regprocedure('public.activities_log_cpo_ownership_event_v1()') is not null),
  ('TRIGGER', 'communication and ownership events feed Activity history',
    exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_communication_events'::regclass
        and trigger_row.tgname = 'activities_cpo_communication_event_log'
        and not trigger_row.tgisinternal
    )
    and exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_company_ownership_events'::regclass
        and trigger_row.tgname = 'activities_cpo_ownership_event_log'
        and not trigger_row.tgisinternal
    )),
  ('LOGIC', 'Activity source contract accepts Monitoring outages',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.activities'::regclass
        and constraint_row.conname = 'activities_source_type_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%power_outage%'
    )),
  ('LOGIC', 'only meaningful user outage actions enter Activity history',
    pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      ilike '%new.actor_kind <> ''user''%'
    and pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      ilike '%automatic_email_sent%'
      = false),
  ('LOGIC', 'automatic outage activities are idempotent',
    pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      ilike '%on conflict%do nothing%'
    and pg_get_functiondef('public.activities_log_cpo_ownership_event_v1()'::regprocedure)
      ilike '%on conflict%do nothing%'),
  ('SAFETY', 'outage Activity history stores no communication body or contact person',
    pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      not ilike '%new.body%'
    and pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      not ilike '%new.contact_person%'),
  ('SAFETY', 'system generated outage emails are not attributed to users',
    pg_get_functiondef('public.activities_log_cpo_communication_event_v1()'::regprocedure)
      ilike '%new.actor_kind <> ''user''%'),
  ('DATA', 'automatic outage Activity records contain candidate identity and company snapshot',
    not exists (
      select 1
      from public.activities activity
      where activity.origin = 'automatic'
        and activity.source_type = 'power_outage'
        and (
          not (activity.metadata ? 'completePowerOutageCandidateId')
          or nullif(btrim(activity.metadata ->> 'completePowerOutageCompanyName'), '') is null
        )
    ))
) as checks(check_type, object_name, is_correct)
order by check_type, object_name;
