begin;

alter table public.complete_power_outage_addresses
  add column if not exists normalization_version integer not null default 0,
  add column if not exists normalized_at timestamptz;

alter table public.complete_power_outage_addresses
  drop constraint if exists cpo_addresses_normalization_version_check;
alter table public.complete_power_outage_addresses
  add constraint cpo_addresses_normalization_version_check
  check (normalization_version >= 0);

create index if not exists cpo_addresses_normalization_queue_idx
  on public.complete_power_outage_addresses (normalization_version, id);

create table if not exists public.complete_power_outage_address_targets (
  id uuid primary key default gen_random_uuid(),
  outage_address_id uuid not null
    references public.complete_power_outage_addresses(id) on delete cascade,
  target_key text not null,
  target_kind text not null,
  municipality text not null default '',
  town_part text,
  street text not null default '',
  number_token text,
  query_text text not null,
  lookup_status text not null default 'pending',
  lookup_priority integer not null default 100,
  lookup_attempt_count integer not null default 0,
  lookup_next_attempt_at timestamptz,
  lookup_started_at timestamptz,
  lookup_finished_at timestamptz,
  lookup_error_code text,
  lookup_error_message text,
  processing_token uuid,
  processing_expires_at timestamptz,
  latitude double precision,
  longitude double precision,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_address_targets_key_check
    check (target_key ~ '^[a-f0-9]{64}$'),
  constraint cpo_address_targets_kind_check
    check (target_kind in ('exact_number', 'street', 'municipality')),
  constraint cpo_address_targets_query_check
    check (length(btrim(query_text)) between 1 and 300),
  constraint cpo_address_targets_status_check
    check (lookup_status in ('pending', 'processing', 'complete', 'needs_review', 'not_found', 'error', 'skipped')),
  constraint cpo_address_targets_queue_check check (
    lookup_priority >= 0
    and lookup_attempt_count >= 0
    and (
      (processing_token is null and processing_expires_at is null)
      or (processing_token is not null and processing_expires_at is not null)
    )
  ),
  constraint cpo_address_targets_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  ),
  constraint cpo_address_targets_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_address_targets_address_key_unique
    unique (outage_address_id, target_key)
);

comment on table public.complete_power_outage_address_targets is
  'Deduplikované adresní cíle odvozené ze skupinových adres distributorů pro následné dohledávání firem.';

create index if not exists cpo_address_targets_queue_idx
  on public.complete_power_outage_address_targets (
    lookup_status, lookup_priority, lookup_next_attempt_at, created_at
  )
  where lookup_status in ('pending', 'error');

create index if not exists cpo_address_targets_address_idx
  on public.complete_power_outage_address_targets (outage_address_id);

drop trigger if exists cpo_address_targets_set_updated_at
  on public.complete_power_outage_address_targets;
create trigger cpo_address_targets_set_updated_at
before update on public.complete_power_outage_address_targets
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_address_targets enable row level security;

drop policy if exists cpo_address_targets_authorized_read
  on public.complete_power_outage_address_targets;
create policy cpo_address_targets_authorized_read
  on public.complete_power_outage_address_targets
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_address_targets
  from public, anon, authenticated;
grant select on table public.complete_power_outage_address_targets to authenticated;
grant all on table public.complete_power_outage_address_targets to service_role;

create or replace function public.request_complete_power_outage_address_normalization(
  requested_limit integer default 1500
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(2000, greatest(1, coalesce(requested_limit, 1500)));
  request_id bigint;
begin
  select trim(trailing '/' from decrypted_secret)
  into app_url
  from vault.decrypted_secrets
  where name = 'weather_alerts_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret
  into automation_token
  from vault.decrypted_secrets
  where name = 'weather_alerts_automation_token'
  order by created_at desc
  limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace bez cesty.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/addresses/normalize?limit=' || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Outages-Normalizer/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_address_normalization(integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_address_normalization(integer)
  to service_role;

commit;

select 'FUNCTION' as check_type,
  'request_complete_power_outage_address_normalization' as object_name,
  to_regprocedure('public.request_complete_power_outage_address_normalization(integer)') is not null as is_correct
union all
select 'COLUMN', 'complete addresses normalization cursor',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'complete_power_outage_addresses'
      and column_name = 'normalization_version'
  )
union all
select 'INDEX', 'complete address target deduplication',
  to_regclass('public.cpo_address_targets_address_key_unique') is not null
union all
select 'POLICY', 'complete address targets authorized read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'complete_power_outage_address_targets'
      and policyname = 'cpo_address_targets_authorized_read'
  )
union all
select 'RLS', 'complete_power_outage_address_targets',
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'complete_power_outage_address_targets'
  ), false)
union all
select 'TABLE', 'complete_power_outage_address_targets',
  to_regclass('public.complete_power_outage_address_targets') is not null
order by check_type, object_name;
