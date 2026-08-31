begin;

alter table public.power_outages
  add column if not exists archived_at timestamptz;

comment on column public.power_outages.archived_at is
  'Okamžik skutečného přesunu záznamu do archivu; nejdříve 24 hodin po ends_at.';

create or replace function public.prepare_power_outage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.archive_at := new.ends_at + interval '24 hours';
  if tg_op = 'INSERT' and new.last_seen_at < new.first_seen_at then
    new.first_seen_at := new.last_seen_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create index if not exists power_outages_archived_at_idx
  on public.power_outages (archived_at, archive_at);

create table if not exists public.power_outage_task_state (
  task_key text primary key,
  lock_token uuid,
  lock_expires_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_status text not null default 'pending',
  consecutive_failure_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_task_state_key_check check (
    task_key in ('sync_cez', 'sync_egd', 'store_queue', 'watchdog', 'archive', 'store_audit')
  ),
  constraint power_outage_task_state_lock_pair_check check (
    (lock_token is null and lock_expires_at is null)
    or (lock_token is not null and lock_expires_at is not null)
  ),
  constraint power_outage_task_state_status_check check (
    last_status in ('pending', 'running', 'succeeded', 'failed')
  ),
  constraint power_outage_task_state_failure_count_check check (
    consecutive_failure_count >= 0
  ),
  constraint power_outage_task_state_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.power_outage_task_state (task_key)
values
  ('sync_cez'),
  ('sync_egd'),
  ('store_queue'),
  ('watchdog'),
  ('archive'),
  ('store_audit')
on conflict (task_key) do nothing;

drop trigger if exists power_outage_task_state_set_updated_at
  on public.power_outage_task_state;
create trigger power_outage_task_state_set_updated_at
before update on public.power_outage_task_state
for each row execute function public.set_power_outage_updated_at();

create or replace function public.claim_power_outage_task(
  requested_task_key text,
  requested_lease_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_token uuid := gen_random_uuid();
  claimed_token uuid;
  safe_lease_seconds integer := least(7200, greatest(60, requested_lease_seconds));
begin
  if requested_task_key not in (
    'sync_cez', 'sync_egd', 'store_queue', 'watchdog', 'archive', 'store_audit'
  ) then
    raise exception 'Neznámý plánovaný úkol odstávek: %', requested_task_key;
  end if;

  insert into public.power_outage_task_state (
    task_key,
    lock_token,
    lock_expires_at,
    last_started_at,
    last_status,
    last_error_code,
    last_error_message
  ) values (
    requested_task_key,
    next_token,
    now() + make_interval(secs => safe_lease_seconds),
    now(),
    'running',
    null,
    null
  )
  on conflict (task_key) do update
    set lock_token = excluded.lock_token,
        lock_expires_at = excluded.lock_expires_at,
        last_started_at = excluded.last_started_at,
        last_status = 'running',
        last_error_code = null,
        last_error_message = null
    where public.power_outage_task_state.lock_token is null
       or public.power_outage_task_state.lock_expires_at <= now()
  returning lock_token into claimed_token;

  return claimed_token;
end;
$$;

create or replace function public.finish_power_outage_task(
  requested_task_key text,
  requested_lock_token uuid,
  succeeded boolean,
  error_code text default null,
  error_message text default null,
  result_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.power_outage_task_state
  set lock_token = null,
      lock_expires_at = null,
      last_finished_at = now(),
      last_success_at = case when succeeded then now() else last_success_at end,
      last_status = case when succeeded then 'succeeded' else 'failed' end,
      consecutive_failure_count = case
        when succeeded then 0
        else consecutive_failure_count + 1
      end,
      last_error_code = case when succeeded then null else error_code end,
      last_error_message = case when succeeded then null else left(error_message, 2000) end,
      metadata = coalesce(result_metadata, '{}'::jsonb)
  where task_key = requested_task_key
    and lock_token = requested_lock_token;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create or replace function public.archive_expired_power_outages()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  completed_count integer := 0;
  archived_count integer := 0;
  processed_at timestamptz := now();
begin
  update public.power_outages
  set source_status = 'completed'
  where ends_at <= processed_at
    and source_status in ('scheduled', 'active');
  get diagnostics completed_count = row_count;

  update public.power_outages
  set archived_at = processed_at
  where archive_at <= processed_at
    and archived_at is null;
  get diagnostics archived_count = row_count;

  return jsonb_build_object(
    'completedCount', completed_count,
    'archivedCount', archived_count,
    'processedAt', processed_at
  );
end;
$$;

create or replace function public.run_power_outage_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checked_at timestamptz := now();
  expired_task_locks integer := 0;
  stale_source_runs integer := 0;
  stale_match_runs integer := 0;
  stale_store_audits integer := 0;
  stale_sources integer := 0;
  stale_source record;
begin
  update public.power_outage_task_state
  set lock_token = null,
      lock_expires_at = null,
      last_finished_at = checked_at,
      last_status = 'failed',
      consecutive_failure_count = consecutive_failure_count + 1,
      last_error_code = 'TASK_LEASE_EXPIRED',
      last_error_message = 'Plánovaný úkol nedokončil běh před vypršením bezpečnostního zámku.'
  where lock_token is not null
    and lock_expires_at <= checked_at
    and task_key <> 'watchdog';
  get diagnostics expired_task_locks = row_count;

  for stale_source in
    select source, count(*)::integer as run_count
    from public.power_outage_sync_runs
    where status = 'running'
      and started_at < checked_at - interval '90 minutes'
    group by source
  loop
    update public.power_outage_source_state
    set last_error_at = checked_at,
        last_error_code = upper(stale_source.source) || '_SYNC_STALE',
        last_error_message = 'Synchronizace zdroje překročila bezpečnostní limit 90 minut.',
        consecutive_failure_count = consecutive_failure_count + 1
    where source = stale_source.source;
  end loop;

  update public.power_outage_sync_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = upper(source) || '_SYNC_STALE',
      error_message = 'Synchronizace zdroje překročila bezpečnostní limit 90 minut.'
  where status = 'running'
    and started_at < checked_at - interval '90 minutes';
  get diagnostics stale_source_runs = row_count;

  update public.power_outage_match_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = 'STORE_MATCH_STALE',
      error_message = 'Párování odstávek překročilo bezpečnostní limit 60 minut.'
  where status = 'running'
    and started_at < checked_at - interval '60 minutes';
  get diagnostics stale_match_runs = row_count;

  update public.power_outage_store_audit_runs
  set status = 'failed',
      finished_at = checked_at,
      error_code = 'STORE_AUDIT_STALE',
      error_message = 'Úplný audit Prodejen překročil bezpečnostní limit 60 minut.'
  where status = 'running'
    and started_at < checked_at - interval '60 minutes';
  get diagnostics stale_store_audits = row_count;

  update public.power_outage_source_state
  set last_error_at = checked_at,
      last_error_code = 'SOURCE_STALE',
      last_error_message = 'Zdroj nebyl úspěšně aktualizován déle než 8 hodin.',
      consecutive_failure_count = greatest(consecutive_failure_count, 1)
  where (last_success_at is null or last_success_at < checked_at - interval '8 hours')
    and last_error_code is distinct from 'SOURCE_STALE';
  get diagnostics stale_sources = row_count;

  return jsonb_build_object(
    'expiredTaskLocks', expired_task_locks,
    'staleSourceRuns', stale_source_runs,
    'staleMatchRuns', stale_match_runs,
    'staleStoreAudits', stale_store_audits,
    'staleSources', stale_sources,
    'checkedAt', checked_at
  );
end;
$$;

alter table public.power_outage_task_state enable row level security;

drop policy if exists power_outage_task_state_authorized_read
  on public.power_outage_task_state;
create policy power_outage_task_state_authorized_read
  on public.power_outage_task_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_task_state from public, anon, authenticated;
grant select on table public.power_outage_task_state to authenticated;
grant all on table public.power_outage_task_state to service_role;

revoke all on function public.claim_power_outage_task(text, integer)
  from public, anon, authenticated;
revoke all on function public.finish_power_outage_task(text, uuid, boolean, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.archive_expired_power_outages()
  from public, anon, authenticated;
revoke all on function public.run_power_outage_watchdog()
  from public, anon, authenticated;

grant execute on function public.claim_power_outage_task(text, integer) to service_role;
grant execute on function public.finish_power_outage_task(text, uuid, boolean, text, text, jsonb) to service_role;
grant execute on function public.archive_expired_power_outages() to service_role;
grant execute on function public.run_power_outage_watchdog() to service_role;

commit;

select 'COLUMN' as check_type,
  'power_outages.archived_at' as object_name,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'power_outages'
      and column_name = 'archived_at'
  ) as is_correct
union all
select 'TABLE', 'power_outage_task_state',
  to_regclass('public.power_outage_task_state') is not null
union all
select 'RLS', 'power_outage_task_state',
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'power_outage_task_state'
      and c.relrowsecurity
  )
union all
select 'FUNCTION', 'claim_power_outage_task',
  to_regprocedure('public.claim_power_outage_task(text,integer)') is not null
union all
select 'FUNCTION', 'finish_power_outage_task',
  to_regprocedure('public.finish_power_outage_task(text,uuid,boolean,text,text,jsonb)') is not null
union all
select 'FUNCTION', 'archive_expired_power_outages',
  to_regprocedure('public.archive_expired_power_outages()') is not null
union all
select 'FUNCTION', 'run_power_outage_watchdog',
  to_regprocedure('public.run_power_outage_watchdog()') is not null
union all
select 'STATE', 'all power outage tasks initialized',
  (select count(*) = 6 from public.power_outage_task_state)
order by check_type, object_name;
