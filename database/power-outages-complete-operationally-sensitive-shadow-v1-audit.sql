with latest_run as (
  select run.*
  from public.complete_power_outage_operational_sensitivity_shadow_runs run
  join public.complete_power_outage_operational_sensitivity_state state
    on state.latest_shadow_run_id = run.id
  where state.singleton
), current_scope as (
  select company.id as candidate_id
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where company.candidate_status = 'confirmed'
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
), checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'automatic operational sensitivity classifier exists',
      to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v1(uuid)') is not null),
    ('FUNCTION', 'idempotent operational sensitivity SHADOW refresh exists',
      to_regprocedure('public.refresh_complete_power_outage_operational_sensitivity_shadow_v1()') is not null),
    ('TABLE', 'operational sensitivity SHADOW run history exists',
      to_regclass('public.complete_power_outage_operational_sensitivity_shadow_runs') is not null),
    ('TABLE', 'isolated operational sensitivity SHADOW results exist',
      to_regclass('public.complete_power_outage_operational_sensitivity_shadow_results') is not null),
    ('VIEW', 'dynamic operational sensitivity SHADOW projection exists',
      to_regclass('public.complete_power_outage_operational_sensitivity_shadow_current') is not null),
    ('RLS', 'operational sensitivity SHADOW tables have row level security',
      coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_operational_sensitivity_shadow_runs'::regclass), false)
      and coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_operational_sensitivity_shadow_results'::regclass), false)),
    ('GRANT', 'authenticated cannot inspect or run operational sensitivity SHADOW',
      not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_shadow_runs', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_shadow_results', 'SELECT')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_operational_sensitivity_shadow_current', 'SELECT')
      and not has_function_privilege('authenticated', 'public.classify_complete_power_outage_operational_sensitivity_v1(uuid)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.refresh_complete_power_outage_operational_sensitivity_shadow_v1()', 'EXECUTE')),
    ('STATE', 'latest operational sensitivity SHADOW run completed',
      exists (select 1 from latest_run where status = 'complete' and finished_at is not null)),
    ('DATA', 'latest SHADOW run contains every current eligible confirmed record',
      (select count(*) from current_scope) = coalesce((select target_count from latest_run), -1)
      and not exists (
        select candidate_id from current_scope
        except
        select result.candidate_id
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
      )),
    ('DATA', 'latest SHADOW results contain no duplicate candidate',
      not exists (
        select result.candidate_id
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        group by result.candidate_id
        having count(*) > 1
      )),
    ('LOGIC', 'SHADOW evaluates confirmed records only',
      not exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        where result.candidate_status <> 'confirmed'
      )),
    ('LOGIC', 'SHADOW evaluates current and future records only',
      not exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        where result.ends_at < latest_run.started_at
      )),
    ('LOGIC', 'missing Mapy evidence does not prevent positive classification',
      exists (
        select 1
        from latest_run
        where eligible_without_mapy_count > 0
          and metrics ->> 'mapyAbsenceDisposition' = 'neutral'
      )),
    ('LOGIC', 'secondary NACE requires an independent supporting source',
      not exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        where result.is_eligible
          and result.decision_source = 'ares_any_nace'
      )),
    ('LOGIC', 'eligible results always expose one internal category',
      not exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        where result.is_eligible and result.category is null
      )),
    ('ISOLATION', 'SHADOW results contain COMPLETE distributors only',
      not exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_shadow_results result
        join latest_run on latest_run.id = result.run_id
        where result.outage_source not in ('cez', 'egd', 'pre')
      )),
    ('SAFETY', 'SHADOW refresh records no external request or email mutation',
      exists (
        select 1 from latest_run
        where metrics ->> 'externalRequestMade' = 'false'
          and metrics ->> 'emailRuntimeChanged' = 'false'
      )),
    ('SAFETY', 'production selector UI contacts and notifications remain disabled',
      exists (
        select 1
        from public.complete_power_outage_operational_sensitivity_state
        where singleton and shadow_enabled
          and not selector_enabled and not ui_enabled
          and not contact_selector_enabled and not notification_selector_enabled
      ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
