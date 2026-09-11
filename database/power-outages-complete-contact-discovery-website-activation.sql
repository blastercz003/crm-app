begin;

-- Krok 5: rizene dohledani a overeni oficialnich firemnich webu.
-- Kontaktni extrakce, UI, planovani e-mailu a odesilani zustavaji vypnute.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_queue') is null
     or to_regclass('public.complete_power_outage_contact_discovery_batches') is null
     or to_regclass('public.complete_power_outage_contact_discovery_state') is null
     or to_regclass('public.complete_power_outage_company_websites') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
  then
    raise exception 'Chybi zavislosti pro aktivaci overovani oficialnich webu.';
  end if;
end
$$;

alter table public.complete_power_outage_contact_discovery_queue
  drop constraint if exists cpo_contact_discovery_queue_status_check,
  add constraint cpo_contact_discovery_queue_status_check check (
    queue_status in (
      'waiting_profile', 'pending', 'processing', 'website_ready', 'ready',
      'no_website', 'no_contact', 'error', 'needs_review',
      'skipped', 'cancelled'
    )
  ),
  drop constraint if exists cpo_contact_discovery_queue_result_check,
  add constraint cpo_contact_discovery_queue_result_check check (
    (queue_status = 'website_ready'
      and discovered_website_id is not null
      and discovered_contact_count = 0)
    or (queue_status = 'ready'
      and discovered_website_id is not null
      and discovered_contact_count > 0)
    or (queue_status = 'no_contact'
      and discovered_website_id is not null
      and discovered_contact_count = 0)
    or (queue_status = 'no_website'
      and discovered_website_id is null
      and discovered_contact_count = 0)
    or (queue_status not in ('website_ready', 'ready', 'no_contact', 'no_website'))
  ),
  drop constraint if exists cpo_contact_discovery_queue_finished_check,
  add constraint cpo_contact_discovery_queue_finished_check check (
    queue_status not in (
      'website_ready', 'ready', 'no_website', 'no_contact',
      'needs_review', 'skipped', 'cancelled'
    )
    or finished_at is not null
  );

create index if not exists cpo_contact_discovery_queue_website_result_idx
  on public.complete_power_outage_contact_discovery_queue (
    origin_batch_id,
    queue_status,
    finished_at desc
  );

create or replace function public.refresh_complete_power_outage_contact_discovery_profiles()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count bigint := 0;
begin
  update public.complete_power_outage_contact_discovery_queue queue_row
  set company_profile_id = profile.id,
      queue_status = 'pending',
      next_attempt_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = queue_row.metadata || jsonb_build_object(
        'profileReadyAt', now(),
        'profileReadinessSource', 'ares-res-profile'
      )
  from public.complete_power_outage_company_profiles profile
  where queue_row.queue_status = 'waiting_profile'
    and profile.ico = queue_row.ico;

  get diagnostics changed_count = row_count;
  return changed_count;
end;
$$;

create or replace function public.claim_complete_power_outage_contact_discovery(
  requested_limit integer default 1
)
returns table (
  ico text,
  company_profile_id uuid,
  company_name text,
  processing_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  safe_limit integer := least(1, greatest(1, coalesce(requested_limit, 1)));
begin
  if not coalesce((
    select state_row.discovery_enabled and state_row.website_lookup_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then
    return;
  end if;

  perform public.refresh_complete_power_outage_contact_discovery_profiles();

  update public.complete_power_outage_contact_discovery_queue queue_row
  set queue_status = 'error',
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = case
        when queue_row.attempt_count < queue_row.max_attempt_count then now() + interval '2 minutes'
        else null
      end,
      finished_at = case
        when queue_row.attempt_count >= queue_row.max_attempt_count then now()
        else null
      end,
      last_error_code = 'COMPLETE_CONTACT_WEBSITE_LEASE_EXPIRED',
      last_error_message = 'Predchozi worker nedokoncil overeni webu pred vyprsenim lease.',
      metadata = queue_row.metadata || jsonb_build_object('leaseExpiredAt', now())
  where queue_row.queue_status = 'processing'
    and queue_row.processing_expires_at <= now();

  -- Jediny aktivni lookup chrani limit Brave API i serverovy cas.
  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_queue queue_row
    where queue_row.queue_status = 'processing'
      and queue_row.processing_expires_at > now()
  ) then
    return;
  end if;

  return query
  with selected as materialized (
    select queue_row.ico
    from public.complete_power_outage_contact_discovery_queue queue_row
    join public.complete_power_outage_contact_discovery_batches batch
      on batch.id = queue_row.origin_batch_id
    where batch.batch_status = 'active'
      and queue_row.company_profile_id is not null
      and queue_row.attempt_count < queue_row.max_attempt_count
      and queue_row.queue_status in ('pending', 'error')
      and coalesce(queue_row.next_attempt_at, now()) <= now()
    order by queue_row.priority desc, queue_row.next_attempt_at nulls first,
      queue_row.created_at, queue_row.ico
    for update of queue_row skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_contact_discovery_queue queue_row
    set queue_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '5 minutes',
        started_at = coalesce(queue_row.started_at, now()),
        finished_at = null,
        attempt_count = queue_row.attempt_count + 1,
        next_attempt_at = null,
        last_error_code = null,
        last_error_message = null
    from selected
    where queue_row.ico = selected.ico
    returning queue_row.ico, queue_row.company_profile_id,
      queue_row.processing_token, queue_row.attempt_count
  )
  select claimed.ico, claimed.company_profile_id, profile.official_name,
    claimed.processing_token, claimed.attempt_count
  from claimed
  join public.complete_power_outage_company_profiles profile
    on profile.id = claimed.company_profile_id
   and profile.ico = claimed.ico;
end;
$$;

create or replace function public.finish_complete_power_outage_contact_discovery_website(
  requested_ico text,
  requested_processing_token uuid,
  requested_result text,
  requested_website_id uuid default null,
  requested_evidence jsonb default '{}'::jsonb,
  requested_error_code text default null,
  requested_error_message text default null,
  requested_retryable boolean default true
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_row public.complete_power_outage_contact_discovery_queue%rowtype;
  next_status text;
  next_attempt timestamptz;
  is_terminal boolean := false;
begin
  if requested_result not in ('website_ready', 'needs_review', 'no_website', 'error') then
    raise exception 'Neplatny vysledek overeni webu: %.', requested_result;
  end if;
  if jsonb_typeof(coalesce(requested_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Dukaz overeni webu musi byt JSON objekt.';
  end if;

  select * into queue_row
  from public.complete_power_outage_contact_discovery_queue
  where complete_power_outage_contact_discovery_queue.ico = requested_ico
    and complete_power_outage_contact_discovery_queue.queue_status = 'processing'
    and complete_power_outage_contact_discovery_queue.processing_token = requested_processing_token
    and complete_power_outage_contact_discovery_queue.processing_expires_at > now()
  for update;
  if not found then return false; end if;

  if requested_result = 'website_ready' then
    if requested_website_id is null or not exists (
      select 1
      from public.complete_power_outage_company_websites website
      where website.id = requested_website_id
        and website.company_profile_id = queue_row.company_profile_id
        and website.verification_status = 'verified'
    ) then
      raise exception 'Overenemu vysledku chybi web stejneho firemniho profilu.';
    end if;
    next_status := 'website_ready';
    is_terminal := true;
  elsif requested_result in ('needs_review', 'no_website') then
    if requested_website_id is not null then
      raise exception 'Neovereny vysledek nesmi pripojit web k polozce fronty.';
    end if;
    next_status := requested_result;
    is_terminal := true;
  else
    next_status := 'error';
    if requested_retryable and queue_row.attempt_count < queue_row.max_attempt_count then
      next_attempt := now() + make_interval(
        mins => least(60, (2 ^ greatest(0, queue_row.attempt_count - 1))::integer)
      );
    else
      is_terminal := true;
    end if;
  end if;

  update public.complete_power_outage_contact_discovery_queue
  set queue_status = next_status,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = next_attempt,
      finished_at = case when is_terminal then now() else null end,
      discovered_website_id = case
        when next_status = 'website_ready' then requested_website_id
        else null
      end,
      discovered_contact_count = 0,
      last_error_code = case when next_status = 'error' then requested_error_code else null end,
      last_error_message = case when next_status = 'error' then requested_error_message else null end,
      metadata = metadata || jsonb_build_object(
        'websiteLookupContract', 'complete-contact-official-website-v1',
        'websiteLookupResult', next_status,
        'websiteLookupFinishedAt', now(),
        'websiteEvidence', coalesce(requested_evidence, '{}'::jsonb)
      )
  where complete_power_outage_contact_discovery_queue.ico = requested_ico;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      last_error_code = case when next_status = 'error' then requested_error_code else null end,
      last_error_message = case when next_status = 'error' then requested_error_message else null end,
      metadata = metadata || jsonb_build_object(
        'lastWebsiteLookupIco', requested_ico,
        'lastWebsiteLookupResult', next_status,
        'lastWebsiteLookupAt', now()
      )
  where singleton;

  if not exists (
    select 1
    from public.complete_power_outage_contact_discovery_queue remaining
    where remaining.origin_batch_id = queue_row.origin_batch_id
      and (
        remaining.queue_status in ('pending', 'processing', 'waiting_profile')
        or (remaining.queue_status = 'error'
          and remaining.attempt_count < remaining.max_attempt_count)
      )
  ) then
    update public.complete_power_outage_contact_discovery_batches
    set batch_status = 'completed', finished_at = now()
    where id = queue_row.origin_batch_id and batch_status = 'active';
  end if;

  return true;
end;
$$;

create or replace function public.activate_complete_power_outage_contact_discovery_websites()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepared_batch_id uuid;
  activated_count bigint;
begin
  perform 1 from public.complete_power_outage_contact_discovery_state
  where singleton for update;
  if not found then raise exception 'Chybi stav dohledavani kontaktu.'; end if;

  select nullif(metadata ->> 'preparedBatchId', '')::uuid
  into prepared_batch_id
  from public.complete_power_outage_contact_discovery_state
  where singleton;

  if prepared_batch_id is null or not exists (
    select 1 from public.complete_power_outage_contact_discovery_batches batch
    where batch.id = prepared_batch_id and batch.batch_status in ('ready', 'paused', 'active')
  ) then
    raise exception 'Chybi pripravena davka pro aktivaci overovani webu.';
  end if;

  update public.complete_power_outage_contact_discovery_batches
  set batch_status = 'active', activated_at = coalesce(activated_at, now()),
      finished_at = null,
      metadata = metadata || jsonb_build_object(
        'websiteLookupActivatedAt', now(),
        'websiteLookupContract', 'complete-contact-official-website-v1'
      )
  where id = prepared_batch_id;

  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = true,
      website_lookup_enabled = true,
      contact_extraction_enabled = false,
      ui_enabled = false,
      email_planning_enabled = false,
      email_dispatch_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'websiteLookupActivatedAt', now(),
        'websiteLookupBatchId', prepared_batch_id,
        'externalRequests', true,
        'contactExtraction', false,
        'emailSending', false
      )
  where singleton;

  perform public.refresh_complete_power_outage_contact_discovery_profiles();
  select count(*) into activated_count
  from public.complete_power_outage_contact_discovery_queue
  where origin_batch_id = prepared_batch_id
    and queue_status in ('pending', 'error', 'processing');

  return jsonb_build_object(
    'status', 'active', 'batchId', prepared_batch_id,
    'processableCount', activated_count, 'activatedAt', now()
  );
end;
$$;

create or replace function public.pause_complete_power_outage_contact_discovery_websites()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = false,
      website_lookup_enabled = false,
      contact_extraction_enabled = false,
      email_planning_enabled = false,
      email_dispatch_enabled = false,
      metadata = metadata || jsonb_build_object('websiteLookupPausedAt', now())
  where singleton and (discovery_enabled or website_lookup_enabled);

  update public.complete_power_outage_contact_discovery_batches batch
  set batch_status = 'paused'
  where batch.id = (
    select nullif(state_row.metadata ->> 'preparedBatchId', '')::uuid
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ) and batch.batch_status = 'active';
  return true;
end;
$$;

create or replace function public.request_complete_power_outage_contact_discovery_websites()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
begin
  if not coalesce((
    select state_row.discovery_enabled and state_row.website_lookup_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then return null; end if;

  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url neni platny.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybi.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/contact-discovery/websites/process?limit=1',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Official-Website-Discovery/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

create or replace view public.complete_power_outage_contact_discovery_operational_overview
with (security_invoker = true)
as
select
  state_row.selected_selector_key,
  state_row.discovery_enabled,
  state_row.website_lookup_enabled,
  state_row.contact_extraction_enabled,
  state_row.email_planning_enabled,
  state_row.email_dispatch_enabled,
  state_row.last_activity_at,
  state_row.last_error_code,
  state_row.last_error_message,
  batch.id as batch_id,
  batch.batch_status,
  batch.target_ico_count,
  count(queue_row.ico)::bigint as represented_count,
  count(*) filter (where queue_row.queue_status = 'waiting_profile')::bigint as waiting_profile_count,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status = 'website_ready')::bigint as verified_website_count,
  count(*) filter (where queue_row.queue_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where queue_row.queue_status = 'no_website')::bigint as no_website_count,
  count(*) filter (where queue_row.queue_status = 'error')::bigint as error_count,
  max(queue_row.updated_at) as latest_queue_activity_at
from public.complete_power_outage_contact_discovery_state state_row
left join public.complete_power_outage_contact_discovery_batches batch
  on batch.id = nullif(state_row.metadata ->> 'preparedBatchId', '')::uuid
left join public.complete_power_outage_contact_discovery_queue queue_row
  on queue_row.origin_batch_id = batch.id
where state_row.singleton
group by state_row.selected_selector_key, state_row.discovery_enabled,
  state_row.website_lookup_enabled, state_row.contact_extraction_enabled,
  state_row.email_planning_enabled, state_row.email_dispatch_enabled,
  state_row.last_activity_at, state_row.last_error_code,
  state_row.last_error_message, batch.id, batch.batch_status,
  batch.target_ico_count;

revoke all on function public.refresh_complete_power_outage_contact_discovery_profiles()
  from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_contact_discovery(integer)
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_contact_discovery_website(text,uuid,text,uuid,jsonb,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.activate_complete_power_outage_contact_discovery_websites()
  from public, anon, authenticated;
revoke all on function public.pause_complete_power_outage_contact_discovery_websites()
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_contact_discovery_websites()
  from public, anon, authenticated;

grant execute on function public.refresh_complete_power_outage_contact_discovery_profiles() to service_role;
grant execute on function public.claim_complete_power_outage_contact_discovery(integer) to service_role;
grant execute on function public.finish_complete_power_outage_contact_discovery_website(text,uuid,text,uuid,jsonb,text,text,boolean) to service_role;
grant execute on function public.activate_complete_power_outage_contact_discovery_websites() to service_role;
grant execute on function public.pause_complete_power_outage_contact_discovery_websites() to service_role;
grant execute on function public.request_complete_power_outage_contact_discovery_websites() to service_role;

revoke all on table public.complete_power_outage_contact_discovery_operational_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_discovery_operational_overview to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_contact_discovery_websites_every_minute',
      'complete_contact_discovery_websites_every_two_minutes',
      'complete_contact_discovery_websites_every_five_minutes'
    )
  loop perform cron.unschedule(existing_job.jobid); end loop;

  perform public.activate_complete_power_outage_contact_discovery_websites();
  perform cron.schedule(
    'complete_contact_discovery_websites_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_contact_discovery_websites();$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;
