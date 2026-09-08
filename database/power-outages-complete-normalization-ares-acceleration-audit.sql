select 'CRON' as check_type,
  'ARES discovery every minute with batch 60' as object_name,
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_ares_every_minute'
      and schedule = '* * * * *'
      and command like '%request_complete_power_outage_company_discovery(''ares'', 60)%'
      and active
  ) as is_correct
union all
select 'CRON', 'internal address normalization every minute',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_address_normalization_every_minute'
      and schedule = '* * * * *'
      and command like '%request_complete_power_outage_address_normalization(1000)%'
      and active
  )
union all
select 'SAFETY', 'ARES daily ceiling remains 30000',
  (
    pg_get_functiondef(
      'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
    ) like '%requested_day_limit not between 1 and 30000%'
    or pg_get_functiondef(
      'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
    ) like '%requested_provider = ''ares'' and requested_day_limit > 30000%'
  )
union all
select 'SAFETY', 'ARES scheduled batch remains 60',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_ares_every_minute'
      and command like '%request_complete_power_outage_company_discovery(''ares'', 60)%'
      and active
  )
union all
select 'SAFETY', 'only one direct ARES cron is active',
  (
    select count(*) = 1
    from cron.job
    where jobname like 'power_outages_complete_ares%'
      and active
  )
union all
select 'SAFETY', 'only one direct normalization cron is active',
  (
    select count(*) = 1
    from cron.job
    where jobname like 'power_outages_complete_address_normalization%'
      and active
  )
order by check_type, object_name;
