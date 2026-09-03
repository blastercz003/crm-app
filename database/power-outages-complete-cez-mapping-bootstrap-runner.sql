begin;

do $$
begin
  if to_regprocedure('public.request_complete_power_outage_cez_mapping(integer)') is null then
    raise exception 'Nejdříve spusťte power-outages-complete-cez-municipality-mapping.sql.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_cez_mapping_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'idle',
  last_request_id bigint,
  last_requested_at timestamptz,
  last_completed_at timestamptz,
  processed_count integer not null default 0,
  cez_count integer not null default 0,
  outside_cez_count integer not null default 0,
  review_count integer not null default 0,
  remaining_count integer,
  consecutive_error_count integer not null default 0,
  next_attempt_at timestamptz,
  last_http_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cpo_cez_mapping_bootstrap_status_check
    check (status in ('idle', 'running', 'waiting', 'completed', 'failed')),
  constraint cpo_cez_mapping_bootstrap_counts_check
    check (
      processed_count >= 0
      and cez_count >= 0
      and outside_cez_count >= 0
      and review_count >= 0
      and (remaining_count is null or remaining_count >= 0)
      and consecutive_error_count >= 0
    ),
  constraint cpo_cez_mapping_bootstrap_http_check
    check (last_http_status is null or last_http_status between 100 and 599)
);

insert into public.complete_power_outage_cez_mapping_bootstrap_state (singleton)
values (true)
on conflict (singleton) do nothing;

update public.complete_power_outage_cez_mapping_bootstrap_state
set status = 'idle',
    consecutive_error_count = 0,
    next_attempt_at = null,
    last_error = null
where singleton
  and status in ('completed', 'failed')
  and exists (
    select 1
    from public.complete_power_outage_cez_municipalities
    where is_active
      and representative_status = 'resolved'
      and mapping_status in ('pending', 'error')
  );

drop trigger if exists cpo_cez_mapping_bootstrap_set_updated_at
  on public.complete_power_outage_cez_mapping_bootstrap_state;
create trigger cpo_cez_mapping_bootstrap_set_updated_at
before update on public.complete_power_outage_cez_mapping_bootstrap_state
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_cez_mapping_bootstrap_state enable row level security;

drop policy if exists cpo_cez_mapping_bootstrap_authorized_read
  on public.complete_power_outage_cez_mapping_bootstrap_state;
create policy cpo_cez_mapping_bootstrap_authorized_read
  on public.complete_power_outage_cez_mapping_bootstrap_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_mapping_bootstrap_state
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_mapping_bootstrap_state
  to authenticated;
grant all on table public.complete_power_outage_cez_mapping_bootstrap_state
  to service_role;

create or replace function public.advance_complete_power_outage_cez_mapping_bootstrap()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.complete_power_outage_cez_mapping_bootstrap_state%rowtype;
  response_status integer;
  response_timed_out boolean;
  response_error text;
  response_content text;
  response_json jsonb;
  new_error_count integer;
  eligible_count bigint;
  mapping_queue_count bigint;
  representative_queue_count bigint;
  manual_review_count bigint;
  next_due_at timestamptz;
  new_request_id bigint;
  existing_job record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_cez_mapping_bootstrap')
  );

  select *
  into state_row
  from public.complete_power_outage_cez_mapping_bootstrap_state
  where singleton
  for update;

  if state_row.status in ('completed', 'failed') then
    for existing_job in
      select jobid from cron.job
      where jobname = 'complete_cez_mapping_bootstrap_every_fifteen_minutes'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
    return null;
  end if;

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
      update public.complete_power_outage_cez_mapping_bootstrap_state
      set status = case when new_error_count >= 3 then 'failed' else 'waiting' end,
          consecutive_error_count = new_error_count,
          next_attempt_at = case
            when new_error_count = 1 then now() + interval '15 minutes'
            when new_error_count = 2 then now() + interval '1 hour'
            else null
          end,
          last_error = 'Odpověď mapovací dávky nebyla dostupná ani po osmi minutách.'
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
        update public.complete_power_outage_cez_mapping_bootstrap_state
        set status = 'idle',
            last_completed_at = now(),
            processed_count = processed_count
              + coalesce((response_json ->> 'processedCount')::integer, 0),
            cez_count = cez_count
              + coalesce((response_json ->> 'resolvedCount')::integer, 0),
            outside_cez_count = outside_cez_count
              + coalesce((response_json ->> 'outsideCezCount')::integer, 0),
            review_count = review_count
              + coalesce((response_json ->> 'reviewCount')::integer, 0),
            remaining_count = (response_json ->> 'remainingCount')::integer,
            consecutive_error_count = 0,
            next_attempt_at = null,
            last_http_status = response_status,
            last_error = null
        where singleton;
      else
        new_error_count := state_row.consecutive_error_count + 1;
        update public.complete_power_outage_cez_mapping_bootstrap_state
        set status = case when new_error_count >= 3 then 'failed' else 'waiting' end,
            consecutive_error_count = new_error_count,
            next_attempt_at = case
              when new_error_count = 1 then now() + interval '15 minutes'
              when new_error_count = 2 then now() + interval '1 hour'
              else null
            end,
            last_http_status = response_status,
            last_error = left(
              coalesce(response_error, response_content, 'Mapovací dávka ČEZ selhala.'),
              2000
            )
        where singleton;
      end if;
    end if;

    select *
    into state_row
    from public.complete_power_outage_cez_mapping_bootstrap_state
    where singleton
    for update;
  end if;

  if state_row.status = 'failed' then
    for existing_job in
      select jobid from cron.job
      where jobname = 'complete_cez_mapping_bootstrap_every_fifteen_minutes'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
    return null;
  end if;

  if state_row.status = 'waiting'
    and state_row.next_attempt_at is not null
    and state_row.next_attempt_at > now()
  then
    return null;
  end if;

  select count(*), min(mapping_next_attempt_at)
  into mapping_queue_count, next_due_at
  from public.complete_power_outage_cez_municipalities
  where is_active
    and representative_status = 'resolved'
    and mapping_status in ('pending', 'error');

  select count(*)
  into eligible_count
  from public.complete_power_outage_cez_municipalities
  where is_active
    and representative_status = 'resolved'
    and mapping_status in ('pending', 'error')
    and (mapping_next_attempt_at is null or mapping_next_attempt_at <= now());

  select count(*)
  into representative_queue_count
  from public.complete_power_outage_cez_municipalities
  where is_active and representative_status in ('pending', 'error');

  select count(*)
  into manual_review_count
  from public.complete_power_outage_cez_municipalities
  where is_active
    and representative_status = 'resolved'
    and mapping_status = 'needs_review';

  if mapping_queue_count = 0 and representative_queue_count = 0 then
    update public.complete_power_outage_cez_mapping_bootstrap_state
    set status = 'completed',
        remaining_count = manual_review_count::integer,
        review_count = manual_review_count::integer,
        last_completed_at = now(),
        next_attempt_at = null,
        last_error = case
          when manual_review_count = 0 then null
          else manual_review_count::text || ' obcí vyžaduje ruční kontrolu mapování.'
        end
    where singleton;

    for existing_job in
      select jobid from cron.job
      where jobname = 'complete_cez_mapping_bootstrap_every_fifteen_minutes'
    loop
      perform cron.unschedule(existing_job.jobid);
    end loop;
    return null;
  end if;

  if eligible_count = 0 then
    update public.complete_power_outage_cez_mapping_bootstrap_state
    set status = 'waiting',
        remaining_count = (
          mapping_queue_count + representative_queue_count + manual_review_count
        )::integer,
        next_attempt_at = coalesce(next_due_at, now() + interval '15 minutes'),
        last_error = null
    where singleton;
    return null;
  end if;

  new_request_id := public.request_complete_power_outage_cez_mapping(25);

  update public.complete_power_outage_cez_mapping_bootstrap_state
  set status = 'running',
      last_request_id = new_request_id,
      last_requested_at = now(),
      next_attempt_at = null,
      remaining_count = (
        mapping_queue_count + representative_queue_count + manual_review_count
      )::integer,
      last_error = null
  where singleton;

  return new_request_id;
end;
$$;

revoke all on function public.advance_complete_power_outage_cez_mapping_bootstrap()
  from public, anon, authenticated;
grant execute on function public.advance_complete_power_outage_cez_mapping_bootstrap()
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_cez_mapping_bootstrap_every_fifteen_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  -- MARKETY: ČEZ běží v minutách 4/19/34/49 a adresní fronta 7/22/37/52.
  -- KOMPLETNÍ mapování proto používá oddělená okna 13/28/43/58.
  perform cron.schedule(
    'complete_cez_mapping_bootstrap_every_fifteen_minutes',
    '13-59/15 * * * *',
    $job$select public.advance_complete_power_outage_cez_mapping_bootstrap();$job$
  );
end
$$;

commit;

select public.advance_complete_power_outage_cez_mapping_bootstrap()
  as initial_request_id;
