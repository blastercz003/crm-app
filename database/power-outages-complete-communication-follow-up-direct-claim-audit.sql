with checks(check_type, object_name, is_correct) as (
  values
  ('FUNCTION', 'direct COMPLETE follow up planning exists',
    to_regprocedure('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)') is not null),
  ('GRANT', 'direct follow up planning enforces outage and activity access',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%current_user_can_view_power_outages%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%current_user_can_view_activities%'),
  ('LOGIC', 'unassigned record is claimed before follow up creation',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%complete_power_outage_company_assignments%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%on conflict on constraint complete_power_outage_company_assignments_pkey do nothing%'),
  ('LOGIC', 'direct claim preserves canonical not contacted state',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%complete_power_outage_communication_states%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%''not_contacted''%'),
  ('LOGIC', 'existing owner cannot be replaced by direct planning',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%assignment_owner_id <> current_user_id%'),
  ('LOGIC', 'validated follow up creation remains delegated to version one',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      ilike '%save_complete_power_outage_communication_follow_up_v1%'),
  ('SAFETY', 'direct planning is transactional and makes no external request',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      not ilike '%http%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      not ilike '%resend%'),
  ('SAFETY', 'direct planning does not change email automation',
    pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v2(uuid,text,text,text,timestamptz,boolean)'::regprocedure)
      not ilike '%notification_email%')
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
