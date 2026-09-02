begin;

-- Aplikace používá pro ARES bezpečnostní denní strop 20 000 požadavků.
-- Původní databázová validace připouštěla jen 10 000, takže ARES skončil
-- ještě před prvním požadavkem. Počítadla kvóty a její atomické zamykání
-- zůstávají beze změny.
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
     or requested_day_limit not between 1 and 20000 then
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

-- Odstraní pouze provozní chybu způsobenou chybnou validací. Historie běhů,
-- výsledky i čítače spotřebované kvóty zůstávají zachované.
update public.complete_power_outage_task_state
set last_status = 'idle',
    consecutive_failure_count = 0,
    last_error_code = null,
    last_error_message = null,
    lock_token = null,
    lock_expires_at = null
where task_key = 'discover_ares'
  and last_error_code = 'COMPLETE_COMPANY_DISCOVERY_FAILED'
  and last_error_message like '%Neplatný limit požadavků%';

commit;

select 'FUNCTION' as check_type,
  'ARES accepts configured daily quota 20000' as object_name,
  pg_get_functiondef(
    'public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure
  ) like '%requested_day_limit not between 1 and 20000%' as is_correct
union all
select 'STATE', 'ARES invalid-limit failure cleared',
  not exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'discover_ares'
      and last_error_message like '%Neplatný limit požadavků%'
  )
order by check_type, object_name;
