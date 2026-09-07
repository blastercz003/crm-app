begin;

-- Mapy.com placeny provoz je povoleny do 500 000 kreditu za kalendarni
-- mesic. Citac je spolecny pro KOMPLETNI a MARKETY a zustava atomicky, takze
-- soubezne workery nemohou financni strop prekrocit.
create or replace function public.claim_power_outage_mapy_credits(
  requested_consumer text,
  requested_credits integer default 4
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  usage_row public.power_outage_mapy_credit_usage%rowtype;
  current_month date := date_trunc('month', timezone('Europe/Prague', now()))::date;
  safe_consumer text := lower(btrim(coalesce(requested_consumer, '')));
  safe_credits integer := coalesce(requested_credits, 0);
begin
  if safe_consumer not in ('complete', 'markets') then
    raise exception 'Neznamy odberatel kreditu Mapy.com: %', requested_consumer;
  end if;
  if safe_credits not between 1 and 100 then
    raise exception 'Neplatny pocet kreditu Mapy.com.';
  end if;

  insert into public.power_outage_mapy_credit_usage (provider, month_started_on)
  values ('mapy', current_month)
  on conflict (provider) do nothing;

  select * into usage_row
  from public.power_outage_mapy_credit_usage
  where provider = 'mapy'
  for update;

  if usage_row.month_started_on <> current_month then
    update public.power_outage_mapy_credit_usage
    set month_started_on = current_month,
        total_credit_count = 0,
        complete_credit_count = 0,
        markets_credit_count = 0,
        last_request_at = null,
        updated_at = now()
    where provider = 'mapy'
    returning * into usage_row;
  end if;

  if usage_row.total_credit_count + safe_credits > 500000 then
    return false;
  end if;

  update public.power_outage_mapy_credit_usage
  set total_credit_count = total_credit_count + safe_credits,
      complete_credit_count = complete_credit_count
        + case when safe_consumer = 'complete' then safe_credits else 0 end,
      markets_credit_count = markets_credit_count
        + case when safe_consumer = 'markets' then safe_credits else 0 end,
      last_request_at = now(),
      updated_at = now()
  where provider = 'mapy';

  return true;
end;
$$;

-- Providerova kvota zachovava dosavadni limity ARES a Google. Mapy.com mohou
-- vyuzit nejvyse 50 pozadavku za minutu a 75 000 za klouzavy den; kazdy
-- skutecny externi pozadavek soucasne rezervuje ctyri mesicni kredity.
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
    raise exception 'Neznamy poskytovatel: %', requested_provider;
  end if;
  if requested_minute_limit not between 1 and 100
     or requested_day_limit < 1
     or (requested_provider = 'ares' and requested_day_limit > 30000)
     or (requested_provider = 'mapy' and requested_day_limit > 75000)
     or (requested_provider = 'google' and requested_day_limit > 30000) then
    raise exception 'Neplatny limit pozadavku.';
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

  if requested_provider = 'mapy'
     and not public.claim_power_outage_mapy_credits('complete', 4) then
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

revoke all on function public.claim_power_outage_mapy_credits(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_power_outage_mapy_credits(text, integer)
  to service_role;
revoke all on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  to service_role;

-- Samostatny minutovy worker nahrazuje Mapy.com krok ve spolecne
-- petiminutove pipeline. Atomicky task lock pripadny prekryv bezpecne preskoci.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'power_outages_complete_mapy_every_minute',
      'power_outages_complete_mapy_every_three_minutes',
      'power_outages_complete_mapy_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_complete_mapy_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_company_discovery('mapy', 50);$job$
  );
end
$$;

commit;

select 'CRON' as check_type, 'complete Mapy discovery every minute' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_mapy_every_minute'
      and schedule = '* * * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'Mapy monthly credit ceiling is 500000',
  position('> 500000' in pg_get_functiondef(
    'public.claim_power_outage_mapy_credits(text,integer)'::regprocedure
  )) > 0
union all
select 'FUNCTION', 'Mapy daily quota accepts 75000 requests',
  position('requested_provider = ''mapy'' and requested_day_limit > 75000' in pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  )) > 0
union all
select 'FUNCTION', 'complete quota reserves Mapy credits',
  position('claim_power_outage_mapy_credits(''complete'', 4)' in pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  )) > 0
union all
select 'GRANT', 'authenticated cannot claim Mapy credits',
  not has_function_privilege(
    'authenticated',
    'public.claim_power_outage_mapy_credits(text,integer)',
    'EXECUTE'
  )
union all
select 'GRANT', 'authenticated cannot claim provider quota',
  not has_function_privilege(
    'authenticated',
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)',
    'EXECUTE'
  )
union all
select 'SAFETY', 'current Mapy usage is below 500000',
  coalesce((
    select total_credit_count <= 500000
    from public.power_outage_mapy_credit_usage
    where provider = 'mapy'
  ), true)
union all
select 'ISOLATION', 'Mapy acceleration does not reference MARKET outage tables',
  position('power_outage_registry' in lower(pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ))) = 0
order by check_type, object_name;
