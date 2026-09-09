begin;

do $$
begin
  if to_regclass('public.complete_power_outage_commercial_selection_state') is null
     or to_regclass('public.complete_power_outage_company_scoring_overview') is null
     or to_regclass('public.complete_power_outage_company_enrichment_overview') is null
     or to_regclass('public.complete_power_outage_evaluation_progress_snapshot') is null
     or to_regprocedure('public.current_user_can_view_power_outages()') is null then
    raise exception 'Chybí závislosti pro provozní stav AI SELECT.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_commercial_selection_progress_snapshot (
  singleton boolean primary key default true check (singleton),
  status text not null default 'inactive' check (
    status in ('inactive', 'current', 'processing', 'attention')
  ),
  stage text not null default 'current' check (
    stage in ('current', 'evaluation', 'enrichment', 'scoring', 'attention')
  ),
  evaluation_pending_count bigint not null default 0 check (evaluation_pending_count >= 0),
  enrichment_pending_count bigint not null default 0 check (enrichment_pending_count >= 0),
  scoring_pending_count bigint not null default 0 check (scoring_pending_count >= 0),
  remaining_count bigint not null default 0 check (remaining_count >= 0),
  attention_count bigint not null default 0 check (attention_count >= 0),
  status_message text not null default 'Obchodní výběr zatím není aktivní.',
  last_progress_at timestamptz,
  refreshed_at timestamptz not null default now()
);

alter table public.complete_power_outage_commercial_selection_progress_snapshot
  enable row level security;
drop policy if exists cpo_commercial_selection_progress_authorized_read
  on public.complete_power_outage_commercial_selection_progress_snapshot;
create policy cpo_commercial_selection_progress_authorized_read
  on public.complete_power_outage_commercial_selection_progress_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_commercial_selection_progress_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_commercial_selection_progress_snapshot
  to authenticated;
grant all on table public.complete_power_outage_commercial_selection_progress_snapshot
  to service_role;

create or replace function public.refresh_complete_power_outage_commercial_selection_progress_snapshot()
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  refreshed_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_commercial_selection_progress_snapshot')
  ) then
    return 0;
  end if;

  with evaluation as (
    select
      coalesce(sum(pending_candidate_count), 0)::bigint as pending_count,
      max(last_evaluated_at) as last_progress_at
    from public.complete_power_outage_evaluation_progress_snapshot
    where provider = 'all'
  ), scoring as (
    select
      scoring_enabled,
      ui_enabled,
      greatest(current_candidate_count - represented_count, 0)
        + pending_count + attention_count as pending_count,
      attention_count,
      scoring_consecutive_failure_count,
      scoring_last_success_at,
      last_scoring_activity_at
    from public.complete_power_outage_company_scoring_overview
  ), enrichment as (
    select
      res_enrichment_enabled,
      pending_count + processing_count + retry_count as pending_count,
      retry_count,
      worker_status,
      consecutive_failure_count,
      last_success_at,
      last_enrichment_activity_at
    from public.complete_power_outage_company_enrichment_overview
  ), metrics as (
    select
      scoring.scoring_enabled,
      scoring.ui_enabled,
      enrichment.res_enrichment_enabled,
      evaluation.pending_count as evaluation_pending_count,
      enrichment.pending_count as enrichment_pending_count,
      scoring.pending_count as scoring_pending_count,
      evaluation.pending_count + enrichment.pending_count + scoring.pending_count as remaining_count,
      scoring.attention_count + enrichment.retry_count as attention_count,
      scoring.scoring_consecutive_failure_count > 0
        or enrichment.consecutive_failure_count > 0
        or enrichment.worker_status = 'failed'
        or (not enrichment.res_enrichment_enabled and enrichment.pending_count > 0)
        or scoring.attention_count > 0 as has_error,
      evaluation.pending_count > 0
        and coalesce(evaluation.last_progress_at, '-infinity'::timestamptz) < now() - interval '15 minutes'
        as evaluation_stalled,
      enrichment.pending_count > 0
        and coalesce(enrichment.last_enrichment_activity_at, enrichment.last_success_at, '-infinity'::timestamptz)
          < now() - interval '10 minutes' as enrichment_stalled,
      scoring.pending_count > 0
        and coalesce(scoring.last_scoring_activity_at, scoring.scoring_last_success_at, '-infinity'::timestamptz)
          < now() - interval '5 minutes' as scoring_stalled,
      greatest(
        evaluation.last_progress_at,
        enrichment.last_enrichment_activity_at,
        enrichment.last_success_at,
        scoring.last_scoring_activity_at,
        scoring.scoring_last_success_at
      ) as last_progress_at
    from evaluation cross join scoring cross join enrichment
  ), presentation as (
    select metrics.*,
      case
        when not ui_enabled or not scoring_enabled then 'inactive'
        when has_error or evaluation_stalled or enrichment_stalled or scoring_stalled then 'attention'
        when remaining_count > 0 then 'processing'
        else 'current'
      end as status,
      case
        when has_error or evaluation_stalled or enrichment_stalled or scoring_stalled then 'attention'
        when evaluation_pending_count > 0 then 'evaluation'
        when enrichment_pending_count > 0 then 'enrichment'
        when scoring_pending_count > 0 then 'scoring'
        else 'current'
      end as stage
    from metrics
  )
  insert into public.complete_power_outage_commercial_selection_progress_snapshot (
    singleton, status, stage, evaluation_pending_count, enrichment_pending_count,
    scoring_pending_count, remaining_count, attention_count, status_message,
    last_progress_at, refreshed_at
  )
  select
    true,
    status,
    stage,
    evaluation_pending_count,
    enrichment_pending_count,
    scoring_pending_count,
    remaining_count,
    attention_count,
    case status
      when 'inactive' then 'Obchodní výběr není aktivní.'
      when 'current' then 'Všechny aktuální firmy mají hotové vyhodnocení a skóre.'
      when 'attention' then case
        when evaluation_stalled then 'Vyhodnocení nových firem se déle než 15 minut neposunulo.'
        when enrichment_stalled then 'Doplňování profilů ARES/RES se déle než 10 minut neposunulo.'
        when scoring_stalled then 'Přepočet obchodního skóre se déle než 5 minut neposunul.'
        else 'Zpracování obchodního výběru vyžaduje pozornost.'
      end
      else case stage
        when 'evaluation' then 'Probíhá vyhodnocení nově nalezených firem.'
        when 'enrichment' then 'Probíhá doplňování firemních profilů ARES/RES.'
        when 'scoring' then 'Probíhá přepočet obchodního skóre.'
        else 'Obchodní výběr zpracovává nová data.'
      end
    end,
    last_progress_at,
    now()
  from presentation
  on conflict (singleton) do update set
    status = excluded.status,
    stage = excluded.stage,
    evaluation_pending_count = excluded.evaluation_pending_count,
    enrichment_pending_count = excluded.enrichment_pending_count,
    scoring_pending_count = excluded.scoring_pending_count,
    remaining_count = excluded.remaining_count,
    attention_count = excluded.attention_count,
    status_message = excluded.status_message,
    last_progress_at = excluded.last_progress_at,
    refreshed_at = excluded.refreshed_at;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_commercial_selection_progress_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_commercial_selection_progress_snapshot()
  to service_role;

select public.refresh_complete_power_outage_commercial_selection_progress_snapshot();

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_commercial_selection_progress_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_commercial_selection_progress_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_commercial_selection_progress_snapshot();$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'TABLE' as check_type, 'AI SELECT progress snapshot' as object_name,
  to_regclass('public.complete_power_outage_commercial_selection_progress_snapshot') is not null as is_correct
union all
select 'FUNCTION', 'refresh AI SELECT progress snapshot',
  to_regprocedure('public.refresh_complete_power_outage_commercial_selection_progress_snapshot()') is not null
union all
select 'CRON', 'AI SELECT progress snapshot every minute', exists (
  select 1 from cron.job
  where jobname = 'complete_commercial_selection_progress_every_minute' and active
)
union all
select 'DATA', 'AI SELECT progress snapshot is populated', exists (
  select 1 from public.complete_power_outage_commercial_selection_progress_snapshot where singleton
)
union all
select 'GRANT', 'authenticated cannot refresh AI SELECT progress',
  not has_function_privilege('authenticated',
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()', 'EXECUTE')
union all
select 'RLS', 'AI SELECT progress snapshot has RLS', coalesce((
  select relrowsecurity from pg_class
  where oid = 'public.complete_power_outage_commercial_selection_progress_snapshot'::regclass
), false)
union all
select 'ISOLATION', 'AI SELECT progress stays in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) = 0
order by check_type, object_name;
