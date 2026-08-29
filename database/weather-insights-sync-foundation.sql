begin;

alter table public.weather_feed_state
  add column if not exists lock_token uuid;

alter table public.weather_feed_state
  add column if not exists lock_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'weather_feed_state_lock_pair_check'
      and conrelid = 'public.weather_feed_state'::regclass
  ) then
    alter table public.weather_feed_state
      add constraint weather_feed_state_lock_pair_check
      check (
        (lock_token is null and lock_expires_at is null)
        or (lock_token is not null and lock_expires_at is not null)
      );
  end if;
end
$$;

create or replace function public.claim_weather_feed_sync(
  p_feed_key text,
  p_lock_token uuid,
  p_ttl_seconds integer default 240
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  if p_feed_key not in ('radar', 'observations', 'forecast') then
    raise exception 'Neznámý datový kanál počasí.';
  end if;

  if p_lock_token is null then
    raise exception 'Chybí token synchronizačního zámku.';
  end if;

  if p_ttl_seconds < 30 or p_ttl_seconds > 900 then
    raise exception 'TTL synchronizačního zámku musí být 30 až 900 sekund.';
  end if;

  update public.weather_feed_state
  set
    lock_token = p_lock_token,
    lock_expires_at = now() + make_interval(secs => p_ttl_seconds),
    last_attempt_at = now(),
    updated_at = now()
  where feed_key = p_feed_key
    and (
      lock_token is null
      or lock_expires_at is null
      or lock_expires_at <= now()
    );

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

comment on function public.claim_weather_feed_sync(text, uuid, integer) is
  'Atomicky získá krátkodobý zámek pro jeden doplňkový datový kanál ČHMÚ.';

create or replace function public.complete_weather_feed_sync(
  p_feed_key text,
  p_lock_token uuid,
  p_succeeded boolean,
  p_changed boolean default false,
  p_source_ref text default null,
  p_payload_sha256 text default null,
  p_error_code text default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
  completed_at timestamptz := now();
begin
  if p_feed_key not in ('radar', 'observations', 'forecast') then
    raise exception 'Neznámý datový kanál počasí.';
  end if;

  if p_lock_token is null then
    raise exception 'Chybí token synchronizačního zámku.';
  end if;

  if p_payload_sha256 is not null
    and p_payload_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Neplatný SHA-256 otisk zdrojových dat.';
  end if;

  update public.weather_feed_state
  set
    last_success_at = case
      when p_succeeded then completed_at
      else last_success_at
    end,
    last_change_at = case
      when p_succeeded and p_changed then completed_at
      else last_change_at
    end,
    latest_source_ref = case
      when p_succeeded and p_source_ref is not null then p_source_ref
      else latest_source_ref
    end,
    latest_payload_sha256 = case
      when p_succeeded and p_payload_sha256 is not null then p_payload_sha256
      else latest_payload_sha256
    end,
    consecutive_failure_count = case
      when p_succeeded then 0
      else consecutive_failure_count + 1
    end,
    last_error_at = case
      when p_succeeded then null
      else completed_at
    end,
    last_error_code = case
      when p_succeeded then null
      else left(coalesce(p_error_code, 'WEATHER_FEED_SYNC_FAILED'), 120)
    end,
    last_error_message = case
      when p_succeeded then null
      else left(coalesce(p_error_message, 'Neznámá chyba synchronizace.'), 2000)
    end,
    data_version = data_version + case
      when p_succeeded and p_changed then 1
      else 0
    end,
    metadata = case
      when p_metadata is null then metadata
      else metadata || p_metadata
    end,
    lock_token = null,
    lock_expires_at = null,
    updated_at = completed_at
  where feed_key = p_feed_key
    and lock_token = p_lock_token;

  get diagnostics affected_rows = row_count;
  return affected_rows = 1;
end;
$$;

comment on function public.complete_weather_feed_sync(
  text,
  uuid,
  boolean,
  boolean,
  text,
  text,
  text,
  text,
  jsonb
) is
  'Atomicky dokončí synchronizaci, aktualizuje health stav a uvolní její zámek.';

revoke all on function public.claim_weather_feed_sync(text, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_weather_feed_sync(
  text,
  uuid,
  boolean,
  boolean,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.claim_weather_feed_sync(text, uuid, integer)
  to service_role;
grant execute on function public.complete_weather_feed_sync(
  text,
  uuid,
  boolean,
  boolean,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

commit;

-- Ověřovací dotaz po spuštění:
select 'COLUMN' as check_type, 'weather_feed_state.lock_token' as object_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weather_feed_state'
      and column_name = 'lock_token'
  ) as is_correct
union all
select 'COLUMN', 'weather_feed_state.lock_expires_at',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weather_feed_state'
      and column_name = 'lock_expires_at'
  )
union all
select 'CONSTRAINT', 'weather_feed_state_lock_pair_check',
  exists (
    select 1 from pg_constraint
    where conname = 'weather_feed_state_lock_pair_check'
      and conrelid = 'public.weather_feed_state'::regclass
  )
union all
select 'FUNCTION', 'claim_weather_feed_sync',
  to_regprocedure('public.claim_weather_feed_sync(text,uuid,integer)') is not null
union all
select 'FUNCTION', 'complete_weather_feed_sync',
  to_regprocedure(
    'public.complete_weather_feed_sync(text,uuid,boolean,boolean,text,text,text,text,jsonb)'
  ) is not null
order by check_type, object_name;
