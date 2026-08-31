begin;

drop index if exists public.power_outage_store_matches_outage_store_uidx;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'power_outage_store_matches_outage_store_unique'
      and conrelid = 'public.power_outage_store_matches'::regclass
  ) then
    alter table public.power_outage_store_matches
      add constraint power_outage_store_matches_outage_store_unique
      unique (outage_id, store_id);
  end if;
end
$$;

create table if not exists public.power_outage_match_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  trigger_kind text not null default 'scheduled',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  store_revision bigint not null,
  outage_count integer not null default 0,
  address_count integer not null default 0,
  store_count integer not null default 0,
  confirmed_count integer not null default 0,
  review_count integer not null default 0,
  preserved_manual_count integer not null default 0,
  removed_stale_count integer not null default 0,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint power_outage_match_runs_status_check
    check (status in ('running', 'succeeded', 'failed', 'skipped')),
  constraint power_outage_match_runs_trigger_check
    check (trigger_kind in ('scheduled', 'manual', 'store_change', 'source_sync', 'retry')),
  constraint power_outage_match_runs_finished_check
    check (
      (status = 'running' and finished_at is null)
      or (status <> 'running' and finished_at is not null)
    ),
  constraint power_outage_match_runs_counts_check
    check (
      store_revision >= 1
      and outage_count >= 0
      and address_count >= 0
      and store_count >= 0
      and confirmed_count >= 0
      and review_count >= 0
      and preserved_manual_count >= 0
      and removed_stale_count >= 0
    ),
  constraint power_outage_match_runs_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.power_outage_match_runs is
  'Audit automatického porovnávání normalizovaných odstávek s aktuálním katalogem Prodejen.';

create unique index if not exists power_outage_match_runs_one_running_uidx
  on public.power_outage_match_runs ((true))
  where status = 'running';

create index if not exists power_outage_match_runs_started_idx
  on public.power_outage_match_runs (started_at desc);

alter table public.power_outage_match_runs enable row level security;

drop policy if exists power_outage_match_runs_authorized_read
  on public.power_outage_match_runs;
create policy power_outage_match_runs_authorized_read
  on public.power_outage_match_runs
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_match_runs
  from public, anon, authenticated;
grant select on table public.power_outage_match_runs to authenticated;
grant all on table public.power_outage_match_runs to service_role;

commit;

select 'CONSTRAINT' as check_type,
  'power_outage_store_matches_outage_store_unique' as object_name,
  exists (
    select 1
    from pg_constraint
    where conname = 'power_outage_store_matches_outage_store_unique'
      and conrelid = 'public.power_outage_store_matches'::regclass
  ) as is_correct
union all
select 'TABLE', 'power_outage_match_runs',
  to_regclass('public.power_outage_match_runs') is not null
union all
select 'RLS', 'power_outage_match_runs',
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'power_outage_match_runs'
  ), false)
union all
select 'INDEX', 'power_outage_match_runs_one_running_uidx',
  to_regclass('public.power_outage_match_runs_one_running_uidx') is not null
order by check_type, object_name;
