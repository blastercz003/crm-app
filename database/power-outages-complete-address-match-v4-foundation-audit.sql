with matcher_state as (
  select *
  from public.complete_power_outage_address_match_state
  where singleton
),
foundation_snapshot as (
  select *
  from public.complete_power_outage_address_match_snapshots
  where contract = 'complete-address-match-v4'
    and snapshot_kind = 'foundation'
),
snapshot_function as (
  select lower(pg_get_functiondef(
    'public.capture_complete_power_outage_address_match_snapshot_v1(text)'::regprocedure
  )) as definition
),
checks(check_type, object_name, is_correct) as (
  values
    (
      'TABLE'::text,
      'independent COMPLETE address matcher state exists'::text,
      to_regclass('public.complete_power_outage_address_match_state') is not null
    ),
    (
      'TABLE',
      'empty COMPLETE address matcher v4 SHADOW projection exists',
      to_regclass('public.complete_power_outage_address_match_v4_targets') is not null
      and not exists (
        select 1 from public.complete_power_outage_address_match_v4_targets
      )
    ),
    (
      'TABLE',
      'append only COMPLETE address matcher audit history exists',
      to_regclass('public.complete_power_outage_address_match_snapshots') is not null
      and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid =
          'public.complete_power_outage_address_match_snapshots'::regclass
          and trigger_row.tgname = 'cpo_address_match_snapshots_immutable'
          and not trigger_row.tgisinternal
      )
    ),
    (
      'FUNCTION',
      'idempotent COMPLETE address baseline snapshot exists',
      to_regprocedure(
        'public.capture_complete_power_outage_address_match_snapshot_v1(text)'
      ) is not null
    ),
    (
      'STATE',
      'address matcher v4 is installed only in SHADOW mode',
      exists (
        select 1
        from matcher_state state_row
        where state_row.contract = 'complete-address-match-v4'
          and state_row.production_match_version = 3
          and state_row.shadow_match_version = 4
          and state_row.runtime_mode = 'shadow'
      )
    ),
    (
      'STATE',
      'address revalidation and external validation remain disabled',
      exists (
        select 1
        from matcher_state state_row
        where not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
      )
    ),
    (
      'DATA',
      'immutable baseline of current prepared data is recorded',
      (select count(*) = 1 from foundation_snapshot)
      and coalesce((
        select
          current_address_count >= 0
          and current_company_count >= current_confirmed_company_count
          and current_evidence_count >= current_ares_exact_count
          and current_ares_exact_count >= current_egd_ares_exact_count
          and current_egd_ares_exact_count >= current_egd_postal_conflict_count
          and protected_company_count <= current_company_count
        from foundation_snapshot
      ), false)
    ),
    (
      'LOGIC',
      'matcher target contract records postal municipality RUIAN and coordinates',
      (
        select count(*) = 8
        from information_schema.columns column_row
        where column_row.table_schema = 'public'
          and column_row.table_name = 'complete_power_outage_address_match_v4_targets'
          and column_row.column_name in (
            'municipality',
            'municipality_code',
            'street_is_meaningful',
            'postal_code',
            'ruian_address_id',
            'latitude',
            'longitude',
            'target_fingerprint'
          )
      )
    ),
    (
      'LOGIC',
      'baseline records strong locality and postal conflict policy',
      coalesce((
        select
          (metrics ->> 'automaticConfirmationRequiresStrongLocalityIdentity')::boolean
          and (metrics ->> 'postalConflictForcesRevalidation')::boolean
          and (metrics ->> 'ambiguousStreetEqualsMunicipalityIsIgnored')::boolean
        from foundation_snapshot
      ), false)
    ),
    (
      'LOGIC',
      'assigned and communicated company records are marked for preservation',
      coalesce((
        select (metrics ->> 'protectedCommunicationWillBePreserved')::boolean
        from foundation_snapshot
      ), false)
    ),
    (
      'RLS',
      'private COMPLETE address matcher tables have row level security',
      (
        select count(*) = 3
        from pg_class class_row
        join pg_namespace namespace_row on namespace_row.oid = class_row.relnamespace
        where namespace_row.nspname = 'public'
          and class_row.relname in (
            'complete_power_outage_address_match_state',
            'complete_power_outage_address_match_v4_targets',
            'complete_power_outage_address_match_snapshots'
          )
          and class_row.relrowsecurity
      )
    ),
    (
      'GRANT',
      'authenticated cannot enumerate private address matcher tables',
      not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_state',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_targets',
        'SELECT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_snapshots',
        'SELECT'
      )
    ),
    (
      'GRANT',
      'authenticated cannot capture or mutate address matcher state',
      not has_function_privilege(
        'authenticated',
        'public.capture_complete_power_outage_address_match_snapshot_v1(text)',
        'EXECUTE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_state',
        'INSERT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_state',
        'UPDATE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_state',
        'DELETE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_targets',
        'INSERT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_targets',
        'UPDATE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_v4_targets',
        'DELETE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_snapshots',
        'INSERT'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_snapshots',
        'UPDATE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_address_match_snapshots',
        'DELETE'
      )
    ),
    (
      'ISOLATION',
      'address matcher foundation does not reference MARKET email or job objects',
      not exists (
        select 1
        from snapshot_function
        where definition like '%market_power_outage%'
          or definition like '%notification_email%'
          or definition like '%jobs%'
      )
    ),
    (
      'SAFETY',
      'baseline capture cannot change current companies evidence or communication',
      not exists (
        select 1
        from snapshot_function
        where definition like '%update public.complete_power_outage_companies%'
          or definition like '%delete from public.complete_power_outage_companies%'
          or definition like '%insert into public.complete_power_outage_companies%'
          or definition like '%update public.complete_power_outage_company_evidence%'
          or definition like '%delete from public.complete_power_outage_company_evidence%'
          or definition like '%insert into public.complete_power_outage_company_evidence%'
          or definition like '%update public.complete_power_outage_company_assignments%'
          or definition like '%delete from public.complete_power_outage_company_assignments%'
          or definition like '%update public.complete_power_outage_communication_states%'
          or definition like '%delete from public.complete_power_outage_communication_states%'
      )
    ),
    (
      'SAFETY',
      'stage one performs no HTTP ARES RUIAN or Mapy request',
      not exists (
        select 1
        from snapshot_function
        where definition like '%net.http%'
          or definition like '%http_get%'
          or definition like '%http_post%'
          or definition like '%request_power_outages_endpoint%'
      )
    ),
    (
      'SAFETY',
      'stage one does not activate any address processing worker',
      exists (
        select 1
        from matcher_state state_row
        where state_row.runtime_mode = 'shadow'
          and not state_row.revalidation_enabled
          and not state_row.external_validation_enabled
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
