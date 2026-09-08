begin;

do $$
begin
  if to_regclass('public.complete_power_outage_company_enrichment_queue') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_company_contacts') is null
     or to_regclass('public.complete_power_outage_commercial_selection_state') is null then
    raise exception 'Nejdříve musí být nasazena commercial-selection foundation.';
  end if;
  if to_regprocedure('public.claim_complete_power_outage_provider_quota(text,integer,integer)') is null then
    raise exception 'Chybí sdílená bezpečnostní kvóta poskytovatelů.';
  end if;
end
$$;

-- ROS je neveřejný registr. Worker smí požadovat pouze veřejný RES; případné
-- kontakty uloží jen tehdy, pokud je veřejná odpověď skutečně obsahuje.
alter table public.complete_power_outage_company_enrichment_queue
  drop constraint if exists cpo_company_enrichment_sources_check;
alter table public.complete_power_outage_company_enrichment_queue
  add constraint cpo_company_enrichment_sources_check check (
    requested_sources = array['res']::text[]
  );

alter table public.complete_power_outage_company_contacts
  drop constraint if exists cpo_company_contacts_source_check;
alter table public.complete_power_outage_company_contacts
  add constraint cpo_company_contacts_source_check check (
    source_registry in ('ares_res', 'ares_other_public')
  );

create or replace function public.claim_complete_power_outage_company_enrichment(
  requested_limit integer default 10
)
returns table (
  ico text,
  requested_sources text[],
  processing_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if requested_limit not between 1 and 50 then
    raise exception 'Neplatná velikost enrichment dávky.';
  end if;

  -- Tvrdá pojistka: samotná existence endpointu ani ruční HTTP požadavek
  -- nesmí před schválenou aktivací rozběhnout frontu.
  if not coalesce((
    select state_row.res_enrichment_enabled
    from public.complete_power_outage_commercial_selection_state state_row
    where state_row.singleton
  ), false) then
    return;
  end if;

  update public.complete_power_outage_company_enrichment_queue queue_row
  set queue_status = case
        when queue_row.attempt_count + 1 >= queue_row.max_attempt_count then 'skipped'
        else 'error'
      end,
      attempt_count = queue_row.attempt_count + 1,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = case
        when queue_row.attempt_count + 1 >= queue_row.max_attempt_count then null
        else now()
      end,
      finished_at = case
        when queue_row.attempt_count + 1 >= queue_row.max_attempt_count then now()
        else null
      end,
      last_error_code = 'COMPLETE_COMPANY_ENRICHMENT_LEASE_EXPIRED',
      last_error_message = 'Předchozí worker nedokončil položku před vypršením lease.'
  where queue_row.queue_status = 'processing'
    and queue_row.processing_expires_at <= now();

  return query
  with candidates as (
    select queue_row.ico
    from public.complete_power_outage_company_enrichment_queue queue_row
    where queue_row.queue_status in ('pending', 'error')
      and queue_row.attempt_count < queue_row.max_attempt_count
      and coalesce(queue_row.next_attempt_at, '-infinity'::timestamptz) <= now()
    order by queue_row.priority desc,
      coalesce(queue_row.next_attempt_at, queue_row.created_at),
      queue_row.created_at,
      queue_row.ico
    for update skip locked
    limit requested_limit
  ), claimed as (
    update public.complete_power_outage_company_enrichment_queue queue_row
    set queue_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '10 minutes',
        started_at = now(),
        finished_at = null,
        last_error_code = null,
        last_error_message = null
    from candidates
    where queue_row.ico = candidates.ico
    returning queue_row.ico, queue_row.requested_sources,
      queue_row.processing_token, queue_row.attempt_count
  )
  select claimed.ico, claimed.requested_sources,
    claimed.processing_token, claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.release_complete_power_outage_company_enrichment_claim(
  requested_ico text,
  requested_processing_token uuid,
  requested_delay_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if requested_delay_seconds not between 1 and 3600 then
    raise exception 'Neplatný odklad enrichment položky.';
  end if;

  update public.complete_power_outage_company_enrichment_queue queue_row
  set queue_status = 'pending',
      processing_token = null,
      processing_expires_at = null,
      started_at = null,
      next_attempt_at = now() + make_interval(secs => requested_delay_seconds)
  where queue_row.ico = requested_ico
    and queue_row.queue_status = 'processing'
    and queue_row.processing_token = requested_processing_token;
  get diagnostics affected_count = row_count;
  return affected_count = 1;
end;
$$;

create or replace function public.finish_complete_power_outage_company_enrichment(
  requested_ico text,
  requested_processing_token uuid,
  requested_result text,
  requested_company_profile_id uuid default null,
  requested_error_code text default null,
  requested_error_message text default null,
  requested_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  queue_row public.complete_power_outage_company_enrichment_queue%rowtype;
  next_attempt_count integer;
  final_status text;
  retry_at timestamptz;
begin
  if requested_result not in ('ready', 'not_found', 'error') then
    raise exception 'Neplatný výsledek enrichmentu.';
  end if;

  select * into queue_row
  from public.complete_power_outage_company_enrichment_queue current_row
  where current_row.ico = requested_ico
    and current_row.queue_status = 'processing'
    and current_row.processing_token = requested_processing_token
  for update;
  if not found then return false; end if;

  if requested_result = 'ready' and not exists (
    select 1 from public.complete_power_outage_company_profiles profile_row
    where profile_row.id = requested_company_profile_id
      and profile_row.ico = requested_ico
  ) then
    raise exception 'Výsledek ready nemá odpovídající profil firmy.';
  end if;

  if requested_result = 'error' then
    next_attempt_count := queue_row.attempt_count + 1;
    final_status := case
      when requested_retryable and next_attempt_count < queue_row.max_attempt_count then 'error'
      else 'skipped'
    end;
    retry_at := case
      when final_status <> 'error' then null
      when next_attempt_count = 1 then now() + interval '15 minutes'
      when next_attempt_count = 2 then now() + interval '1 hour'
      when next_attempt_count = 3 then now() + interval '6 hours'
      else now() + interval '24 hours'
    end;
  else
    next_attempt_count := queue_row.attempt_count;
    final_status := requested_result;
    retry_at := null;
  end if;

  update public.complete_power_outage_company_enrichment_queue current_row
  set queue_status = final_status,
      company_profile_id = case
        when requested_result = 'ready' then requested_company_profile_id
        else current_row.company_profile_id
      end,
      attempt_count = next_attempt_count,
      next_attempt_at = retry_at,
      processing_token = null,
      processing_expires_at = null,
      finished_at = case when final_status = 'error' then null else now() end,
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then left(requested_error_message, 2000) else null end
  where current_row.ico = requested_ico;

  update public.complete_power_outage_commercial_selection_state
  set last_enrichment_activity_at = now(),
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then left(requested_error_message, 2000) else null end
  where singleton;
  return true;
end;
$$;

revoke all on function public.claim_complete_power_outage_company_enrichment(integer)
  from public, anon, authenticated;
revoke all on function public.release_complete_power_outage_company_enrichment_claim(text,uuid,integer)
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_company_enrichment(text,uuid,text,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_company_enrichment(integer) to service_role;
grant execute on function public.release_complete_power_outage_company_enrichment_claim(text,uuid,integer) to service_role;
grant execute on function public.finish_complete_power_outage_company_enrichment(text,uuid,text,uuid,text,text,boolean) to service_role;

create or replace view public.complete_power_outage_company_enrichment_overview
with (security_invoker = true)
as
select
  true as singleton,
  state_row.res_enrichment_enabled,
  count(queue_row.ico)::bigint as total_count,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status = 'ready')::bigint as ready_count,
  count(*) filter (where queue_row.queue_status = 'not_found')::bigint as not_found_count,
  count(*) filter (where queue_row.queue_status = 'error')::bigint as retry_count,
  count(*) filter (where queue_row.queue_status = 'skipped')::bigint as review_count,
  (select count(*) from public.complete_power_outage_company_profiles)::bigint as profile_count,
  (select count(*) from public.complete_power_outage_company_contacts where contact_type = 'email')::bigint as email_count,
  (select count(*) from public.complete_power_outage_company_contacts where contact_type = 'phone')::bigint as phone_count,
  state_row.last_enrichment_activity_at,
  state_row.last_error_code,
  state_row.last_error_message
from public.complete_power_outage_commercial_selection_state state_row
left join public.complete_power_outage_company_enrichment_queue queue_row on true
where state_row.singleton
group by state_row.res_enrichment_enabled, state_row.last_enrichment_activity_at,
  state_row.last_error_code, state_row.last_error_message;

revoke all on table public.complete_power_outage_company_enrichment_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_enrichment_overview to authenticated, service_role;

commit;
