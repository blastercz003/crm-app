with checks(check_type, object_name, is_correct) as (
  values
  ('TABLE', 'canonical COMPLETE communication state exists',
    to_regclass('public.complete_power_outage_communication_states') is not null),
  ('TABLE', 'append only COMPLETE communication timeline exists',
    to_regclass('public.complete_power_outage_communication_events') is not null),
  ('RLS', 'COMPLETE communication workflow tables have RLS',
    coalesce((
      select bool_and(table_row.relrowsecurity)
      from pg_class table_row
      where table_row.oid in (
        'public.complete_power_outage_communication_states'::regclass,
        'public.complete_power_outage_communication_events'::regclass
      )
    ), false)),
  ('GRANT', 'authenticated cannot inspect or mutate communication workflow',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_states',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_communication_events',
      'SELECT,INSERT,UPDATE,DELETE'
    )),
  ('DATA', 'every legacy assignment has a canonical communication state',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      left join public.complete_power_outage_communication_states state
        on state.candidate_id = assignment.candidate_id
      where state.candidate_id is null
    )),
  ('DATA', 'legacy note imports contain no duplicates',
    not exists (
      select event.source_note_id
      from public.complete_power_outage_communication_events event
      where event.source_note_id is not null
      group by event.source_note_id
      having count(*) > 1
    )),
  ('LOGIC', 'job outcome has one canonical source of truth',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_communication_states'::regclass
        and constraint_row.conname = 'cpo_communication_states_status_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%job_won%'
    )
    and not exists (
      select 1
      from information_schema.columns column_row
      where column_row.table_schema = 'public'
        and column_row.table_name = 'complete_power_outage_communication_states'
        and column_row.column_name in ('job_won', 'has_job', 'job_created')
    )),
  ('LOGIC', 'all approved communication states are represented',
    (
      select count(*) = 7
      from unnest(array[
        'not_contacted', 'contacted', 'unreachable', 'interested',
        'offer_sent', 'job_won', 'closed_no_job'
      ]) as expected(status)
      where pg_get_constraintdef((
        select constraint_row.oid
        from pg_constraint constraint_row
        where constraint_row.conrelid =
          'public.complete_power_outage_communication_states'::regclass
          and constraint_row.conname = 'cpo_communication_states_status_check'
      )) ilike '%' || expected.status || '%'
    )),
  ('LOGIC', 'structured communication channels are constrained',
    exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_communication_events'::regclass
        and constraint_row.conname = 'cpo_communication_events_channel_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%phone%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%email%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%in_person%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%other%'
    )),
  ('LOGIC', 'legacy follow up is conservatively mapped to contacted',
    not exists (
      select 1
      from public.complete_power_outage_company_assignments assignment
      join public.complete_power_outage_communication_states state
        on state.candidate_id = assignment.candidate_id
      where assignment.communication_status = 'follow_up'
        and state.metadata ->> 'importedFrom' =
          'complete_power_outage_company_assignments'
        and state.communication_status <> 'contacted'
    )),
  ('SAFETY', 'current assignment functions and status contract remain unchanged',
    pg_get_functiondef(
      'public.save_complete_power_outage_company_assignment(uuid,text,text)'::regprocedure
    ) ilike '%''not_contacted'', ''contacted'', ''follow_up'', ''closed''%'
    and exists (
      select 1
      from pg_constraint constraint_row
      where constraint_row.conrelid =
        'public.complete_power_outage_company_assignments'::regclass
        and constraint_row.conname = 'cpo_company_assignments_status_check'
        and pg_get_constraintdef(constraint_row.oid) ilike '%follow_up%'
        and pg_get_constraintdef(constraint_row.oid) ilike '%closed%'
    )),
  ('SAFETY', 'step one creates no reminder or activity integration',
    to_regclass('public.complete_power_outage_communication_activity_links') is null),
  ('SAFETY', 'step one creates no workflow automation or sending trigger',
    not exists (
      select 1
      from pg_trigger trigger_row
      where trigger_row.tgrelid in (
        'public.complete_power_outage_communication_states'::regclass,
        'public.complete_power_outage_communication_events'::regclass
      )
        and not trigger_row.tgisinternal
        and trigger_row.tgname not in (
          'cpo_communication_states_set_updated_at',
          'cpo_communication_events_immutable'
        )
    )),
  ('STATE', 'communication workflow foundation version one is prepared',
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
