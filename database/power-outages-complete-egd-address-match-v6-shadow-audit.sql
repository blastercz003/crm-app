-- Read-only audit for the latest EG.D/KOMPLETNI v6 SHADOW run.

with latest_run as (
  select *
  from public.complete_power_outage_egd_v6_shadow_runs
  order by started_at desc
  limit 1
), checks as (
  select 'STATE'::text as check_type,
    'latest EGD v6 SHADOW run completed'::text as object_name,
    exists (
      select 1 from latest_run
      where status = 'complete' and processed_count > 0
    ) as is_correct

  union all
  select 'DATA', 'latest run contains every processed candidate exactly once',
    exists (select 1 from latest_run)
    and not exists (
      select item.company_id
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      group by item.company_id having count(*) <> 1
    )
    and (select processed_count from latest_run) = (
      select count(*) from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
    )

  union all
  select 'DATA', 'every candidate still eligible at completion is represented',
    exists (select 1 from latest_run where status = 'complete')
    and not exists (
      select 1
      from public.complete_power_outages outage
      join public.complete_power_outage_addresses address on address.outage_id = outage.id
      join public.complete_power_outage_companies company on company.outage_address_id = address.id
      cross join latest_run run
      left join public.complete_power_outage_egd_v6_shadow_items item
        on item.run_id = run.id and item.company_id = company.id
      where outage.source = 'egd'
        and outage.source_status in ('scheduled', 'active')
        and outage.missing_since is null
        and outage.ends_at >= run.finished_at
        and company.created_at <= run.finished_at
        and company.updated_at <= run.finished_at
        and item.company_id is null
        and (
          company.candidate_status = 'needs_review'
          or (
            company.candidate_status = 'stale'
            and (
              company.metadata #>> '{addressMatchV5,numberRoleResult}' = 'conflict'
              or company.metadata #>> '{addressMatch,numberRoleResult}' = 'conflict'
              or 'egd_address_conflict' = any(company.evaluation_reasons)
            )
          )
        )
    )

  union all
  select 'DATA', 'dynamic scope closed without an eligible remainder',
    exists (
      select 1 from latest_run
      where planned_count >= processed_count
        and metadata ->> 'remainingCount' = '0'
    )

  union all
  select 'ISOLATION', 'SHADOW contains only current or future COMPLETE EGD records',
    exists (select 1 from latest_run)
    and not exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      left join public.complete_power_outage_addresses address
        on address.id = item.outage_address_id
      left join public.complete_power_outages outage
        on outage.id = item.outage_id and outage.id = address.outage_id
      where outage.id is null
        or outage.source <> 'egd'
        or outage.source_status not in ('scheduled', 'active')
        or outage.missing_since is not null
        or outage.ends_at < item.created_at
    )

  union all
  select 'ISOLATION', 'SHADOW input contains only review and narrow stale records',
    exists (select 1 from latest_run)
    and not exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      where item.original_candidate_status not in ('needs_review', 'stale')
    )

  union all
  select 'LOGIC', 'single EG.D number can match the opposite structured role',
    public.complete_power_outage_number_role_result_v6(
      '[{"houseNumber":"37","orientationNumber":null}]'::jsonb,
      'Peckova 123/37, 69615 Cejkovice',
      '{"structuredAddress":{"houseNumber":"123","orientationNumber":"37"}}'::jsonb
    ) = 'exact_value'

  union all
  select 'LOGIC', 'complete number pair cannot be confirmed from one number',
    public.complete_power_outage_number_role_result_v6(
      '[{"houseNumber":"1239","orientationNumber":"4"}]'::jsonb,
      'Tezebni 4, 62700 Brno',
      '{}'::jsonb
    ) = 'unresolved'

  union all
  select 'LOGIC', 'complete number pair keeps exact role matching',
    public.complete_power_outage_number_role_result_v6(
      '[{"houseNumber":"1239","orientationNumber":"4"}]'::jsonb,
      'Tezebni 1239/4, 62700 Brno',
      '{"structuredAddress":{"houseNumber":"1239","orientationNumber":"4"}}'::jsonb
    ) = 'exact_role'

  union all
  select 'LOGIC', 'postal conflicts are never promoted',
    not exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      where item.proposed_candidate_status = 'confirmed'
        and item.has_postal_conflict
    )

  union all
  select 'REGRESSION', 'VITISBERG is explicitly confirmed by SHADOW',
    exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      where item.ico = '09519246'
        and item.proposed_candidate_status = 'confirmed'
        and item.decision_reason in (
          'egd_single_number_value_match', 'building_number_roles_match'
        )
    )

  union all
  select 'REGRESSION', 'OPEN GATE is never promoted',
    not exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      where item.ico in ('27089941', '26446081')
        and item.proposed_candidate_status = 'confirmed'
    )

  union all
  select 'REGRESSION', 'Nitto Denko is never promoted',
    not exists (
      select 1
      from public.complete_power_outage_egd_v6_shadow_items item
      join latest_run run on run.id = item.run_id
      where item.ico = '27866386'
        and item.proposed_candidate_status = 'confirmed'
    )

  union all
  select 'SAFETY', 'SHADOW made no production mutation or external request',
    exists (
      select 1 from latest_run
      where metadata ->> 'productionMutationMade' = 'false'
        and metadata ->> 'externalRequestMade' = 'false'
        and metadata ->> 'emailRuntimeChanged' = 'false'
    )
    and pg_get_functiondef(
      'public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer)'::regprocedure
    ) not ilike '%update public.complete_power_outage_companies%'
    and pg_get_functiondef(
      'public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer)'::regprocedure
    ) not ilike '%update public.complete_power_outage_company_evidence%'
    and pg_get_functiondef(
      'public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer)'::regprocedure
    ) not ilike '%net.http%'

  union all
  select 'GRANT', 'authenticated cannot run or inspect private EGD v6 SHADOW',
    not has_function_privilege(
      'authenticated',
      'public.prepare_complete_power_outage_egd_v6_shadow_v1()',
      'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.process_complete_power_outage_egd_v6_shadow_batch_v1(integer)',
      'EXECUTE'
    )
    and not has_table_privilege(
      'authenticated', 'public.complete_power_outage_egd_v6_shadow_runs', 'SELECT'
    )
    and not has_table_privilege(
      'authenticated', 'public.complete_power_outage_egd_v6_shadow_items', 'SELECT'
    )

  union all
  select 'RLS', 'private EGD v6 SHADOW tables have row level security',
    (select relrowsecurity from pg_class where oid =
      'public.complete_power_outage_egd_v6_shadow_runs'::regclass)
    and (select relrowsecurity from pg_class where oid =
      'public.complete_power_outage_egd_v6_shadow_items'::regclass)

  union all
  select 'TABLE', 'EGD v6 SHADOW result items are immutable',
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.complete_power_outage_egd_v6_shadow_items'::regclass
        and tgname = 'cpo_egd_v6_shadow_items_immutable'
        and not tgisinternal
        and tgenabled <> 'D'
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  run.id as run_id,
  run.status,
  run.planned_count,
  run.processed_count,
  run.confirmed_count,
  run.needs_review_count,
  run.stale_count,
  run.changed_count,
  run.promoted_from_review_count,
  run.promoted_from_stale_count,
  run.protected_count,
  run.metadata ->> 'remainingCount' as remaining_count,
  run.started_at,
  run.finished_at
from public.complete_power_outage_egd_v6_shadow_runs run
order by run.started_at desc
limit 1;

select
  item.original_candidate_status,
  item.proposed_candidate_status,
  item.decision_reason,
  count(*)::bigint as record_count,
  count(*) filter (where item.protected_record)::bigint as protected_count
from public.complete_power_outage_egd_v6_shadow_items item
where item.run_id = (
  select id from public.complete_power_outage_egd_v6_shadow_runs
  order by started_at desc limit 1
)
group by item.original_candidate_status, item.proposed_candidate_status, item.decision_reason
order by item.original_candidate_status, item.proposed_candidate_status, item.decision_reason;
