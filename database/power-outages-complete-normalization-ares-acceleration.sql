begin;

-- Interni priprava adres nevola distributory, RUIAN ani firemni providery.
-- Samostatny minutovy worker proto muze bezpecne zpracovat 1000 adres;
-- task lock v aplikaci zabrani soubehu s rucni obnovou nebo starym requestem.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_complete_address_normalization_every_minute',
      'power_outages_complete_address_normalization_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_complete_address_normalization_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_address_normalization(1000);$job$
  );
end
$$;

-- ARES zustava pod dosavadnim stropem 60 pozadavku za minutu a 30000 za den.
-- Aplikace zpracuje dva pozadavky soubezne; minutova davka 60 pouze vyuzije
-- jiz povolenou kapacitu a databazova quota ji stale atomicky hlida.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_complete_ares_every_minute',
      'power_outages_complete_ares_every_three_minutes',
      'power_outages_complete_ares_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_complete_ares_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_company_discovery('ares', 60);$job$
  );
end
$$;

commit;

select 'CRON' as check_type,
  'internal address normalization every minute' as object_name,
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_address_normalization_every_minute'
      and schedule = '* * * * *'
      and command like '%request_complete_power_outage_address_normalization(1000)%'
      and active
  ) as is_correct
union all
select 'CRON', 'ARES discovery every minute with batch 60',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_ares_every_minute'
      and schedule = '* * * * *'
      and command like '%request_complete_power_outage_company_discovery(''ares'', 60)%'
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
union all
select 'SAFETY', 'only one direct ARES cron is active',
  (
    select count(*) = 1
    from cron.job
    where jobname like 'power_outages_complete_ares%'
      and active
  )
union all
select 'SAFETY', 'ARES minute and day ceilings remain unchanged',
  pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ) like '%requested_minute_limit not between 1 and 100%'
  and (
    pg_get_functiondef(
      'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
    ) like '%requested_day_limit not between 1 and 30000%'
    or pg_get_functiondef(
      'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
    ) like '%requested_provider = ''ares'' and requested_day_limit > 30000%'
  )
union all
select 'GRANT', 'authenticated cannot start accelerated workers',
  not has_function_privilege(
    'authenticated',
    'public.request_complete_power_outage_address_normalization(integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.request_complete_power_outage_company_discovery(text,integer)',
    'EXECUTE'
  )
order by check_type, object_name;
