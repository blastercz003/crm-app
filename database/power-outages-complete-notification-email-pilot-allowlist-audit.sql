with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'independent COMPLETE pilot allowlist state',
    to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_state') is not null),
  ('TABLE', 'append only COMPLETE pilot allowlist history',
    to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_events') is not null),
  ('VIEW', 'effective COMPLETE pilot allowlist',
    to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_v1') is not null),
  ('FUNCTION', 'admin COMPLETE pilot allowlist decision exists',
    to_regprocedure('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)') is not null),
  ('FUNCTION', 'admin COMPLETE pilot allowlist workspace exists',
    to_regprocedure('public.get_cpo_notification_email_pilot_allowlist_v1(integer)') is not null),
  ('GRANT', 'authenticated cannot enumerate pilot allowlist tables',
    not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_allowlist_state', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_allowlist_events', 'SELECT')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_notification_email_pilot_allowlist_v1', 'SELECT')),
  ('GRANT', 'pilot allowlist operations enforce administrator role',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%profile.role = ''admin''%'
    and pg_get_functiondef('public.get_cpo_notification_email_pilot_allowlist_v1(integer)'::regprocedure)
      ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'pilot starts with a three company configured limit',
    (select configured_max_company_count = 3
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)),
  ('LOGIC', 'pilot has an immutable hard ceiling of five companies',
    (select hard_max_company_count = 5
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)
    and pg_get_constraintdef((
      select oid from pg_constraint
      where conname = 'cpo_pilot_allowlist_limit_check'
        and conrelid = 'public.complete_power_outage_notification_email_pilot_allowlist_state'::regclass
    )) ilike '%hard_max_company_count = 5%'),
  ('LOGIC', 'allowlist accepts only current manually approved notices',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%review_status <> ''approved''%'
    and pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%approved_and_eligible_now%'),
  ('LOGIC', 'only one active notice per company can enter pilot',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%entry.ico = selected_plan.ico%'
    and pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%entry.plan_id <> selected_plan.id%'),
  ('LOGIC', 'concurrent allowlist changes share one lock',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      ilike '%pg_advisory_xact_lock%'),
  ('LOGIC', 'database insert guard enforces approval and company limit',
    pg_get_functiondef('public.guard_cpo_notification_email_pilot_allowlist_insert()'::regprocedure)
      ilike '%approved_and_eligible_now%'
    and pg_get_functiondef('public.guard_cpo_notification_email_pilot_allowlist_insert()'::regprocedure)
      ilike '%configured_max_company_count%'
    and exists (
      select 1 from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_notification_email_pilot_allowlist_events'::regclass
        and trigger_row.tgname = 'cpo_notification_email_pilot_allowlist_insert_guard'
        and not trigger_row.tgisinternal
    )),
  ('DATA', 'active pilot allowlist does not exceed configured limit',
    (select count(distinct entry.ico) <= state_row.configured_max_company_count
     from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
     cross join public.complete_power_outage_notification_email_pilot_allowlist_state state_row
     where state_row.singleton and entry.active_and_eligible_now
     group by state_row.configured_max_company_count)
    is not false),
  ('DATA', 'active pilot allowlist contains no duplicate company',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now
      group by entry.ico
      having count(*) > 1
    )),
  ('SAFETY', 'allowlist changes neither plans nor review decisions',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      not ilike '%update public.complete_power_outage_notification_email_plans%'
    and pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      not ilike '%insert into public.complete_power_outage_notification_email_pilot_review_events%'),
  ('SAFETY', 'allowlist UI and LIVE dispatch remain disabled',
    (select not ui_enabled and not live_dispatch_enabled
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)
    and (select runtime_mode = 'shadow' and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)),
  ('ISOLATION', 'pilot allowlist does not reference MARKET email objects',
    pg_get_functiondef('public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)'::regprocedure)
      not ilike '%power_outage_client_email%'
    and pg_get_functiondef('public.get_cpo_notification_email_pilot_allowlist_v1(integer)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('STATE', 'manual COMPLETE pilot allowlist is ready without sending',
    (select management_enabled and not ui_enabled and not live_dispatch_enabled
     from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)
    and (select
      coalesce((metadata ->> 'pilotAllowlistEnabled')::boolean, false)
      and metadata ->> 'pilotAllowlistContract' = 'complete-notification-email-pilot-allowlist-v1'
      and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
