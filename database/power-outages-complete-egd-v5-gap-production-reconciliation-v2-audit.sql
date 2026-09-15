-- Audit jednorazoveho produkcniho srovnani prechodove mezery EG.D matcheru v5.
-- Jen cte databazi; nic nemeni a nevola externi sluzby.

with latest_run as (
  select *
  from public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs
  where contract = 'complete-egd-v5-gap-production-reconciliation-v2'
  order by created_at desc
  limit 1
), checks as (
  select 'STATE'::text as check_type,
    'EGD v5 transition gap reconciliation completed with approved totals'::text as object_name,
    exists (
      select 1 from latest_run
      where candidate_count = 209
        and confirmed_count = 37
        and needs_review_count = 56
        and stale_count = 116
        and changed_count = 171
    ) as is_correct

  union all
  select 'DATA', 'every captured candidate is represented exactly once',
    exists (select 1 from latest_run)
    and (select count(*)
         from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
         join latest_run run on run.id = item.run_id)
      = (select candidate_count from latest_run)
    and not exists (
      select item.company_id
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      group by item.company_id having count(*) <> 1
    )

  union all
  select 'DATA', 'candidate statuses equal the approved v5 decisions',
    exists (select 1 from latest_run)
    and not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      join public.complete_power_outage_companies company on company.id = item.company_id
      where company.candidate_status <> item.resulting_candidate_status
        or company.metadata #>> '{addressMatchV5,contract}'
          <> 'complete-egd-v5-gap-production-reconciliation-v2'
        or company.metadata #>> '{addressMatchV5,finalDisposition}'
          <> item.final_disposition
    )

  union all
  select 'DATA', 'evidence rows equal their v5 decisions',
    exists (select 1 from latest_run)
    and not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence audit_evidence
      join latest_run run on run.id = audit_evidence.run_id
      join public.complete_power_outage_company_evidence evidence
        on evidence.id = audit_evidence.evidence_id
      where evidence.metadata #>> '{addressMatch,contract}' <> 'complete-address-match-v5'
        or evidence.metadata #>> '{addressMatch,repairContract}'
          <> 'complete-egd-v5-gap-production-reconciliation-v2'
        or evidence.metadata #>> '{addressMatch,finalDisposition}'
          <> audit_evidence.final_disposition
        or evidence.match_level <> case audit_evidence.final_disposition
          when 'verified' then 'exact_address'
          else 'unresolved'
        end
    )

  union all
  select 'ISOLATION', 'all reconciled records belong to current COMPLETE EGD outages',
    exists (select 1 from latest_run)
    and not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      left join public.complete_power_outage_addresses address
        on address.id = item.outage_address_id
      left join public.complete_power_outages outage
        on outage.id = item.outage_id and outage.id = address.outage_id
      where outage.id is null
        or outage.source <> 'egd'
        or outage.source_status not in ('scheduled', 'active')
        or outage.missing_since is not null
    )

  union all
  select 'LOGIC', 'verified is the only automatically confirmed disposition',
    not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      where (item.final_disposition = 'verified')
        <> (item.resulting_candidate_status = 'confirmed')
    )

  union all
  select 'LOGIC', 'conflicting transition records are hidden as stale',
    not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      where item.final_disposition = 'conflict'
        and item.resulting_candidate_status <> 'stale'
    )

  union all
  select 'LOGIC', 'ambiguous transition records remain needs review',
    not exists (
      select 1
      from public.complete_power_outage_egd_v5_gap_reconciliation_v2_items item
      join latest_run run on run.id = item.run_id
      where item.final_disposition = 'needs_review'
        and item.resulting_candidate_status <> 'needs_review'
    )

  union all
  select 'LOGIC', 'no current confirmed EGD transition candidate lacks v5 evidence',
    not exists (
      select 1
      from public.complete_power_outages outage
      join public.complete_power_outage_addresses address on address.outage_id = outage.id
      join public.complete_power_outage_companies company
        on company.outage_address_id = address.id
      where outage.source = 'egd'
        and outage.source_status in ('scheduled', 'active')
        and outage.missing_since is null
        and outage.ends_at >= now()
        and company.candidate_status = 'confirmed'
        and company.metadata #>> '{addressMatchV5,finalDisposition}' is null
        and not exists (
          select 1 from public.complete_power_outage_company_evidence evidence
          where evidence.company_id = company.id
            and evidence.metadata #>> '{addressMatch,contract}'
              = 'complete-address-match-v5'
        )
    )

  union all
  select 'SAFETY', 'COMPLETE email planning and dispatch remain disabled',
    exists (
      select 1
      from public.complete_power_outage_notification_email_production_config config
      cross join public.complete_power_outage_notification_email_state email_state
      where config.singleton and email_state.singleton
        and not config.production_activation_enabled
        and not config.continuous_planning_enabled
        and not config.continuous_dispatch_enabled
        and not email_state.planning_enabled
        and not email_state.dispatch_enabled
        and email_state.runtime_mode <> 'live'
    )

  union all
  select 'SAFETY', 'reconciliation performs no HTTP or external provider request',
    pg_get_functiondef(
      'public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()'::regprocedure
    ) not ilike '%net.http%'
    and pg_get_functiondef(
      'public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()'::regprocedure
    ) not ilike '%http_post%'
    and pg_get_functiondef(
      'public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()'::regprocedure
    ) not ilike '%http_get%'

  union all
  select 'GRANT', 'authenticated cannot execute EGD reconciliation directly',
    not has_function_privilege(
      'authenticated',
      'public.apply_complete_power_outage_egd_v5_gap_reconciliation_v2()',
      'EXECUTE'
    )

  union all
  select 'GRANT', 'authenticated cannot enumerate reconciliation snapshots',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs',
      'SELECT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_items',
      'SELECT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence',
      'SELECT'
    )

  union all
  select 'RLS', 'private reconciliation tables have row level security',
    (select relrowsecurity from pg_class where oid =
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs'::regclass)
    and (select relrowsecurity from pg_class where oid =
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_items'::regclass)
    and (select relrowsecurity from pg_class where oid =
      'public.complete_power_outage_egd_v5_gap_reconciliation_v2_evidence'::regclass)

  union all
  select 'TABLE', 'reconciliation snapshots are immutable',
    (select count(*) = 3
     from pg_trigger
     where not tgisinternal
       and tgname in (
         'cpo_egd_v5_gap_reconciliation_v2_runs_immutable',
         'cpo_egd_v5_gap_reconciliation_v2_items_immutable',
         'cpo_egd_v5_gap_reconciliation_v2_evidence_immutable'
       )
       and tgenabled <> 'D')
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

-- Souhrn skutecne provedeneho srovnani.
select
  run.id as run_id,
  run.candidate_count,
  run.evidence_count,
  run.confirmed_count,
  run.needs_review_count,
  run.stale_count,
  run.changed_count,
  run.created_at
from public.complete_power_outage_egd_v5_gap_reconciliation_v2_runs run
where run.contract = 'complete-egd-v5-gap-production-reconciliation-v2';
