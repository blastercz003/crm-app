-- Závěrečná read-only kontrola ostrého provozu režimu KOMPLETNÍ.
-- Skript nic nemění. Vrací jedinou tabulku, aby byl výsledek dobře čitelný
-- také v SQL editoru Supabase.

with checks(check_type, object_name, is_correct, detail) as (
  select 'DATA', 'current complete outages are available',
    exists (
      select 1
      from public.complete_power_outages
      where ends_at >= now()
        and source_status in ('scheduled', 'active')
    ),
    concat(
      'current=',
      (select count(*) from public.complete_power_outages
       where ends_at >= now() and source_status in ('scheduled', 'active'))
    )

  union all
  select 'DATA', 'confirmed companies with evidence are available',
    exists (
      select 1
      from public.complete_power_outage_companies company
      where company.candidate_status = 'confirmed'
        and exists (
          select 1
          from public.complete_power_outage_company_evidence evidence
          where evidence.company_id = company.id
        )
    ),
    concat(
      'confirmed=',
      (select count(*) from public.complete_power_outage_companies
       where candidate_status = 'confirmed')
    )

  union all
  select 'DATA', 'no confirmed company without evidence',
    not exists (
      select 1
      from public.complete_power_outage_companies company
      where company.candidate_status = 'confirmed'
        and not exists (
          select 1
          from public.complete_power_outage_company_evidence evidence
          where evidence.company_id = company.id
        )
    ),
    concat(
      'without_evidence=',
      (select count(*)
       from public.complete_power_outage_companies company
       where company.candidate_status = 'confirmed'
         and not exists (
           select 1 from public.complete_power_outage_company_evidence evidence
           where evidence.company_id = company.id
         ))
    )

  union all
  select 'DATA', 'company deduplication constraint holds',
    not exists (
      select 1
      from public.complete_power_outage_companies
      group by outage_address_id, candidate_key
      having count(*) > 1
    ),
    concat(
      'duplicates=',
      (select count(*) from (
        select 1
        from public.complete_power_outage_companies
        group by outage_address_id, candidate_key
        having count(*) > 1
      ) duplicates)
    )

  union all
  select 'PIPELINE', 'normalization is progressing',
    exists (
      select 1
      from public.complete_power_outage_task_state
      where task_key = 'normalize_addresses'
        and last_status in ('running', 'succeeded', 'skipped')
        and coalesce(last_finished_at, last_started_at) >= now() - interval '45 minutes'
    ),
    coalesce((
      select concat('status=', last_status, ', finished=', coalesce(last_finished_at, last_started_at))
      from public.complete_power_outage_task_state
      where task_key = 'normalize_addresses'
    ), 'missing')

  union all
  select 'PIPELINE', 'company reconciliation is current',
    exists (
      select 1
      from public.complete_power_outage_task_state
      where task_key = 'reconcile_companies'
        and last_status in ('running', 'succeeded', 'skipped')
        and coalesce(last_finished_at, last_started_at) >= now() - interval '45 minutes'
    ),
    coalesce((
      select concat('status=', last_status, ', finished=', coalesce(last_finished_at, last_started_at))
      from public.complete_power_outage_task_state
      where task_key = 'reconcile_companies'
    ), 'missing')

  union all
  select 'PROVIDER', 'ARES processing is healthy',
    exists (
      select 1
      from public.complete_power_outage_task_state
      where task_key = 'discover_ares'
        and last_status in ('running', 'succeeded', 'skipped')
        and consecutive_failure_count = 0
    ),
    coalesce((
      select concat('status=', last_status, ', failures=', consecutive_failure_count)
      from public.complete_power_outage_task_state
      where task_key = 'discover_ares'
    ), 'missing')

  union all
  select 'PROVIDER', 'Mapy.com processing is healthy',
    exists (
      select 1
      from public.complete_power_outage_task_state
      where task_key = 'discover_mapy'
        and last_status in ('running', 'succeeded', 'skipped')
        and consecutive_failure_count = 0
    ),
    coalesce((
      select concat('status=', last_status, ', failures=', consecutive_failure_count)
      from public.complete_power_outage_task_state
      where task_key = 'discover_mapy'
    ), 'missing')

  union all
  select 'SAFETY', 'no expired task locks',
    not exists (
      select 1
      from public.complete_power_outage_task_state
      where lock_token is not null
        and lock_expires_at <= now()
    ),
    concat(
      'expired=',
      (select count(*) from public.complete_power_outage_task_state
       where lock_token is not null and lock_expires_at <= now())
    )

  union all
  select 'SAFETY', 'no stale running executions',
    not exists (
      select 1
      from public.complete_power_outage_runs
      where status = 'running'
        and started_at < now() - interval '10 minutes'
    ),
    concat(
      'stale=',
      (select count(*) from public.complete_power_outage_runs
       where status = 'running' and started_at < now() - interval '10 minutes')
    )

  union all
  select 'UI', 'company overview exists',
    to_regclass('public.complete_power_outage_company_overview') is not null,
    coalesce(to_regclass('public.complete_power_outage_company_overview')::text, 'missing')

  union all
  select 'UI', 'provider overview exists',
    to_regclass('public.complete_power_outage_provider_overview') is not null,
    coalesce(to_regclass('public.complete_power_outage_provider_overview')::text, 'missing')

  union all
  select 'CRON', 'complete runtime pipeline is active',
    exists (
      select 1
      from cron.job
      where jobname = 'power_outages_complete_pipeline_every_five_minutes'
        and schedule = '4-59/5 * * * *'
        and active
    ),
    coalesce((
      select concat('schedule=', schedule, ', active=', active)
      from cron.job
      where jobname = 'power_outages_complete_pipeline_every_five_minutes'
    ), 'missing')

  union all
  select 'CRON', 'complete CEZ projection is active',
    exists (
      select 1 from cron.job
      where jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes'
        and schedule = '11-59/15 * * * *'
        and active
    ),
    coalesce((
      select concat('schedule=', schedule, ', active=', active)
      from cron.job
      where jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes'
    ), 'missing')

  union all
  select 'CRON', 'complete EGD projection is active',
    exists (
      select 1 from cron.job
      where jobname = 'power_outages_complete_egd_projection_every_six_hours'
        and schedule = '51 3-23/6 * * *'
        and active
    ),
    coalesce((
      select concat('schedule=', schedule, ', active=', active)
      from cron.job
      where jobname = 'power_outages_complete_egd_projection_every_six_hours'
    ), 'missing')

  union all
  select 'CRON', 'complete PRE projection is active',
    exists (
      select 1 from cron.job
      where jobname = 'power_outages_complete_pre_projection_every_three_hours'
        and schedule = '36 */3 * * *'
        and active
    ),
    coalesce((
      select concat('schedule=', schedule, ', active=', active)
      from cron.job
      where jobname = 'power_outages_complete_pre_projection_every_three_hours'
    ), 'missing')
)
select check_type, object_name, is_correct, detail
from checks
order by check_type, object_name;
