begin;

-- KOMPLETNI only: a later ARES throughput migration widened the accepted daily
-- limit by replacing this function, but unintentionally dropped the shared
-- Mapy.com credit reservation. Keep the widened ARES limit and restore the
-- atomic four-credit claim for every external Mapy.com request.
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

revoke all on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  to service_role;

-- Recover the known lower bound of COMPLETE consumption from this month's run
-- audit. greatest() preserves any credits that were reserved before a crashed
-- request and therefore have no completed-run metadata.
with measured as (
  select
    coalesce(sum(coalesce(nullif(run.metadata ->> 'externalRequestCount', '')::integer, 0)), 0)::integer * 4
      as complete_credits,
    max(coalesce(run.finished_at, run.started_at)) as latest_request_at
  from public.complete_power_outage_runs run
  where run.provider = 'mapy'
    and run.run_kind = 'company_discovery'
    and run.started_at >= date_trunc('month', timezone('Europe/Prague', now())) at time zone 'Europe/Prague'
), corrected as (
  select
    usage.provider,
    greatest(
      case
        when usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
          then usage.complete_credit_count
        else 0
      end,
      measured.complete_credits
    ) as complete_credits,
    case
      when usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
        then usage.markets_credit_count
      else 0
    end as markets_credits,
    measured.latest_request_at
  from public.power_outage_mapy_credit_usage usage
  cross join measured
  where usage.provider = 'mapy'
)
update public.power_outage_mapy_credit_usage usage
set month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date,
    complete_credit_count = corrected.complete_credits,
    markets_credit_count = corrected.markets_credits,
    total_credit_count = corrected.complete_credits + corrected.markets_credits,
    last_request_at = greatest(usage.last_request_at, corrected.latest_request_at),
    updated_at = now()
from corrected
where usage.provider = corrected.provider;

commit;

select 'FUNCTION' as check_type, 'complete quota reserves Mapy.com credits' as object_name,
  pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ) like '%claim_power_outage_mapy_credits(''complete'', 4)%' as is_correct
union all
select 'FUNCTION', 'complete quota keeps ARES 30000 daily ceiling',
  pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ) like '%requested_day_limit not between 1 and 30000%'
union all
select 'ACCOUNTING', 'Mapy.com total equals COMPLETE plus MARKETY',
  total_credit_count = complete_credit_count + markets_credit_count
from public.power_outage_mapy_credit_usage
where provider = 'mapy'
union all
select 'ISOLATION', 'credit repair does not reference MARKET outage tables',
  position(
    'power_outage_registry' in lower(
      pg_get_functiondef(
        'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
      )
    )
  ) = 0;
