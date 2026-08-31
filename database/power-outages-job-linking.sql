begin;

create extension if not exists unaccent;
create extension if not exists pg_cron;

create table if not exists public.power_outage_job_client_mappings (
  chain_name text primary key,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_name_snapshot text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_job_client_mappings_chain_check
    check (chain_name in ('PENNY MARKET', 'LIDL', 'BILLA', 'ALBERT'))
);

insert into public.power_outage_job_client_mappings (
  chain_name,
  client_id,
  client_name_snapshot,
  updated_at
)
values
  ('PENNY MARKET', '8095b4cd-7346-4f4f-8e4c-add6e9604a27', 'Penny Market, s.r.o.', now()),
  ('LIDL', '65ceb0ae-9099-4da3-b39c-fc6fe9845a68', 'Lidl Česká republika s.r.o.', now()),
  ('BILLA', '775ac43d-65dc-4c94-8838-72006969b8ee', 'BILLA, spol. s r. o.', now()),
  ('ALBERT', 'bbbc2527-48f8-4213-9319-4a3d3fa86a57', 'Albert Česká republika, s.r.o.', now())
on conflict (chain_name) do update
set client_id = excluded.client_id,
    client_name_snapshot = excluded.client_name_snapshot,
    updated_at = now();

create table if not exists public.power_outage_job_links (
  match_id uuid not null references public.power_outage_store_matches(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_number text not null,
  normalized_city text not null,
  overlapping_day date not null,
  first_linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  primary key (match_id, job_id),
  constraint power_outage_job_links_city_check check (normalized_city <> '')
);

create index if not exists power_outage_job_links_job_idx
  on public.power_outage_job_links (job_id, match_id);

create index if not exists power_outage_job_links_match_idx
  on public.power_outage_job_links (match_id, job_number);

create index if not exists jobs_power_outage_linking_idx
  on public.jobs (client_id, start_at, end_at)
  where job_status <> 'storno';

create or replace function public.power_outage_normalize_job_city(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(public.unaccent(trim(value))),
    '[^[:alnum:]]+',
    ' ',
    'g'
  ));
$$;

create or replace view public.power_outage_job_link_candidates
with (security_invoker = false)
as
select
  outage_match.id as match_id,
  job.id as job_id,
  job.job_number,
  public.power_outage_normalize_job_city(outage_match.store_city) as normalized_city,
  greatest(
    (outage.starts_at at time zone 'Europe/Prague')::date,
    (job.start_at at time zone 'Europe/Prague')::date
  ) as overlapping_day
from public.power_outage_store_matches as outage_match
join public.power_outages as outage
  on outage.id = outage_match.outage_id
join public.power_outage_job_client_mappings as mapping
  on mapping.chain_name = upper(trim(outage_match.store_chain_name))
join public.jobs as job
  on job.client_id = mapping.client_id
 and job.job_status <> 'storno'
 and daterange(
       (job.start_at at time zone 'Europe/Prague')::date,
       (coalesce(job.end_at, job.start_at) at time zone 'Europe/Prague')::date,
       '[]'
     ) && daterange(
       (outage.starts_at at time zone 'Europe/Prague')::date,
       (outage.ends_at at time zone 'Europe/Prague')::date,
       '[]'
     )
where outage_match.match_status <> 'dismissed'
  and nullif(trim(job.site_address), '') is not null
  and public.power_outage_normalize_job_city(split_part(job.site_address, ',', 1))
      = public.power_outage_normalize_job_city(outage_match.store_city);

revoke all on public.power_outage_job_link_candidates from public, anon, authenticated;

create or replace function public.reconcile_power_outage_job_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer := 0;
  inserted_count integer := 0;
  verified_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_job_links_reconcile', 0)
  ) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_running',
      'finishedAt', now()
    );
  end if;

  delete from public.power_outage_job_links as link
  where not exists (
    select 1
    from public.power_outage_job_link_candidates as candidate
    where candidate.match_id = link.match_id
      and candidate.job_id = link.job_id
  );
  get diagnostics removed_count = row_count;

  with inserted as (
    insert into public.power_outage_job_links (
      match_id,
      job_id,
      job_number,
      normalized_city,
      overlapping_day,
      last_verified_at
    )
    select
      candidate.match_id,
      candidate.job_id,
      candidate.job_number,
      candidate.normalized_city,
      candidate.overlapping_day,
      now()
    from public.power_outage_job_link_candidates as candidate
    on conflict (match_id, job_id) do update
    set job_number = excluded.job_number,
        normalized_city = excluded.normalized_city,
        overlapping_day = excluded.overlapping_day,
        last_verified_at = now()
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*)
  into inserted_count, verified_count
  from inserted;

  return jsonb_build_object(
    'ok', true,
    'insertedCount', inserted_count,
    'removedCount', removed_count,
    'verifiedCount', verified_count,
    'finishedAt', now()
  );
end;
$$;

revoke all on function public.reconcile_power_outage_job_links()
  from public, anon, authenticated;
grant execute on function public.reconcile_power_outage_job_links()
  to service_role;

alter table public.power_outage_job_client_mappings enable row level security;
alter table public.power_outage_job_links enable row level security;

drop policy if exists power_outage_job_client_mappings_authorized_read
  on public.power_outage_job_client_mappings;
create policy power_outage_job_client_mappings_authorized_read
  on public.power_outage_job_client_mappings
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists power_outage_job_links_authorized_read
  on public.power_outage_job_links;
create policy power_outage_job_links_authorized_read
  on public.power_outage_job_links
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_job_client_mappings from public, anon, authenticated;
revoke all on table public.power_outage_job_links from public, anon, authenticated;
grant select on table public.power_outage_job_client_mappings to authenticated;
grant select on table public.power_outage_job_links to authenticated;
grant all on table public.power_outage_job_client_mappings to service_role;
grant all on table public.power_outage_job_links to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'power_outages_job_links_every_fifteen_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_job_links_every_fifteen_minutes',
    '14-59/15 * * * *',
    $job$select public.reconcile_power_outage_job_links();$job$
  );
end
$$;

do $$
begin
  if to_regprocedure('public.publish_power_outages_app_change()') is not null then
    execute 'drop trigger if exists power_outage_job_links_publish_app_change on public.power_outage_job_links';
    execute 'create trigger power_outage_job_links_publish_app_change
      after insert or update or delete on public.power_outage_job_links
      for each statement execute function public.publish_power_outages_app_change()';
  end if;
end
$$;

select public.reconcile_power_outage_job_links();

commit;

select 'TABLE' as check_type,
  'power_outage_job_client_mappings' as object_name,
  to_regclass('public.power_outage_job_client_mappings') is not null as is_correct
union all
select 'TABLE', 'power_outage_job_links',
  to_regclass('public.power_outage_job_links') is not null
union all
select 'FUNCTION', 'reconcile_power_outage_job_links',
  to_regprocedure('public.reconcile_power_outage_job_links()') is not null
union all
select 'INDEX', 'jobs_power_outage_linking_idx',
  to_regclass('public.jobs_power_outage_linking_idx') is not null
union all
select 'RLS', 'power_outage_job_links',
  coalesce((select relrowsecurity from pg_class where oid = 'public.power_outage_job_links'::regclass), false)
union all
select 'CRON', 'power_outages_job_links_every_fifteen_minutes',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_job_links_every_fifteen_minutes'
      and schedule = '14-59/15 * * * *'
      and active
  )
union all
select 'MAPPING', 'all four store chains mapped',
  (select count(*) = 4 from public.power_outage_job_client_mappings)
order by check_type, object_name;
