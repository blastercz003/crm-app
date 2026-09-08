begin;

alter table public.complete_power_outage_commercial_selection_state
  add column if not exists enrichment_worker_status text not null default 'idle',
  add column if not exists enrichment_run_token uuid,
  add column if not exists enrichment_run_expires_at timestamptz,
  add column if not exists enrichment_last_started_at timestamptz,
  add column if not exists enrichment_last_finished_at timestamptz,
  add column if not exists enrichment_last_success_at timestamptz,
  add column if not exists enrichment_last_processed_count integer not null default 0,
  add column if not exists enrichment_consecutive_failure_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.complete_power_outage_commercial_selection_state'::regclass
      and conname = 'cpo_commercial_selection_worker_status_check'
  ) then
    alter table public.complete_power_outage_commercial_selection_state
      add constraint cpo_commercial_selection_worker_status_check check (
        enrichment_worker_status in ('idle', 'running', 'succeeded', 'partial', 'failed')
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.complete_power_outage_commercial_selection_state'::regclass
      and conname = 'cpo_commercial_selection_worker_lock_check'
  ) then
    alter table public.complete_power_outage_commercial_selection_state
      add constraint cpo_commercial_selection_worker_lock_check check (
        enrichment_worker_status <> 'running'
        or (enrichment_run_token is not null and enrichment_run_expires_at is not null)
      );
  end if;
end
$$;

create or replace function public.begin_complete_power_outage_company_enrichment_run()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  state_row public.complete_power_outage_commercial_selection_state%rowtype;
  v_run_token uuid := gen_random_uuid();
begin
  select * into state_row
  from public.complete_power_outage_commercial_selection_state
  where singleton
  for update;
  if not found or not state_row.res_enrichment_enabled then return null; end if;
  if state_row.enrichment_worker_status = 'running'
     and state_row.enrichment_run_expires_at > now() then
    return null;
  end if;

  update public.complete_power_outage_commercial_selection_state
  set enrichment_worker_status = 'running',
      enrichment_run_token = v_run_token,
      enrichment_run_expires_at = now() + interval '6 minutes',
      enrichment_last_started_at = now(),
      enrichment_last_processed_count = 0,
      last_error_code = case
        when state_row.enrichment_worker_status = 'running'
          then 'COMPLETE_COMPANY_ENRICHMENT_RUN_EXPIRED'
        else null
      end,
      last_error_message = case
        when state_row.enrichment_worker_status = 'running'
          then 'Předchozí enrichment běh překročil bezpečnostní čas a byl nahrazen.'
        else null
      end
  where singleton;
  return v_run_token;
end;
$$;

create or replace function public.finish_complete_power_outage_company_enrichment_run(
  requested_run_token uuid,
  requested_status text,
  requested_processed_count integer,
  requested_error_code text default null,
  requested_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if requested_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'Neplatný koncový stav enrichment workeru.';
  end if;
  if requested_processed_count < 0 then
    raise exception 'Neplatný počet zpracovaných enrichment položek.';
  end if;

  update public.complete_power_outage_commercial_selection_state
  set enrichment_worker_status = requested_status,
      enrichment_run_token = null,
      enrichment_run_expires_at = null,
      enrichment_last_finished_at = now(),
      enrichment_last_success_at = case
        when requested_status in ('succeeded', 'partial') then now()
        else enrichment_last_success_at
      end,
      enrichment_last_processed_count = requested_processed_count,
      enrichment_consecutive_failure_count = case
        when requested_status = 'failed' then enrichment_consecutive_failure_count + 1
        else 0
      end,
      last_enrichment_activity_at = now(),
      last_error_code = case when requested_status in ('partial', 'failed') then requested_error_code else null end,
      last_error_message = case when requested_status in ('partial', 'failed') then left(requested_error_message, 2000) else null end
  where singleton
    and enrichment_worker_status = 'running'
    and enrichment_run_token = requested_run_token;
  get diagnostics affected_count = row_count;
  return affected_count = 1;
end;
$$;

revoke all on function public.begin_complete_power_outage_company_enrichment_run()
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_company_enrichment_run(uuid,text,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.begin_complete_power_outage_company_enrichment_run() to service_role;
grant execute on function public.finish_complete_power_outage_company_enrichment_run(uuid,text,integer,text,text) to service_role;

create or replace view public.complete_power_outage_company_enrichment_overview
with (security_invoker = true)
as
with queue_counts as (
  select
    count(*)::bigint as total_count,
    count(*) filter (where queue_status = 'pending')::bigint as pending_count,
    count(*) filter (where queue_status = 'processing')::bigint as processing_count,
    count(*) filter (where queue_status = 'ready')::bigint as ready_count,
    count(*) filter (where queue_status = 'not_found')::bigint as not_found_count,
    count(*) filter (where queue_status = 'error')::bigint as retry_count,
    count(*) filter (where queue_status = 'skipped')::bigint as review_count
  from public.complete_power_outage_company_enrichment_queue
)
select
  true as singleton,
  state_row.res_enrichment_enabled,
  queue_counts.total_count,
  queue_counts.pending_count,
  queue_counts.processing_count,
  queue_counts.ready_count,
  queue_counts.not_found_count,
  queue_counts.retry_count,
  queue_counts.review_count,
  (select count(*) from public.complete_power_outage_company_profiles)::bigint as profile_count,
  (select count(*) from public.complete_power_outage_company_contacts where contact_type = 'email')::bigint as email_count,
  (select count(*) from public.complete_power_outage_company_contacts where contact_type = 'phone')::bigint as phone_count,
  state_row.last_enrichment_activity_at,
  case
    when state_row.enrichment_worker_status = 'running'
      and state_row.enrichment_run_expires_at <= now()
      then 'COMPLETE_COMPANY_ENRICHMENT_RUN_EXPIRED'
    else state_row.last_error_code
  end as last_error_code,
  case
    when state_row.enrichment_worker_status = 'running'
      and state_row.enrichment_run_expires_at <= now()
      then 'ARES RES enrichment běh překročil bezpečnostní čas a čeká na automatické obnovení.'
    else state_row.last_error_message
  end as last_error_message,
  case
    when not state_row.res_enrichment_enabled then 'inactive'
    when state_row.enrichment_worker_status = 'running'
      and state_row.enrichment_run_expires_at > now() then 'processing'
    when state_row.enrichment_worker_status = 'running' then 'error'
    when state_row.enrichment_worker_status = 'failed' then 'error'
    when queue_counts.pending_count + queue_counts.processing_count + queue_counts.retry_count > 0 then 'processing'
    when queue_counts.review_count > 0 then 'partial'
    when queue_counts.total_count = 0 then 'waiting'
    else 'current'
  end as status,
  state_row.enrichment_worker_status as worker_status,
  state_row.enrichment_last_started_at as last_started_at,
  state_row.enrichment_last_finished_at as last_finished_at,
  state_row.enrichment_last_success_at as last_success_at,
  state_row.enrichment_last_processed_count as last_processed_count,
  state_row.enrichment_consecutive_failure_count as consecutive_failure_count,
  case when queue_counts.total_count = 0 then 0 else round(
    ((queue_counts.ready_count + queue_counts.not_found_count + queue_counts.review_count)::numeric
      / queue_counts.total_count::numeric) * 100, 1
  ) end as progress_percent
from public.complete_power_outage_commercial_selection_state state_row
cross join queue_counts
where state_row.singleton;

revoke all on table public.complete_power_outage_company_enrichment_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_enrichment_overview to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
