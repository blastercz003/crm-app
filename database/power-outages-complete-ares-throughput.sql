begin;

-- ARES zůstává sekvenční a chráněný minutovou kvótou 60 požadavků. Vyšší
-- klouzavý denní strop dovolí rychleji odbavit velkou frontu přesných adres,
-- aniž by se měnila rychlost Mapy.com, Google nebo režimu MARKETY.
create or replace function public.claim_complete_power_outage_provider_quota(
  requested_provider text,
  requested_minute_limit integer,
  requested_day_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  quota_row public.complete_power_outage_provider_quota%rowtype;
  minute_count integer;
  day_count integer;
begin
  if requested_provider not in ('ares', 'mapy', 'google') then
    raise exception 'Neznámý poskytovatel: %', requested_provider;
  end if;
  if requested_minute_limit not between 1 and 100
     or requested_day_limit not between 1 and 30000 then
    raise exception 'Neplatný limit požadavků.';
  end if;

  insert into public.complete_power_outage_provider_quota (provider)
  values (requested_provider)
  on conflict (provider) do nothing;

  select * into quota_row
  from public.complete_power_outage_provider_quota
  where provider = requested_provider
  for update;

  minute_count := case
    when quota_row.minute_window_started_at <= now() - interval '1 minute' then 0
    else quota_row.minute_request_count
  end;
  day_count := case
    when quota_row.day_window_started_at <= now() - interval '1 day' then 0
    else quota_row.day_request_count
  end;

  if minute_count >= requested_minute_limit or day_count >= requested_day_limit then
    return false;
  end if;

  update public.complete_power_outage_provider_quota
  set minute_window_started_at = case
        when minute_window_started_at <= now() - interval '1 minute' then now()
        else minute_window_started_at
      end,
      minute_request_count = minute_count + 1,
      day_window_started_at = case
        when day_window_started_at <= now() - interval '1 day' then now()
        else day_window_started_at
      end,
      day_request_count = day_count + 1,
      last_request_at = now()
  where provider = requested_provider;

  return true;
end;
$$;

revoke all on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  to service_role;

-- ARES už není součástí pětiminutové společné pipeline aplikace. Samostatný
-- cron používá existující endpoint, stejný databázový zámek a dávku 100.
-- Překryv dvou požadavků nemůže vytvořit dvě kopie workeru: discover_ares
-- drží atomický zámek a druhý běh se bezpečně přeskočí.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_complete_ares_every_three_minutes',
      'power_outages_complete_ares_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_complete_ares_every_three_minutes',
    '1-59/3 * * * *',
    $job$select public.request_complete_power_outage_company_discovery('ares', 100);$job$
  );
end
$$;

commit;

select 'CRON' as check_type,
  'complete ARES discovery every three minutes' as object_name,
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_complete_ares_every_three_minutes'
      and schedule = '1-59/3 * * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'provider quota accepts ARES daily limit 30000',
  pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ) like '%requested_day_limit not between 1 and 30000%'
union all
select 'SAFETY', 'only one active complete ARES cron',
  (
    select count(*) = 1
    from cron.job
    where jobname like 'power_outages_complete_ares%'
      and active
  )
order by check_type, object_name;
