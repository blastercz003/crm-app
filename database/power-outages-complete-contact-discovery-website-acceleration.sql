begin;

-- Bezpecne zrychleni jiz aktivniho kroku 5 bez zmeny nebo resetu fronty.
-- Databazovy claim nadale povoluje pouze jeden soucasne zpracovavany web.
do $$
declare existing_job record;
begin
  if to_regprocedure('public.request_complete_power_outage_contact_discovery_websites()') is null
     or to_regprocedure('public.claim_complete_power_outage_contact_discovery(integer)') is null
  then
    raise exception 'Krok 5 overovani oficialnich webu neni nasazen.';
  end if;

  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_contact_discovery_websites_every_minute',
      'complete_contact_discovery_websites_every_fifteen_seconds',
      'complete_contact_discovery_websites_every_two_minutes',
      'complete_contact_discovery_websites_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_contact_discovery_websites_every_fifteen_seconds',
    '15 seconds',
    $job$select public.request_complete_power_outage_contact_discovery_websites();$job$
  );
end
$$;

commit;
