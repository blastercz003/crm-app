begin;

create extension if not exists unaccent;
create extension if not exists pg_cron;

do $$
begin
  if to_regclass('public.complete_power_outage_companies') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regclass('public.jobs') is null
    or to_regclass('public.clients') is null
    or to_regprocedure('public.power_outage_normalize_job_city(text)') is null
    or to_regprocedure('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)') is null
    or to_regprocedure('public.current_user_can_view_power_outages()') is null
  then
    raise exception 'Chybi zavislosti pro propojeni zakazek s KOMPLETNIMI odstavkami.';
  end if;
end
$$;

-- Stejne jako v rezimu MARKETY jde o zamerne jednoduchou obchodni vazbu.
-- Nepouziva ICO, presnou adresu ani presny cas. Nazev zbavuje pouze beznych
-- pravnich koncovek; nejde o fuzzy podobnost mezi ruznymi firmami.
create or replace function public.complete_power_outage_normalize_job_company(value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select btrim(regexp_replace(
    btrim(regexp_replace(
      lower(public.unaccent(value)),
      '[^[:alnum:]]+',
      ' ',
      'g'
    )),
    '( spol s r o| s r o| a s| v o s| k s)+$',
    '',
    'g'
  ));
$$;

revoke all on function public.complete_power_outage_normalize_job_company(text)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_normalize_job_company(text)
  to service_role;

create table if not exists public.complete_power_outage_job_links (
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  job_number text not null,
  normalized_company_name text not null,
  normalized_city text not null,
  overlapping_day date not null,
  first_linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  primary key (candidate_id, job_id),
  constraint cpo_job_links_company_name_check check (normalized_company_name <> ''),
  constraint cpo_job_links_city_check check (normalized_city <> '')
);

create index if not exists cpo_job_links_job_idx
  on public.complete_power_outage_job_links (job_id, candidate_id);
create index if not exists cpo_job_links_candidate_idx
  on public.complete_power_outage_job_links (candidate_id, job_number desc);

alter table public.complete_power_outage_job_links enable row level security;
drop policy if exists cpo_job_links_authorized_read
  on public.complete_power_outage_job_links;
create policy cpo_job_links_authorized_read
  on public.complete_power_outage_job_links
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_job_links
  from public, anon, authenticated;
grant select on table public.complete_power_outage_job_links to authenticated;
grant all on table public.complete_power_outage_job_links to service_role;

create or replace view public.complete_power_outage_job_link_candidates
with (security_invoker = false)
as
select
  company.id as candidate_id,
  job.id as job_id,
  job.job_number,
  public.complete_power_outage_normalize_job_company(company.company_name)
    as normalized_company_name,
  public.power_outage_normalize_job_city(address.municipality) as normalized_city,
  greatest(
    (outage.starts_at at time zone 'Europe/Prague')::date,
    (job.start_at at time zone 'Europe/Prague')::date
  ) as overlapping_day
from public.complete_power_outage_companies company
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id
join public.jobs job
  on job.job_status <> 'storno'
 and daterange(
       (job.start_at at time zone 'Europe/Prague')::date,
       (coalesce(job.end_at, job.start_at) at time zone 'Europe/Prague')::date,
       '[]'
     ) && daterange(
       (outage.starts_at at time zone 'Europe/Prague')::date,
       (outage.ends_at at time zone 'Europe/Prague')::date,
       '[]'
     )
join public.clients client on client.id = job.client_id
where company.candidate_status not in ('dismissed', 'stale')
  and nullif(btrim(company.company_name), '') is not null
  and nullif(btrim(client.name), '') is not null
  and nullif(btrim(address.municipality), '') is not null
  and nullif(btrim(job.site_address), '') is not null
  and public.complete_power_outage_normalize_job_company(company.company_name) <> ''
  and public.complete_power_outage_normalize_job_company(client.name) <> ''
  and public.power_outage_normalize_job_city(address.municipality) <> ''
  and public.power_outage_normalize_job_city(split_part(job.site_address, ',', 1)) <> ''
  and public.complete_power_outage_normalize_job_company(company.company_name)
      = public.complete_power_outage_normalize_job_company(client.name)
  and public.power_outage_normalize_job_city(address.municipality)
      = public.power_outage_normalize_job_city(split_part(job.site_address, ',', 1));

revoke all on table public.complete_power_outage_job_link_candidates
  from public, anon, authenticated;

create or replace function public.reconcile_complete_power_outage_job_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  removed_count integer := 0;
  inserted_count integer := 0;
  verified_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_power_outage_job_links_reconcile', 0)
  ) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_running',
      'finishedAt', now()
    );
  end if;

  delete from public.complete_power_outage_job_links link
  where not exists (
    select 1
    from public.complete_power_outage_job_link_candidates candidate
    where candidate.candidate_id = link.candidate_id
      and candidate.job_id = link.job_id
  );
  get diagnostics removed_count = row_count;

  with reconciled as (
    insert into public.complete_power_outage_job_links (
      candidate_id, job_id, job_number, normalized_company_name,
      normalized_city, overlapping_day, last_verified_at
    )
    select
      candidate.candidate_id,
      candidate.job_id,
      candidate.job_number,
      candidate.normalized_company_name,
      candidate.normalized_city,
      candidate.overlapping_day,
      now()
    from public.complete_power_outage_job_link_candidates candidate
    on conflict (candidate_id, job_id) do update set
      job_number = excluded.job_number,
      normalized_company_name = excluded.normalized_company_name,
      normalized_city = excluded.normalized_city,
      overlapping_day = excluded.overlapping_day,
      last_verified_at = now()
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*)
  into inserted_count, verified_count
  from reconciled;

  return jsonb_build_object(
    'ok', true,
    'insertedCount', inserted_count,
    'removedCount', removed_count,
    'verifiedCount', verified_count,
    'finishedAt', now()
  );
end;
$$;

revoke all on function public.reconcile_complete_power_outage_job_links()
  from public, anon, authenticated;
grant execute on function public.reconcile_complete_power_outage_job_links()
  to service_role;

-- Kompatibilni obalka zachovava vsechny filtry, oba zpusoby razeni i kurzory
-- v4. Pouze doplni prvni zakazku a celkovy pocet vazeb do polozek dane stranky.
create or replace function public.get_complete_power_outage_company_page_v5(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all',
  p_sort text default 'date'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  enriched_items jsonb;
begin
  result := public.get_complete_power_outage_company_page_v4(
    p_mode, p_limit, p_cursor_at, p_cursor_id, p_cursor_score, p_query,
    p_owner_filter, p_source, p_entity_kind, p_candidate_status,
    p_commercial_filter, p_sort
  );

  select coalesce(jsonb_agg(
    item.value || case
      when linked.job_id is null then jsonb_build_object(
        'linked_job_id', null,
        'linked_job_number', null,
        'linked_job_count', 0
      )
      else jsonb_build_object(
        'linked_job_id', linked.job_id,
        'linked_job_number', linked.job_number,
        'linked_job_count', linked.match_count
      )
    end
    order by item.ordinality
  ), '[]'::jsonb)
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'items', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join lateral (
    select
      link.job_id,
      link.job_number,
      count(*) over ()::integer as match_count
    from public.complete_power_outage_job_links link
    where link.candidate_id = (item.value ->> 'candidate_id')::uuid
    order by link.job_number desc
    limit 1
  ) linked on true;

  return jsonb_set(result, '{items}', enriched_items, true);
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v5(
  text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v5(
  text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text
) to authenticated;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_power_outage_job_links_every_fifteen_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_power_outage_job_links_every_fifteen_minutes',
    '12-57/15 * * * *',
    $job$select public.reconcile_complete_power_outage_job_links();$job$
  );
end
$$;

do $$
begin
  if to_regprocedure('public.publish_power_outages_app_change()') is not null then
    execute 'drop trigger if exists cpo_job_links_publish_app_change
      on public.complete_power_outage_job_links';
    execute 'create trigger cpo_job_links_publish_app_change
      after insert or update or delete on public.complete_power_outage_job_links
      for each statement execute function public.publish_power_outages_app_change()';
  end if;
end
$$;

select public.reconcile_complete_power_outage_job_links();

notify pgrst, 'reload schema';
commit;

select 'CRON' as check_type,
  'complete job linking every fifteen minutes' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'complete_power_outage_job_links_every_fifteen_minutes'
      and schedule = '12-57/15 * * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'complete job link reconciliation',
  to_regprocedure('public.reconcile_complete_power_outage_job_links()') is not null
union all
select 'FUNCTION', 'complete company page includes linked job',
  to_regprocedure('public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)') is not null
union all
select 'DATA', 'complete job links have valid candidates and jobs',
  not exists (
    select 1
    from public.complete_power_outage_job_links link
    left join public.complete_power_outage_companies company
      on company.id = link.candidate_id
    left join public.jobs job on job.id = link.job_id
    where company.id is null or job.id is null
  )
union all
select 'GRANT', 'authenticated cannot reconcile complete job links',
  not has_function_privilege(
    'authenticated',
    'public.reconcile_complete_power_outage_job_links()',
    'execute'
  )
union all
select 'ISOLATION', 'complete job links do not reference MARKET outage tables',
  position('public.power_outage_store_matches' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) = 0
union all
select 'LOGIC', 'complete job links ignore ICO and exact address',
  position('company.ico' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) = 0
  and position('address.street' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) = 0
union all
select 'LOGIC', 'complete job links compare calendar days only',
  position('Europe/Prague' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) > 0
  and position('daterange' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) > 0
  and position('tsrange' in pg_get_viewdef(
    'public.complete_power_outage_job_link_candidates'::regclass, true
  )) = 0
union all
select 'RLS', 'complete job links have RLS', coalesce((
  select relrowsecurity from pg_class
  where oid = 'public.complete_power_outage_job_links'::regclass
), false)
union all
select 'SAFETY', 'complete job linking does not mutate outage records',
  position('update public.complete_power_outages' in lower(pg_get_functiondef(
    'public.reconcile_complete_power_outage_job_links()'::regprocedure
  ))) = 0
union all
select 'TABLE', 'complete job links',
  to_regclass('public.complete_power_outage_job_links') is not null
order by check_type, object_name;
