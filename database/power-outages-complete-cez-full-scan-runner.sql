begin;

do $$
begin
  if to_regprocedure('public.request_complete_power_outage_cez_scan(integer,boolean)') is null then
    raise exception 'Nejdříve spusťte aktualizovanou migraci stagingového skenu ČEZ.';
  end if;
  if to_regprocedure('public.request_complete_power_outage_cez_staged_address_normalization(integer)') is null then
    raise exception 'Nejdříve spusťte migraci normalizace stagingových adres ČEZ.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_cez_scan_runner_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'idle',
  last_request_id bigint,
  last_requested_at timestamptz,
  last_completed_at timestamptz,
  last_http_status integer,
  last_cycle_id uuid,
  last_cycle_status text,
  last_processed_count integer not null default 0,
  last_outage_count integer not null default 0,
  last_address_count integer not null default 0,
  cumulative_processed_count bigint not null default 0,
  consecutive_error_count integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_scan_runner_status_check
    check (status in ('idle', 'running', 'waiting', 'error')),
  constraint cpo_cez_scan_runner_counts_check
    check (
      last_processed_count >= 0
      and last_outage_count >= 0
      and last_address_count >= 0
      and cumulative_processed_count >= 0
      and consecutive_error_count >= 0
    ),
  constraint cpo_cez_scan_runner_http_check
    check (last_http_status is null or last_http_status between 100 and 599)
);

insert into public.complete_power_outage_cez_scan_runner_state (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists cpo_cez_scan_runner_set_updated_at
  on public.complete_power_outage_cez_scan_runner_state;
create trigger cpo_cez_scan_runner_set_updated_at
before update on public.complete_power_outage_cez_scan_runner_state
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_scan_runner_state enable row level security;

drop policy if exists cpo_cez_scan_runner_authorized_read
  on public.complete_power_outage_cez_scan_runner_state;
create policy cpo_cez_scan_runner_authorized_read
  on public.complete_power_outage_cez_scan_runner_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_scan_runner_state
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_scan_runner_state to authenticated;
grant all on table public.complete_power_outage_cez_scan_runner_state to service_role;

create or replace function public.advance_complete_power_outage_cez_scan_runner()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.complete_power_outage_cez_scan_runner_state%rowtype;
  response_status integer;
  response_timed_out boolean;
  response_error text;
  response_content text;
  response_json jsonb;
  new_error_count integer;
  work_available boolean;
  next_due_at timestamptz;
  new_request_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_scan_runner')
  );

  select * into state_row
  from public.complete_power_outage_cez_scan_runner_state
  where singleton
  for update;

  if state_row.status = 'running' and state_row.last_request_id is not null then
    select status_code, timed_out, error_msg, content
    into response_status, response_timed_out, response_error, response_content
    from net._http_response
    where id = state_row.last_request_id;

    if not found then
      if state_row.last_requested_at > now() - interval '8 minutes' then
        return null;
      end if;
      new_error_count := state_row.consecutive_error_count + 1;
      update public.complete_power_outage_cez_scan_runner_state
      set status = 'waiting',
          consecutive_error_count = new_error_count,
          next_attempt_at = case
            when new_error_count = 1 then now() + interval '15 minutes'
            when new_error_count = 2 then now() + interval '1 hour'
            else now() + interval '6 hours'
          end,
          last_error = 'Odpověď celoplošné dávky ČEZ nebyla dostupná ani po osmi minutách.'
      where singleton;
    else
      begin
        response_json := response_content::jsonb;
      exception when others then
        response_json := null;
      end;

      if response_status between 200 and 299
        and not coalesce(response_timed_out, false)
        and coalesce((response_json ->> 'ok')::boolean, false)
      then
        update public.complete_power_outage_cez_scan_runner_state
        set status = 'idle',
            last_completed_at = now(),
            last_http_status = response_status,
            last_cycle_id = nullif(response_json ->> 'cycleId', '')::uuid,
            last_cycle_status = response_json ->> 'status',
            last_processed_count = coalesce((response_json ->> 'processedCount')::integer, 0),
            last_outage_count = coalesce((response_json ->> 'uniqueOutageCount')::integer, 0),
            last_address_count = coalesce((response_json ->> 'addressCount')::integer, 0),
            cumulative_processed_count = cumulative_processed_count
              + coalesce((response_json ->> 'processedCount')::integer, 0),
            consecutive_error_count = 0,
            next_attempt_at = null,
            last_error = null
        where singleton;
      else
        new_error_count := state_row.consecutive_error_count + 1;
        update public.complete_power_outage_cez_scan_runner_state
        set status = 'waiting',
            last_http_status = response_status,
            consecutive_error_count = new_error_count,
            next_attempt_at = case
              when new_error_count = 1 then now() + interval '15 minutes'
              when new_error_count = 2 then now() + interval '1 hour'
              else now() + interval '6 hours'
            end,
            last_error = left(
              coalesce(response_error, response_content, 'Celoplošná dávka ČEZ selhala.'),
              2000
            )
        where singleton;
      end if;
    end if;

    select * into state_row
    from public.complete_power_outage_cez_scan_runner_state
    where singleton
    for update;
  end if;

  if state_row.status = 'waiting'
    and state_row.next_attempt_at is not null
    and state_row.next_attempt_at > now()
  then
    return null;
  end if;

  select
    exists (
      select 1
      from public.complete_power_outage_cez_scan_cycles cycle
      where cycle.status = 'running'
    )
    or exists (
      select 1
      from public.complete_power_outage_cez_municipalities municipality
      where municipality.is_active
        and municipality.distribution_status = 'cez'
        and municipality.mapping_status = 'resolved'
        and municipality.cez_address_id is not null
        and municipality.cez_town_code is not null
        and municipality.scan_status in ('pending', 'succeeded', 'no_change', 'partial', 'error')
        and (
          municipality.scan_next_attempt_at is null
          or municipality.scan_next_attempt_at <= now()
        )
    ),
    (
      select min(municipality.scan_next_attempt_at)
      from public.complete_power_outage_cez_municipalities municipality
      where municipality.is_active
        and municipality.distribution_status = 'cez'
        and municipality.mapping_status = 'resolved'
        and municipality.scan_status in ('succeeded', 'no_change', 'partial', 'error')
    )
  into work_available, next_due_at;

  if not work_available then
    update public.complete_power_outage_cez_scan_runner_state
    set status = 'waiting',
        next_attempt_at = coalesce(next_due_at, now() + interval '15 minutes'),
        last_error = null
    where singleton;
    return null;
  end if;

  new_request_id := public.request_complete_power_outage_cez_scan(20, false);
  update public.complete_power_outage_cez_scan_runner_state
  set status = 'running',
      last_request_id = new_request_id,
      last_requested_at = now(),
      next_attempt_at = null,
      last_error = null
  where singleton;

  return new_request_id;
end;
$$;

revoke all on function public.advance_complete_power_outage_cez_scan_runner()
  from public, anon, authenticated;
grant execute on function public.advance_complete_power_outage_cez_scan_runner()
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_cez_full_scan_every_five_minutes',
      'complete_cez_staging_normalization_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  -- MARKETY používá ČEZ v minutách 4/19/34/49. Celoplošný staging proto
  -- začíná v minutách 1/6/11/... a při dávce 20 nevytváří souběžný burst.
  perform cron.schedule(
    'complete_cez_full_scan_every_five_minutes',
    '1-59/5 * * * *',
    $job$select public.advance_complete_power_outage_cez_scan_runner();$job$
  );

  -- Čistě databázové zpracování adres běží o minutu později a nevolá ČEZ.
  perform cron.schedule(
    'complete_cez_staging_normalization_every_five_minutes',
    '2-59/5 * * * *',
    $job$select public.request_complete_power_outage_cez_staged_address_normalization(100);$job$
  );
end
$$;

commit;
