begin;

-- Jeden měsíční kreditní rozpočet pro všechny požadavky Mapy.com, které
-- vytváří Monitoring odstávek. Rozpad zachovává informaci o spotřebě režimů
-- KOMPLETNÍ a MARKETY, tvrdý interní strop 245 000 ponechá 5 000 kreditů
-- jako ochranu proti rozdílu mezi lokálním čítačem a vyúčtováním poskytovatele.
create table if not exists public.power_outage_mapy_credit_usage (
  provider text primary key default 'mapy',
  month_started_on date not null,
  total_credit_count integer not null default 0,
  complete_credit_count integer not null default 0,
  markets_credit_count integer not null default 0,
  last_request_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint power_outage_mapy_credit_usage_provider_check check (provider = 'mapy'),
  constraint power_outage_mapy_credit_usage_counts_check check (
    total_credit_count >= 0
    and complete_credit_count >= 0
    and markets_credit_count >= 0
    and total_credit_count = complete_credit_count + markets_credit_count
  )
);

insert into public.power_outage_mapy_credit_usage (provider, month_started_on)
values ('mapy', date_trunc('month', timezone('Europe/Prague', now()))::date)
on conflict (provider) do nothing;

-- Při prvním nasazení dopočítáme nejméně známou spotřebu aktuálního měsíce.
-- Automatické běhy mají přesný počet externích požadavků v metadata. U již
-- proběhlé ruční kontroly známe bezpečně alespoň první geokódovací požadavek.
with measured as (
  select
    coalesce((
      select sum(coalesce(nullif(run.metadata ->> 'externalRequestCount', '')::integer, 0)) * 4
      from public.complete_power_outage_runs run
      where run.provider = 'mapy'
        and run.run_kind = 'company_discovery'
        and run.started_at >= date_trunc('month', timezone('Europe/Prague', now())) at time zone 'Europe/Prague'
    ), 0)::integer as complete_credits,
    coalesce((
      select count(*) * 4
      from public.power_outage_store_address_suggestions suggestion
      where suggestion.analyzed_at >= date_trunc('month', timezone('Europe/Prague', now())) at time zone 'Europe/Prague'
    ), 0)::integer as markets_credits
)
update public.power_outage_mapy_credit_usage usage
set month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date,
    complete_credit_count = measured.complete_credits,
    markets_credit_count = measured.markets_credits,
    total_credit_count = measured.complete_credits + measured.markets_credits,
    updated_at = now()
from measured
where usage.provider = 'mapy'
  and usage.total_credit_count = 0;

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
    raise exception 'Neznámý odběratel kreditů Mapy.com: %', requested_consumer;
  end if;
  if safe_credits not between 1 and 100 then
    raise exception 'Neplatný počet kreditů Mapy.com.';
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

  if usage_row.total_credit_count + safe_credits > 245000 then
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

-- Providerová kvóta zůstává atomická. U Mapy.com ve stejné transakci navíc
-- rezervuje čtyři kredity ze společného měsíčního rozpočtu.
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

create or replace view public.complete_power_outage_provider_overview
with (security_invoker = true)
as
select
  quota.provider,
  coalesce(counts.ready_count, 0)::integer as ready_count,
  coalesce(counts.pending_count, 0)::integer as pending_count,
  coalesce(counts.not_found_count, 0)::integer as not_found_count,
  coalesce(counts.error_count, 0)::integer as error_count,
  quota.minute_request_count,
  quota.day_request_count,
  quota.last_request_at,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.total_credit_count
    else 0
  end::integer as monthly_credit_count,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.complete_credit_count
    else 0
  end::integer as complete_credit_count,
  case
    when quota.provider = 'mapy'
     and usage.month_started_on = date_trunc('month', timezone('Europe/Prague', now()))::date
      then usage.markets_credit_count
    else 0
  end::integer as markets_credit_count
from public.complete_power_outage_provider_quota quota
left join lateral (
  select
    count(*) filter (where lookup.lookup_status = 'ready') as ready_count,
    count(*) filter (where lookup.lookup_status = 'pending') as pending_count,
    count(*) filter (where lookup.lookup_status = 'not_found') as not_found_count,
    count(*) filter (where lookup.lookup_status = 'error') as error_count
  from public.complete_power_outage_target_lookups lookup
  where lookup.provider = quota.provider
) counts on true
left join public.power_outage_mapy_credit_usage usage
  on usage.provider = quota.provider
where quota.provider in ('ares', 'mapy', 'google');

alter table public.power_outage_mapy_credit_usage enable row level security;
drop policy if exists power_outage_mapy_credit_usage_authorized_read
  on public.power_outage_mapy_credit_usage;
create policy power_outage_mapy_credit_usage_authorized_read
  on public.power_outage_mapy_credit_usage
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on function public.claim_power_outage_mapy_credits(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_power_outage_mapy_credits(text, integer)
  to service_role;
revoke all on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_provider_quota(text, integer, integer)
  to service_role;

revoke all on table public.power_outage_mapy_credit_usage
  from public, anon, authenticated;
grant select on table public.power_outage_mapy_credit_usage to authenticated;
grant all on table public.power_outage_mapy_credit_usage to service_role;

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview to authenticated;

commit;

select 'FUNCTION' as check_type, 'shared Mapy.com credit claim' as object_name,
  to_regprocedure('public.claim_power_outage_mapy_credits(text,integer)') is not null as is_correct
union all select 'FUNCTION', 'complete provider quota includes shared Mapy.com budget',
  pg_get_functiondef('public.claim_complete_power_outage_provider_quota(text,integer,integer)'::regprocedure)
    like '%claim_power_outage_mapy_credits%'
union all select 'POLICY', 'shared Mapy.com credit usage authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'power_outage_mapy_credit_usage'
      and policyname = 'power_outage_mapy_credit_usage_authorized_read'
  )
union all select 'RLS', 'power_outage_mapy_credit_usage',
  coalesce((select relrowsecurity from pg_class where oid = 'public.power_outage_mapy_credit_usage'::regclass), false)
union all select 'TABLE', 'power_outage_mapy_credit_usage',
  to_regclass('public.power_outage_mapy_credit_usage') is not null
union all select 'VIEW', 'complete provider overview exposes shared Mapy.com usage',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_provider_overview'
      and column_name = 'monthly_credit_count'
  )
order by check_type, object_name;

