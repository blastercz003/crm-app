with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'canonical COMPLETE communication state and timeline exist',
    to_regclass('public.complete_power_outage_communication_states') is not null
    and to_regclass('public.complete_power_outage_communication_events') is not null),
  ('TABLE', 'COMPLETE communication activity link exists',
    to_regclass('public.complete_power_outage_communication_activity_links') is not null),
  ('RLS', 'all private COMPLETE communication tables have RLS',
    coalesce((
      select bool_and(table_row.relrowsecurity)
      from pg_class table_row
      where table_row.oid in (
        'public.complete_power_outage_communication_states'::regclass,
        'public.complete_power_outage_communication_events'::regclass,
        'public.complete_power_outage_communication_activity_links'::regclass
      )
    ), false)),
  ('GRANT', 'authenticated cannot enumerate or mutate private communication tables',
    not has_table_privilege('authenticated', 'public.complete_power_outage_communication_states', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_communication_events', 'SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_communication_activity_links', 'SELECT,INSERT,UPDATE,DELETE')),
  ('FUNCTION', 'structured communication workspace and recording exist',
    to_regprocedure('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)') is not null
    and to_regprocedure('public.get_complete_power_outage_communication_workspace_v1(uuid)') is not null),
  ('FUNCTION', 'follow up create update complete and read exist',
    to_regprocedure('public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)') is not null
    and to_regprocedure('public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)') is not null
    and to_regprocedure('public.get_complete_power_outage_communication_follow_up_v1(uuid)') is not null),
  ('FUNCTION', 'communication aware page count and selection functions exist',
    to_regprocedure('public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean)') is not null
    and to_regprocedure('public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)') is not null),
  ('FUNCTION', 'safe communication badge and admin owner options exist',
    to_regprocedure('public.get_complete_power_outage_communication_badge_v1(uuid)') is not null
    and to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()') is not null),
  ('GRANT', 'communication workspace is exposed only through guarded functions',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_communication_workspace_v1(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_complete_power_outage_communication_badge_v1(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)', 'EXECUTE')),
  ('GRANT', 'other owner choices and crafted filters are administrator guarded',
    pg_get_functiondef('public.get_complete_power_outage_owner_filter_options_v1()'::regprocedure) ilike '%current_user_is_admin%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure)
      ilike '%Filtr ostatnich vlastniku je dostupny pouze administratorovi%'),
  ('DATA', 'every legacy assignment has a canonical communication state',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      left join public.complete_power_outage_communication_states state
        on state.candidate_id = assignment.candidate_id
      where state.candidate_id is null
    )),
  ('DATA', 'communication timeline legacy imports contain no duplicates',
    not exists (
      select event.source_note_id
      from public.complete_power_outage_communication_events event
      where event.source_note_id is not null
      group by event.source_note_id
      having count(*) > 1
    )),
  ('DATA', 'communication activity links contain no orphaned records',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      left join public.activities activity on activity.id = link.activity_id
      left join public.complete_power_outage_companies company on company.id = link.candidate_id
      where activity.id is null
         or company.id is null
         or activity.user_id <> link.created_by
         or activity.created_by <> link.created_by
    )),
  ('DATA', 'current reminder links match planned activities',
    not exists (
      select 1
      from public.complete_power_outage_communication_activity_links link
      join public.activities activity on activity.id = link.activity_id
      where link.is_current is distinct from (activity.status = 'planned' and activity.deleted_at is null)
    )),
  ('DATA', 'Michal and Lida owner profiles exist',
    (select count(*) = 2
     from public.profiles
     where id in (
       '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid,
       '735d158c-667a-42c0-8af0-6ee12a9c1f11'::uuid
     ))),
  ('LOGIC', 'all seven approved communication states are enforced',
    (select count(*) = 7
     from unnest(array[
       'not_contacted', 'contacted', 'unreachable', 'interested',
       'offer_sent', 'job_won', 'closed_no_job'
     ]) expected(status)
     where pg_get_constraintdef((
       select constraint_row.oid
       from pg_constraint constraint_row
       where constraint_row.conrelid = 'public.complete_power_outage_communication_states'::regclass
         and constraint_row.conname = 'cpo_communication_states_status_check'
     )) ilike '%' || expected.status || '%')),
  ('LOGIC', 'job outcome has one canonical communication state',
    pg_get_constraintdef((
      select constraint_row.oid
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.complete_power_outage_communication_states'::regclass
        and constraint_row.conname = 'cpo_communication_states_status_check'
    )) ilike '%job_won%'
    and not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_states'
        and column_row.column_name in ('job_won', 'has_job', 'job_created')
    )),
  ('LOGIC', 'structured communication supports approved channels',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.complete_power_outage_communication_events'::regclass
        and constraint_row.conname = 'cpo_communication_events_channel_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%phone%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%email%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%in_person%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%other%'
    )),
  ('LOGIC', 'only one current follow up per company outage is enforced',
    exists (
      select 1
      from pg_index index_row
      join pg_class index_class on index_class.oid = index_row.indexrelid
      where index_row.indrelid = 'public.complete_power_outage_communication_activity_links'::regclass
        and index_class.relname = 'cpo_communication_activity_one_current_idx'
        and index_row.indisunique
        and pg_get_expr(index_row.indpred, index_row.indrelid) ilike '%is_current%'
    )),
  ('LOGIC', 'Pracovni agenda is the reminder schedule and completion source',
    not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_activity_links'
        and column_row.column_name in ('scheduled_for', 'completed_at', 'completion_result', 'reminder_enabled')
    )),
  ('LOGIC', 'completion and rescheduling synchronize both sections',
    pg_get_functiondef('public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure) ilike '%follow_up_rescheduled%'
    and pg_get_functiondef('public.sync_cpo_communication_follow_up_activity_v1()'::regprocedure) ilike '%old.status = ''planned'' and new.status = ''completed''%'
    and pg_get_functiondef('public.finish_complete_power_outage_communication_follow_up_v1(uuid,text)'::regprocedure) ilike '%update public.activities%'),
  ('LOGIC', 'unified timeline contains communication reminders and actual emails',
    pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure) ilike '%automatic_email_sent%'
    and pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure) ilike '%complete_power_outage_communication_activity_links%'),
  ('LOGIC', 'communication badge uses canonical state and hides not contacted',
    pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure) ilike '%complete_power_outage_communication_states%'
    and pg_get_functiondef('public.get_complete_power_outage_communication_badge_v1(uuid)'::regprocedure) ilike '%communication_status <> ''not_contacted''%'),
  ('LOGIC', 'page count and AI selection share one communication filter scope',
    pg_get_functiondef('public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'::regprocedure) ilike '%get_cpo_communication_filtered_scope_v1%'
    and pg_get_functiondef('public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean)'::regprocedure) ilike '%get_cpo_communication_filtered_scope_v1%'
    and pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)'::regprocedure) ilike '%get_cpo_communication_filtered_scope_v1%'),
  ('LOGIC', 'communication filter supports all states including missing as not contacted',
    pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%closed_no_job%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) ilike '%coalesce(communication.communication_status, ''not_contacted'')%'),
  ('LOGIC', 'admin owner filter is limited to Michal and Lida',
    pg_get_functiondef('public.get_complete_power_outage_owner_filter_options_v1()'::regprocedure)
      ilike '%46c40df2-04d7-41e9-ad6d-51cc2ee76019%'
    and pg_get_functiondef('public.get_complete_power_outage_owner_filter_options_v1()'::regprocedure)
      ilike '%735d158c-667a-42c0-8af0-6ee12a9c1f11%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure)
      ilike '%Tento vlastnik neni pro filtr KOMPLETNI povolen%'),
  ('TRIGGER', 'communication events are append only',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.complete_power_outage_communication_events'::regclass
        and trigger_row.tgname = 'cpo_communication_events_immutable'
        and not trigger_row.tgisinternal
    )),
  ('TRIGGER', 'activity changes synchronize communication timeline',
    exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid = 'public.activities'::regclass
        and trigger_row.tgname = 'activities_sync_cpo_communication_follow_up'
        and not trigger_row.tgisinternal
    )),
  ('ISOLATION', 'communication workflow remains in COMPLETE scope',
    pg_get_functiondef('public.get_complete_power_outage_communication_workspace_v1(uuid)'::regprocedure) not ilike '%power_outage_client_email%'
    and pg_get_functiondef('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'::regprocedure) not ilike '%power_outage_client_email%'),
  ('SAFETY', 'communication actions do not send email or call external services',
    pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure) not ilike '%resend%'
    and pg_get_functiondef('public.record_complete_power_outage_communication_v1(uuid,text,text,text,text,timestamptz)'::regprocedure) not ilike '%http%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure) not ilike '%resend%'
    and pg_get_functiondef('public.save_complete_power_outage_communication_follow_up_v1(uuid,text,text,text,timestamptz,boolean)'::regprocedure) not ilike '%http%'),
  ('SAFETY', 'communication workflow creates no background communication automation',
    not exists (
      select 1
      from cron.job job
      where job.command ilike '%record_complete_power_outage_communication_v1%'
         or job.command ilike '%save_complete_power_outage_communication_follow_up_v1%'
    )),
  ('STATE', 'complete communication workflow version one is ready',
    not exists (
      select 1
      from public.complete_power_outage_communication_states state
      where state.communication_status not in (
        'not_contacted', 'contacted', 'unreachable', 'interested',
        'offer_sent', 'job_won', 'closed_no_job'
      )
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
