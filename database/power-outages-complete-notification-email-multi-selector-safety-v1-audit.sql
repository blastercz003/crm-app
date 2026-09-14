with definitions as (
  select
    pg_get_functiondef('public.cpo_candidate_matches_selector_keys_v1(uuid,text[])'::regprocedure) as membership_definition,
    pg_get_functiondef('public.enforce_cpo_notification_email_production_plan_scope_v1()'::regprocedure) as plan_guard_definition,
    pg_get_functiondef('public.claim_cpo_notification_email_production_v2()'::regprocedure) as claim_definition,
    pg_get_functiondef('public.prepare_complete_power_outage_contact_selector_set_v1(text[])'::regprocedure) as selection_definition
), audit as (
  select 'TABLE'::text as check_type,
    'shared COMPLETE multi selector state and immutable history exist'::text as object_name,
    to_regclass('public.complete_power_outage_ai_selector_set_v1') is not null
      and to_regclass('public.complete_power_outage_ai_selector_set_events_v1') is not null as is_correct

  union all select 'DATA', 'selected AI filters are active and unique', not exists (
    select 1 from public.complete_power_outage_ai_selector_set_v1 selected
    where cardinality(selected.selector_keys) <> cardinality(array(select distinct unnest(selected.selector_keys)))
      or exists (select 1 from unnest(selected.selector_keys) key
        where not exists (select 1 from public.complete_power_outage_contact_discovery_selectors selector
          where selector.selector_key = key and selector.lifecycle_status = 'active'))
  )

  union all select 'LOGIC', 'all confirmed remains an exclusive selection', not exists (
    select 1 from public.complete_power_outage_ai_selector_set_v1 selected
    where 'all_confirmed' = any(selected.selector_keys) and cardinality(selected.selector_keys) > 1
  )

  union all select 'DATA', 'union selector contains every selected company exactly once',
    not exists (
      select target.ico from public.complete_power_outage_contact_discovery_selector_targets target
      where target.selector_key = 'multi_select_v1'
      group by target.ico having count(*) > 1
    ) and not exists (
      (select distinct target.ico
       from public.complete_power_outage_contact_discovery_selector_targets target
       cross join public.complete_power_outage_ai_selector_set_v1 selected
       where target.selector_key = any(selected.selector_keys))
      except
      (select target.ico from public.complete_power_outage_contact_discovery_selector_targets target
       where target.selector_key = 'multi_select_v1')
    ) and not exists (
      (select target.ico from public.complete_power_outage_contact_discovery_selector_targets target
       where target.selector_key = 'multi_select_v1')
      except
      (select distinct target.ico
       from public.complete_power_outage_contact_discovery_selector_targets target
       cross join public.complete_power_outage_ai_selector_set_v1 selected
       where target.selector_key = any(selected.selector_keys))
    )

  union all select 'DATA', 'notification candidates contain no filter overlap duplicate', not exists (
    select candidate.ico, candidate.outage_id, lower(candidate.recipient_email)
    from public.complete_power_outage_notification_email_candidates_v1 candidate
    group by candidate.ico, candidate.outage_id, lower(candidate.recipient_email)
    having count(*) > 1
  )

  union all select 'LOGIC', 'planning requires confirmed current filter membership',
    membership_definition ilike '%candidate_status%confirmed%'
      and membership_definition ilike '%source_status%scheduled%active%'
      and plan_guard_definition ilike '%cpo_candidate_matches_selector_keys_v1%'
      and plan_guard_definition ilike '%source_status%scheduled%'
  from definitions

  union all select 'LOGIC', 'dispatch repeats membership and outage preflight immediately before claim',
    claim_definition ilike '%cpo_candidate_matches_selector_keys_v1%'
      and claim_definition ilike '%candidate_status%confirmed%'
      and claim_definition ilike '%source_status%scheduled%'
      and claim_definition ilike '%claim_cpo_notification_email_production_v1%'
  from definitions

  union all select 'LOGIC', 'existing suppression limits and delivery safeguards remain delegated',
    claim_definition ilike '%claim_cpo_notification_email_production_v1%'
      and claim_definition ilike '%sendingAttempted%'
  from definitions

  union all select 'FUNCTION', 'guarded multi selector preparation and options exist',
    to_regprocedure('public.prepare_complete_power_outage_contact_selector_set_v1(text[])') is not null
      and to_regprocedure('public.get_cpo_multi_selector_options_v1()') is not null

  union all select 'GRANT', 'only guarded contracts expose multi selection',
    has_function_privilege('authenticated','public.prepare_complete_power_outage_contact_selector_set_v1(text[])','EXECUTE')
      and not has_function_privilege('anon','public.prepare_complete_power_outage_contact_selector_set_v1(text[])','EXECUTE')
      and not has_function_privilege('authenticated','public.cpo_candidate_matches_selector_keys_v1(uuid,text[])','EXECUTE')
      and not has_function_privilege('authenticated','public.claim_cpo_notification_email_production_v2()','EXECUTE')

  union all select 'RLS', 'private multi selector state and history have RLS',
    (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_ai_selector_set_v1'::regclass)
      and (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_ai_selector_set_events_v1'::regclass)
      and not has_table_privilege('authenticated','public.complete_power_outage_ai_selector_set_v1','SELECT')
      and not has_table_privilege('authenticated','public.complete_power_outage_ai_selector_set_events_v1','SELECT')

  union all select 'SAFETY', 'selection change is blocked during live dispatch',
    selection_definition ilike '%prepare_complete_power_outage_contact_selector_v2%'
      and exists (select 1 from pg_trigger trigger_row
        where trigger_row.tgrelid = 'public.complete_power_outage_ai_selector_set_v1'::regclass
          and trigger_row.tgname = 'cpo_ai_selector_set_dispatch_lock' and not trigger_row.tgisinternal)
  from definitions

  union all select 'SAFETY', 'step six performs no external request or direct email action',
    selection_definition not ilike '%http%'
      and selection_definition not ilike '%resend%'
      and claim_definition not ilike '%net.http%'
  from definitions

  union all select 'ISOLATION', 'multi selector email safety remains in COMPLETE scope',
    membership_definition not ilike '%power_outage_client_email%'
      and claim_definition not ilike '%power_outage_client_email%'
  from definitions
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
