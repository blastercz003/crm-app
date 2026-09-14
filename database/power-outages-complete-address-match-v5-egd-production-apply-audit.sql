with current_run as (
  select run.*
  from public.complete_power_outage_address_match_v5_apply_runs run
  where run.apply_version = 1
), item_totals as (
  select
    count(*)::bigint as total_count,
    count(*) filter (where item.apply_status = 'pending')::bigint as pending_count,
    count(*) filter (where item.apply_status = 'applied')::bigint as applied_count,
    count(*) filter (where item.apply_status = 'preserved')::bigint as preserved_count
  from public.complete_power_outage_address_match_v5_apply_items item
  join current_run run on run.id = item.run_id
), function_contracts as (
  select
    lower(pg_get_functiondef(
      'public.prepare_complete_power_outage_address_match_v5_egd_apply_v1()'::regprocedure
    )) as prepare_definition,
    lower(pg_get_functiondef(
      'public.apply_complete_power_outage_address_match_v5_egd_batch_v1(integer)'::regprocedure
    )) as apply_definition
), checks(check_type, object_name, is_correct) as (
  values
    (
      'DATA'::text,
      'historical plan contains only companies attached to EG.D outages'::text,
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_address_match_v4_targets target
          on target.id = item.target_id
        join public.complete_power_outage_addresses address
          on address.id = target.outage_address_id
        join public.complete_power_outages outage on outage.id = address.outage_id
        where target.source <> 'egd' or outage.source <> 'egd'
      )
    ),
    (
      'DATA',
      'historical plan accounts for every selected EG.D company address pair',
      exists (
        select 1
        from current_run run cross join item_totals totals
        where run.planned_count = totals.total_count
          and totals.total_count = totals.pending_count
            + totals.applied_count + totals.preserved_count
      )
    ),
    (
      'DATA',
      'completed recalculation has no pending company address pair',
      exists (
        select 1
        from current_run run cross join item_totals totals
        where run.status = 'complete'
          and totals.pending_count = 0
          and run.planned_count = run.applied_count + run.preserved_count
      )
    ),
    (
      'DATA',
      'unprotected verified EG.D pairs are confirmed',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where item.apply_status = 'applied'
          and not item.protected_record
          and item.final_disposition = 'verified'
          and company.candidate_status <> 'confirmed'
      )
    ),
    (
      'DATA',
      'unprotected uncertain EG.D pairs remain visible as needs review',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where item.apply_status = 'applied'
          and not item.protected_record
          and item.final_disposition = 'needs_review'
          and company.candidate_status <> 'needs_review'
      )
    ),
    (
      'DATA',
      'unprotected conflicting EG.D pairs are hidden as stale',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where item.apply_status = 'applied'
          and not item.protected_record
          and item.final_disposition = 'conflict'
          and company.candidate_status <> 'stale'
      )
    ),
    (
      'LOGIC',
      'verified is the only historical result promoted to confirmed',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where item.apply_status = 'applied'
          and not item.protected_record
          and company.candidate_status = 'confirmed'
          and item.final_disposition <> 'verified'
      )
    ),
    (
      'LOGIC',
      'manually resolved records are preserved',
      not exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        where item.protected_record and item.apply_status = 'applied'
      )
    ),
    (
      'LOGIC',
      'OPEN GATE erroneous EG.D relation is classified as conflict',
      exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where company.company_name ilike 'OPEN GATE%'
          and item.final_disposition = 'conflict'
      )
    ),
    (
      'LOGIC',
      'Nitto Denko erroneous EG.D relation is classified as conflict',
      exists (
        select 1
        from public.complete_power_outage_address_match_v5_apply_items item
        join public.complete_power_outage_companies company on company.id = item.company_id
        where company.company_name ilike 'Nitto Denko Czech%'
          and item.final_disposition = 'conflict'
      )
    ),
    (
      'ISOLATION',
      'historical recalculation contract excludes CEZ PRE and MARKET mutation',
      exists (
        select 1
        from function_contracts contract
        where contract.prepare_definition like '%target.source = ''egd''%'
          and contract.prepare_definition like '%outage.source = ''egd''%'
          and contract.apply_definition like '%target.source = ''egd''%'
          and contract.apply_definition like '%outage.source = ''egd''%'
          and contract.prepare_definition not like '%market_power_outage%'
          and contract.apply_definition not like '%market_power_outage%'
      )
    ),
    (
      'SAFETY',
      'COMPLETE email planning and dispatch remain disabled',
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
    ),
    (
      'SAFETY',
      'historical recalculation performs no external request',
      exists (
        select 1
        from current_run run
        where not coalesce((run.metadata ->> 'externalRequestMade')::boolean, true)
          and not coalesce((run.metadata ->> 'emailRuntimeChanged')::boolean, true)
      )
    ),
    (
      'RLS',
      'private EG.D production apply tables have row level security',
      (select relrowsecurity from pg_class
       where oid = 'public.complete_power_outage_address_match_v5_apply_runs'::regclass)
      and (select relrowsecurity from pg_class
           where oid = 'public.complete_power_outage_address_match_v5_apply_items'::regclass)
    ),
    (
      'GRANT',
      'authenticated cannot inspect or execute EG.D production recalculation',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v5_apply_runs',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v5_apply_items',
        'SELECT'
      )
      and not has_function_privilege(
        'authenticated',
        'public.prepare_complete_power_outage_address_match_v5_egd_apply_v1()',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.apply_complete_power_outage_address_match_v5_egd_batch_v1(integer)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.prepare_complete_power_outage_address_match_v5_egd_batch_v1(integer)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated',
        'public.process_complete_power_outage_address_match_v5_egd_v1()',
        'EXECUTE'
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  run.id as run_id,
  run.status,
  run.planned_count,
  run.applied_count,
  run.preserved_count,
  run.verified_count,
  run.needs_review_count,
  run.conflict_count,
  count(item.company_id) as prepared_item_count,
  count(*) filter (where item.apply_status = 'pending') as remaining_count,
  round(
    100.0 * count(*) filter (where item.apply_status <> 'pending')
      / nullif(count(*), 0),
    2
  ) as progress_percent,
  run.started_at,
  run.finished_at
from public.complete_power_outage_address_match_v5_apply_runs run
join public.complete_power_outage_address_match_v5_apply_items item
  on item.run_id = run.id
where run.apply_version = 1
group by run.id;
