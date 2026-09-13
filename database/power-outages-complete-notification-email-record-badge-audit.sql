with checks(check_type, object_name, is_correct) as (
  values
    (
      'FUNCTION',
      'safe notification email record badge exists',
      to_regprocedure(
        'public.get_complete_power_outage_notification_email_badge_v1(uuid)'
      ) is not null
    ),
    (
      'FUNCTION',
      'notification aware page version nine exists',
      to_regprocedure(
        'public.get_complete_power_outage_company_page_v9(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'
      ) is not null
    ),
    (
      'GRANT',
      'authenticated cannot query private badge function directly',
      not has_function_privilege(
        'authenticated',
        'public.get_complete_power_outage_notification_email_badge_v1(uuid)',
        'EXECUTE'
      )
    ),
    (
      'GRANT',
      'authenticated reads badge only through safe page function',
      has_function_privilege(
        'authenticated',
        'public.get_complete_power_outage_company_page_v9(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)',
        'EXECUTE'
      )
    ),
    (
      'LOGIC',
      'badge is bound to the same company and outage',
      position(
        'plan.ico = scope_row.ico'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
      and position(
        'plan.outage_id = scope_row.outage_id'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
    ),
    (
      'LOGIC',
      'only actual sent outcomes create a badge',
      position(
        'outcome.outcome = ''sent'''
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
    ),
    (
      'LOGIC',
      'delivered webhook evidence upgrades the badge',
      position(
        'delivery_success'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
    ),
    (
      'LOGIC',
      'real pilot and production sends are represented',
      position(
        'cpo_notification_email_production_outcomes'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
      and position(
        'complete_power_outage_notification_email_pilot_send_outcomes'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) > 0
    ),
    (
      'SAFETY',
      'internal TEST deliveries cannot create a badge',
      position(
        'notification_email_test'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) = 0
    ),
    (
      'SAFETY',
      'record payload exposes no recipient address',
      position(
        'recipient_email'
        in pg_get_functiondef(
          'public.get_complete_power_outage_company_page_v9(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure
        )
      ) = 0
    ),
    (
      'ISOLATION',
      'notification badge does not reference MARKET email objects',
      position(
        'power_outage_client_email'
        in pg_get_functiondef(
          'public.get_complete_power_outage_notification_email_badge_v1(uuid)'::regprocedure
        )
      ) = 0
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
