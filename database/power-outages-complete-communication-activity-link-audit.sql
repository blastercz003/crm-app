with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'COMPLETE communication activity link exists',
    to_regclass('public.complete_power_outage_communication_activity_links') is not null),
  ('FUNCTION', 'safe COMPLETE follow up create update complete and read exist',
    to_regprocedure(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'
    ) is not null
    and to_regprocedure(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'
    ) is not null
    and to_regprocedure(
      'public.get_complete_power_outage_communication_follow_up_v1(uuid)'
    ) is not null),
  ('TRIGGER', 'activity changes synchronize the COMPLETE communication timeline',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.activities'::regclass
        and trigger_row.tgname = 'activities_sync_cpo_communication_follow_up'
        and not trigger_row.tgisinternal
    )),
  ('GRANT', 'authenticated cannot enumerate or mutate communication activity links',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_activity_links',
      'SELECT,INSERT,UPDATE,DELETE'
    )),
  ('GRANT', 'follow up functions enforce outage and activity access',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%current_user_can_view_power_outages%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%current_user_can_view_activities%'),
  ('ISOLATION', 'follow up integration stays in COMPLETE scope',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%power_outage_client_email%'
    and pg_get_functiondef(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'::regprocedure
    ) not ilike '%power_outage_client_email%'),
  ('LOGIC', 'one current follow up per company outage is enforced',
    exists (
      select 1
      from pg_index index_row
      join pg_class index_class on index_class.oid = index_row.indexrelid
      where index_row.indrelid =
        'public.complete_power_outage_communication_activity_links'::regclass
        and index_class.relname = 'cpo_communication_activity_one_current_idx'
        and index_row.indisunique
        and pg_get_expr(index_row.indpred, index_row.indrelid) ilike '%is_current%'
    )),
  ('LOGIC', 'activity is the single source of reminder schedule and completion',
    not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_activity_links'
        and column_row.column_name in (
          'scheduled_for', 'completed_at', 'completion_result', 'reminder_enabled'
        )
    )),
  ('LOGIC', 'linked reminders appear as manual planned activities',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%''manual''%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) ilike '%''planned''%'),
  ('LOGIC', 'completion from either section closes the same link',
    pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%old.status = ''planned'' and new.status = ''completed''%'
    and pg_get_functiondef(
      'public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'::regprocedure
    ) ilike '%update public.activities%'),
  ('LOGIC', 'activity edits append communication timeline evidence',
    pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%follow_up_rescheduled%'
    and pg_get_functiondef(
      'public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure
    ) ilike '%complete_power_outage_communication_events%'),
  ('RLS', 'communication activity links have RLS',
    coalesce((
      select table_row.relrowsecurity
      from pg_class table_row
      where table_row.oid =
        'public.complete_power_outage_communication_activity_links'::regclass
    ), false)),
  ('DATA', 'communication activity links contain no orphaned records',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      left join public.activities activity on activity.id = link.activity_id
      left join public.complete_power_outage_companies company
        on company.id = link.candidate_id
      where activity.id is null
         or company.id is null
         or activity.user_id <> link.created_by
         or activity.created_by <> link.created_by
    )),
  ('SAFETY', 'follow up functions do not send email or call external services',
    pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%resend%'
    and pg_get_functiondef(
      'public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure
    ) not ilike '%http%'),
  ('STATE', 'activity reminder integration is ready without inconsistent current links',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      join public.activities activity on activity.id = link.activity_id
      where link.is_current is distinct from (
        activity.status = 'planned' and activity.deleted_at is null
      )
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
