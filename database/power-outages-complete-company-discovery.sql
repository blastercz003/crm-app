begin;

create table if not exists public.complete_power_outage_target_lookups (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.complete_power_outage_address_targets(id) on delete cascade,
  provider text not null,
  lookup_kind text not null,
  lookup_key text not null,
  lookup_status text not null default 'pending',
  cache_id uuid references public.complete_power_outage_lookup_cache(id) on delete set null,
  result_count integer not null default 0,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_target_lookups_provider_check check (provider in ('ares', 'mapy', 'google')),
  constraint cpo_target_lookups_kind_check check (lookup_kind in ('address', 'nearby', 'text')),
  constraint cpo_target_lookups_key_check check (lookup_key ~ '^[a-f0-9]{64}$'),
  constraint cpo_target_lookups_status_check check (
    lookup_status in ('pending', 'ready', 'not_found', 'error', 'skipped')
  ),
  constraint cpo_target_lookups_counts_check check (result_count >= 0 and attempt_count >= 0),
  constraint cpo_target_lookups_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_target_lookups_target_provider_unique unique (target_id, provider)
);

create index if not exists cpo_target_lookups_queue_idx
  on public.complete_power_outage_target_lookups (provider, lookup_status, next_attempt_at, created_at)
  where lookup_status in ('pending', 'error');
create index if not exists cpo_target_lookups_cache_idx
  on public.complete_power_outage_target_lookups (cache_id) where cache_id is not null;

drop trigger if exists cpo_target_lookups_set_updated_at on public.complete_power_outage_target_lookups;
create trigger cpo_target_lookups_set_updated_at
before update on public.complete_power_outage_target_lookups
for each row execute function public.set_power_outage_updated_at();

create table if not exists public.complete_power_outage_provider_quota (
  provider text primary key,
  minute_window_started_at timestamptz not null default date_trunc('minute', now()),
  minute_request_count integer not null default 0,
  day_window_started_at timestamptz not null default date_trunc('day', now()),
  day_request_count integer not null default 0,
  last_request_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cpo_provider_quota_provider_check check (provider in ('ares', 'mapy', 'google')),
  constraint cpo_provider_quota_counts_check check (
    minute_request_count >= 0 and day_request_count >= 0
  )
);

insert into public.complete_power_outage_provider_quota (provider)
values ('ares'), ('mapy'), ('google')
on conflict (provider) do nothing;

drop trigger if exists cpo_provider_quota_set_updated_at on public.complete_power_outage_provider_quota;
create trigger cpo_provider_quota_set_updated_at
before update on public.complete_power_outage_provider_quota
for each row execute function public.set_power_outage_updated_at();

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
     or requested_day_limit not between 1 and 10000 then
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

create or replace function public.request_complete_power_outage_company_discovery(
  requested_provider text,
  requested_limit integer default 5
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_provider text := lower(btrim(coalesce(requested_provider, '')));
  safe_limit integer := least(10, greatest(1, coalesce(requested_limit, 5)));
  request_id bigint;
begin
  if safe_provider not in ('ares', 'mapy', 'google') then
    raise exception 'Poskytovatel musí být ares, mapy nebo google.';
  end if;
  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url není platný.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí.';
  end if;
  select net.http_get(
    url := app_url || '/api/power-outages/complete/discover?provider=' || safe_provider
      || '&limit=' || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Outages-Discovery/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_company_discovery(text, integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_company_discovery(text, integer)
  to service_role;

alter table public.complete_power_outage_target_lookups enable row level security;
alter table public.complete_power_outage_provider_quota enable row level security;

drop policy if exists cpo_target_lookups_authorized_read on public.complete_power_outage_target_lookups;
create policy cpo_target_lookups_authorized_read on public.complete_power_outage_target_lookups
  for select to authenticated using (public.current_user_can_view_power_outages());
drop policy if exists cpo_provider_quota_authorized_read on public.complete_power_outage_provider_quota;
create policy cpo_provider_quota_authorized_read on public.complete_power_outage_provider_quota
  for select to authenticated using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_target_lookups from public, anon, authenticated;
revoke all on table public.complete_power_outage_provider_quota from public, anon, authenticated;
grant select on table public.complete_power_outage_target_lookups to authenticated;
grant select on table public.complete_power_outage_provider_quota to authenticated;
grant all on table public.complete_power_outage_target_lookups to service_role;
grant all on table public.complete_power_outage_provider_quota to service_role;

commit;

select 'FUNCTION' as check_type, 'claim provider quota' as object_name,
  to_regprocedure('public.claim_complete_power_outage_provider_quota(text,integer,integer)') is not null as is_correct
union all select 'FUNCTION', 'request company discovery',
  to_regprocedure('public.request_complete_power_outage_company_discovery(text,integer)') is not null
union all select 'RLS', 'complete_power_outage_target_lookups',
  coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_target_lookups'::regclass), false)
union all select 'RLS', 'complete_power_outage_provider_quota',
  coalesce((select relrowsecurity from pg_class where oid = 'public.complete_power_outage_provider_quota'::regclass), false)
union all select 'TABLE', 'complete_power_outage_target_lookups',
  to_regclass('public.complete_power_outage_target_lookups') is not null
union all select 'TABLE', 'complete_power_outage_provider_quota',
  to_regclass('public.complete_power_outage_provider_quota') is not null
order by check_type, object_name;
