begin;

-- Vyhodnoceni nalezenych firem je samostatna faze za ARES/Mapy.com. Fronta
-- musi byt ferova mezi distributory; soucasne nesmi zpracovavat archiv na
-- ukor aktualnich odstavek.
create or replace function public.get_complete_power_outage_company_evaluation_queue(
  requested_limit integer default 250
)
returns table (outage_address_id uuid)
language sql
security definer
set search_path = ''
stable
as $$
  with parameters as (
    select least(1000, greatest(1, coalesce(requested_limit, 250)))::integer as batch_limit
  ), quotas as (
    select
      batch_limit,
      ((batch_limit * 60 + 99) / 100)::integer as cez_limit,
      ((batch_limit * 35) / 100)::integer as egd_limit,
      (batch_limit - ((batch_limit * 60 + 99) / 100) - ((batch_limit * 35) / 100))::integer as pre_limit
    from parameters
  ), eligible as (
    select
      company.outage_address_id,
      outage.source,
      min(company.updated_at) as waiting_since
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    where company.evaluation_version < 2
      and company.candidate_status in ('new', 'confirmed', 'needs_review')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
    group by company.outage_address_id, outage.source
  ), ranked as (
    select eligible.*,
      row_number() over (
        partition by eligible.source
        order by eligible.waiting_since, eligible.outage_address_id
      ) as source_position
    from eligible
  ), reserved as (
    select ranked.*
    from ranked cross join quotas
    where ranked.source_position <= case ranked.source
      when 'cez' then quotas.cez_limit
      when 'egd' then quotas.egd_limit
      when 'pre' then quotas.pre_limit
      else 0
    end
  ), spill as (
    select ranked.*
    from ranked cross join quotas
    where not exists (
      select 1 from reserved
      where reserved.outage_address_id = ranked.outage_address_id
    )
    order by ranked.waiting_since, ranked.outage_address_id
    limit greatest(0, (select batch_limit from quotas) - (select count(*) from reserved))
  )
  select selected.outage_address_id
  from (
    select 0 as selection_order, reserved.* from reserved
    union all
    select 1 as selection_order, spill.* from spill
  ) selected
  order by
    selected.selection_order,
    case selected.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    selected.waiting_since,
    selected.outage_address_id;
$$;

revoke all on function public.get_complete_power_outage_company_evaluation_queue(integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_company_evaluation_queue(integer)
  to service_role;

-- Konstantni snapshot oddeluje hotove providerove dotazy od navazujiciho
-- vyhodnoceni kandidatu. Provider "all" je deduplikovany souhrn zdroje.
create table if not exists public.complete_power_outage_evaluation_progress_snapshot (
  source text not null,
  provider text not null,
  candidate_count bigint not null default 0,
  evaluated_candidate_count bigint not null default 0,
  pending_candidate_count bigint not null default 0,
  last_evaluated_at timestamptz,
  refreshed_at timestamptz not null default now(),
  primary key (source, provider),
  constraint cpo_evaluation_progress_source_check
    check (source in ('cez', 'egd', 'pre')),
  constraint cpo_evaluation_progress_provider_check
    check (provider in ('all', 'ares', 'mapy', 'google')),
  constraint cpo_evaluation_progress_counts_check check (
    candidate_count >= 0
    and evaluated_candidate_count >= 0
    and pending_candidate_count >= 0
    and evaluated_candidate_count + pending_candidate_count = candidate_count
  )
);

alter table public.complete_power_outage_evaluation_progress_snapshot
  enable row level security;
drop policy if exists cpo_evaluation_progress_authorized_read
  on public.complete_power_outage_evaluation_progress_snapshot;
create policy cpo_evaluation_progress_authorized_read
  on public.complete_power_outage_evaluation_progress_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_evaluation_progress_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_evaluation_progress_snapshot
  to authenticated;
grant all on table public.complete_power_outage_evaluation_progress_snapshot
  to service_role;

create or replace function public.refresh_complete_power_outage_evaluation_progress_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_evaluation_progress_snapshot')
  );

  with sources(source) as (
    values ('cez'::text), ('egd'::text), ('pre'::text)
  ), providers(provider) as (
    values ('all'::text), ('ares'::text), ('mapy'::text), ('google'::text)
  ), candidates as (
    select
      company.id,
      outage.source,
      company.evaluation_version >= 2
        and company.business_relevance_status <> 'pending' as evaluated,
      company.evaluated_at
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    where company.candidate_status in ('new', 'confirmed', 'needs_review')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and outage.starts_at <= now() + interval '30 days'
  ), candidate_providers as (
    select distinct
      candidates.id,
      candidates.source,
      candidates.evaluated,
      candidates.evaluated_at,
      case evidence.provider when 'res' then 'ares' else evidence.provider end as provider
    from candidates
    join public.complete_power_outage_company_evidence evidence
      on evidence.company_id = candidates.id
    where evidence.provider in ('ares', 'res', 'mapy', 'google')
  ), expanded as (
    select candidates.id, candidates.source, candidates.evaluated,
      candidates.evaluated_at, 'all'::text as provider
    from candidates
    union all
    select id, source, evaluated, evaluated_at, provider
    from candidate_providers
  ), counts as (
    select
      expanded.source,
      expanded.provider,
      count(distinct expanded.id)::bigint as candidate_count,
      count(distinct expanded.id) filter (where expanded.evaluated)::bigint as evaluated_candidate_count,
      count(distinct expanded.id) filter (where not expanded.evaluated)::bigint as pending_candidate_count,
      max(expanded.evaluated_at) filter (where expanded.evaluated) as last_evaluated_at
    from expanded
    group by expanded.source, expanded.provider
  )
  insert into public.complete_power_outage_evaluation_progress_snapshot (
    source, provider, candidate_count, evaluated_candidate_count,
    pending_candidate_count, last_evaluated_at, refreshed_at
  )
  select
    sources.source,
    providers.provider,
    coalesce(counts.candidate_count, 0),
    coalesce(counts.evaluated_candidate_count, 0),
    coalesce(counts.pending_candidate_count, 0),
    counts.last_evaluated_at,
    now()
  from sources cross join providers
  left join counts
    on counts.source = sources.source and counts.provider = providers.provider
  on conflict (source, provider) do update set
    candidate_count = excluded.candidate_count,
    evaluated_candidate_count = excluded.evaluated_candidate_count,
    pending_candidate_count = excluded.pending_candidate_count,
    last_evaluated_at = excluded.last_evaluated_at,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_evaluation_progress_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_evaluation_progress_snapshot()
  to service_role;

select public.refresh_complete_power_outage_evaluation_progress_snapshot();

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_evaluation_progress_snapshot_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_evaluation_progress_snapshot_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_evaluation_progress_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'weighted current company evaluation queue' as object_name,
  to_regprocedure('public.get_complete_power_outage_company_evaluation_queue(integer)') is not null as is_correct
union all
select 'LOGIC', 'CEZ receives sixty percent reserved evaluation capacity',
  pg_get_functiondef('public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure)
    like '%batch_limit * 60%'
union all
select 'LOGIC', 'unused evaluation capacity returns to oldest candidates',
  pg_get_functiondef('public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure)
    like '%spill%'
union all
select 'SCOPE', 'evaluation queue prioritizes current outages',
  pg_get_functiondef('public.get_complete_power_outage_company_evaluation_queue(integer)'::regprocedure)
    like '%outage.source_status in (''scheduled'', ''active'')%'
union all
select 'STATE', 'CEZ ALL v1 is active',
  coalesce((select active_source = 'shadow'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'STATE', 'published CEZ catalog identifies complete cycle',
  coalesce((select metadata ->> 'completeCezProjection' = 'shadow'
      and nullif(metadata ->> 'completeCezCycleId', '') is not null
    from public.complete_power_outage_source_state where source = 'cez'), false)
union all
select 'CRON', 'legacy direct CEZ complete scheduler is inactive',
  not exists (select 1 from cron.job
    where active and jobname = 'power_outages_complete_cez_projection_every_fifteen_minutes')
union all
select 'CRON', 'evaluation progress snapshot every minute',
  exists (select 1 from cron.job
    where active and jobname = 'complete_evaluation_progress_snapshot_every_minute')
union all
select 'GRANT', 'authenticated cannot claim evaluation queue',
  not has_function_privilege('authenticated',
    'public.get_complete_power_outage_company_evaluation_queue(integer)', 'EXECUTE')
union all
select 'RLS', 'evaluation progress snapshot has RLS',
  coalesce((select relrowsecurity from pg_class
    where oid = 'public.complete_power_outage_evaluation_progress_snapshot'::regclass), false)
order by check_type, object_name;
