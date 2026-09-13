with checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'communication aware page version ten exists',
    to_regprocedure('public.get_complete_power_outage_company_page_v10(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is not null),
  ('FUNCTION', 'safe communication record badge exists',
    to_regprocedure('public.get_complete_power_outage_communication_badge_v1(uuid)') is not null),
  ('GRANT', 'authenticated cannot query private communication badge directly',
    not has_function_privilege('authenticated', 'public.get_complete_power_outage_communication_badge_v1(uuid)', 'EXECUTE')),
  ('GRANT', 'authenticated reads communication badge only through safe page function',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_company_page_v10(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)', 'EXECUTE')),
  ('LOGIC', 'communication badge uses canonical workflow state',
    pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure)
      ilike '%complete_power_outage_communication_states%'),
  ('LOGIC', 'not contacted records create no communication badge',
    pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure)
      ilike '%communication_status <> ''not_contacted''%'),
  ('ISOLATION', 'communication badge stays in COMPLETE scope',
    pg_get_functiondef('public.get_complete_power_outage_company_page_v10(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('SAFETY', 'communication badge exposes no note contact person or activity data',
    pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure)
      not ilike '%communication_events%'
    and pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure)
      not ilike '%activities%')
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
