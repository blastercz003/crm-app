select 'CRON' as check_type,
  'complete pipeline every fifteen minutes' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_pipeline_every_fifteen_minutes'
      and schedule = '14-59/15 * * * *'
      and active
  ) as is_correct
union all
select 'CRON', 'complete ČEZ projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes'
      and schedule = '11-59/15 * * * *'
      and active
  )
union all
select 'CRON', 'complete EG.D projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_egd_projection_every_six_hours'
      and schedule = '51 3-23/6 * * *'
      and active
  )
union all
select 'CRON', 'complete PRE projection follows source sync',
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_pre_projection_every_three_hours'
      and schedule = '36 */3 * * *'
      and active
  )
union all
select 'FUNCTION', 'request complete runtime pipeline',
  to_regprocedure('public.request_complete_power_outage_runtime_pipeline()') is not null
union all
select 'REALTIME', 'complete scope trigger function',
  coalesce(
    pg_get_functiondef('public.publish_complete_power_outages_app_change()'::regprocedure)
      like '%complete_power_outages%',
    false
  )
union all
select 'TRIGGER', 'complete source state realtime',
  exists (
    select 1 from pg_trigger
    where tgname = 'complete_power_outage_sources_publish_app_change'
      and not tgisinternal
  )
union all
select 'TRIGGER', 'complete task state realtime',
  exists (
    select 1 from pg_trigger
    where tgname = 'complete_power_outage_tasks_publish_app_change'
      and not tgisinternal
  )
order by check_type, object_name;
