begin;

-- Finalni admin-only rizeni dohledavani kontaktu. Instalace vse pozastavi.
alter table public.complete_power_outage_contact_discovery_state
  add column if not exists runtime_enabled boolean not null default false,
  add column if not exists brave_fallback_enabled boolean not null default false;

create or replace function public.get_complete_power_outage_contact_runtime_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Rizeni dohledavani kontaktu je dostupne pouze administratorum.';
  end if;

  select jsonb_build_object(
    'runtimeEnabled', state_row.runtime_enabled,
    'braveFallbackEnabled', state_row.brave_fallback_enabled,
    'localFirstEnabled', true,
    'selectedSelectorKey', state_row.selected_selector_key,
    'lastActivityAt', state_row.last_activity_at,
    'lastErrorCode', state_row.last_error_code,
    'lastErrorMessage', state_row.last_error_message
  ) into result
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.get_complete_power_outage_contact_management_summary_v2()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
  select public.get_complete_power_outage_contact_management_summary_v1()
    || public.get_complete_power_outage_contact_runtime_v1()
    || jsonb_build_object(
      'pendingCount',
        (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results website
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = website.ico
          where website.result_status in ('pending', 'error')
            and website.attempt_count < website.max_attempt_count)
        + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue extraction
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = extraction.ico
          where extraction.queue_status in ('pending', 'error')
            and extraction.attempt_count < extraction.max_attempt_count),
      'processingCount',
        (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results website
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = website.ico
          where website.result_status = 'processing')
        + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue extraction
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = extraction.ico
          where extraction.queue_status = 'processing'),
      'errorCount',
        (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results website
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = website.ico
          where website.result_status = 'error'
            and website.attempt_count >= website.max_attempt_count)
        + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue extraction
          join public.complete_power_outage_contact_discovery_batch_items item
            on item.batch_id = batch.id and item.ico = extraction.ico
          where extraction.queue_status = 'error'
            and extraction.attempt_count >= extraction.max_attempt_count)
    )
  from public.complete_power_outage_contact_discovery_state state_row
  left join lateral (
    select discovery_batch.id
    from public.complete_power_outage_contact_discovery_batches discovery_batch
    where discovery_batch.selector_key = state_row.selected_selector_key
    order by discovery_batch.created_at desc limit 1
  ) batch on true
  where state_row.singleton;
$$;

create or replace function public.set_complete_power_outage_contact_runtime_v1(
  requested_enabled boolean,
  requested_brave_fallback_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare capture_result jsonb := '{}'::jsonb; selected_batch_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Dohledavani kontaktu muze menit pouze administrator.';
  end if;
  if requested_brave_fallback_enabled and not requested_enabled then
    raise exception 'Brave fallback nelze zapnout pri pozastavenem dohledavani.';
  end if;

  perform pg_advisory_xact_lock(hashtext('complete-contact-discovery-runtime-v1'));

  if requested_enabled then
    capture_result := public.capture_complete_power_outage_contact_discovery_batch(
      (select selected_selector_key
       from public.complete_power_outage_contact_discovery_state where singleton)
    );
    selected_batch_id := nullif(capture_result ->> 'batchId', '')::uuid;

    insert into public.complete_power_outage_contact_discovery_website_v2_results (
      ico, company_profile_id, result_status, max_attempt_count, evidence
    )
    select queue_row.ico, queue_row.company_profile_id, 'pending', 1,
      jsonb_build_object(
        'contract', 'complete-contact-local-first-brave-fallback-v1',
        'queuedAt', now(),
        'braveFallbackEnabledAtQueueTime', requested_brave_fallback_enabled
      )
    from public.complete_power_outage_contact_discovery_queue queue_row
    join public.complete_power_outage_contact_discovery_batch_items batch_item
      on batch_item.batch_id = selected_batch_id
     and batch_item.ico = queue_row.ico
    where queue_row.company_profile_id is not null
    on conflict (ico) do nothing;

    if requested_brave_fallback_enabled then
      update public.complete_power_outage_contact_discovery_website_v2_results result_row
      set result_status = 'pending', attempt_count = 0, max_attempt_count = 1,
          next_attempt_at = null, finished_at = null,
          last_error_code = null, last_error_message = null,
          evidence = result_row.evidence || jsonb_build_object('braveFallbackReleasedAt', now())
      where result_row.result_status in ('no_website', 'needs_review')
        and coalesce(result_row.evidence -> 'search', 'null'::jsonb) = 'null'::jsonb
        and exists (
          select 1 from public.complete_power_outage_contact_discovery_batch_items batch_item
          where batch_item.batch_id = selected_batch_id and batch_item.ico = result_row.ico
        );
    end if;
  end if;

  update public.complete_power_outage_contact_discovery_state
  set runtime_enabled = requested_enabled,
      brave_fallback_enabled = requested_brave_fallback_enabled,
      -- Tento historicky priznak drzi dostupne i admin UI. Skutecny beh
      -- ridime runtime_enabled a konkretnimi worker prepinaci nize.
      discovery_enabled = true,
      website_lookup_enabled = false,
      website_verification_v2_enabled = requested_enabled,
      website_verification_v3_enabled = true,
      contact_extraction_shadow_enabled = requested_enabled,
      contact_extraction_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'runtimeContract', 'complete-contact-local-first-brave-fallback-v1',
        'runtimeChangedAt', now(),
        'runtimeChangedBy', auth.uid(),
        'runtimeEnabled', requested_enabled,
        'braveFallbackEnabled', requested_brave_fallback_enabled,
        'localFirstEnabled', true,
        'captureResult', capture_result
      ),
      updated_at = now()
  where singleton;

  return public.get_complete_power_outage_contact_management_summary_v2();
end;
$$;

create or replace function public.refresh_complete_power_outage_contact_pipeline_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare verification_result jsonb; extraction_result jsonb;
begin
  if not coalesce((select runtime_enabled
    from public.complete_power_outage_contact_discovery_state where singleton), false)
  then return jsonb_build_object('status', 'disabled'); end if;
  verification_result := public.refresh_complete_power_outage_contact_discovery_website_v3();
  extraction_result := public.capture_complete_power_outage_contact_extraction_shadow();
  return jsonb_build_object(
    'status', 'succeeded',
    'verification', verification_result,
    'extraction', extraction_result
  );
end;
$$;

revoke all on function public.get_complete_power_outage_contact_runtime_v1() from public, anon;
revoke all on function public.get_complete_power_outage_contact_management_summary_v2() from public, anon;
revoke all on function public.set_complete_power_outage_contact_runtime_v1(boolean,boolean) from public, anon;
revoke all on function public.refresh_complete_power_outage_contact_pipeline_v1() from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_contact_runtime_v1() to authenticated, service_role;
grant execute on function public.get_complete_power_outage_contact_management_summary_v2() to authenticated, service_role;
grant execute on function public.set_complete_power_outage_contact_runtime_v1(boolean,boolean) to authenticated, service_role;
grant execute on function public.refresh_complete_power_outage_contact_pipeline_v1() to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_contact_local_first_v1_every_fifteen_seconds',
      'complete_contact_local_pipeline_v1_every_minute'
    )
  loop perform cron.unschedule(existing_job.jobid); end loop;
  perform cron.schedule(
    'complete_contact_local_first_v1_every_fifteen_seconds',
    '15 seconds',
    $job$select public.request_complete_power_outage_contact_discovery_website_v2();$job$
  );
  perform cron.schedule(
    'complete_contact_local_pipeline_v1_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_contact_pipeline_v1();$job$
  );
end
$$;

-- Bezpecny vychozi stav po instalaci: zadny worker ani Brave pozadavek.
update public.complete_power_outage_contact_discovery_state
set runtime_enabled = false,
    brave_fallback_enabled = false,
    discovery_enabled = true,
    website_lookup_enabled = false,
    website_verification_v2_enabled = false,
    contact_extraction_shadow_enabled = false,
    contact_extraction_enabled = false,
    metadata = metadata || jsonb_build_object(
      'runtimeContract', 'complete-contact-local-first-brave-fallback-v1',
      'runtimeInstalledAt', now(),
      'runtimeEnabled', false,
      'braveFallbackEnabled', false,
      'localFirstEnabled', true
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (values
  ('FUNCTION'::text, 'admin contact discovery runtime control exists'::text,
    to_regprocedure('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)') is not null),
  ('GRANT', 'contact runtime operations enforce administrator role',
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'Brave fallback requires enabled contact discovery',
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) ilike '%requested_brave_fallback_enabled and not requested_enabled%'),
  ('LOGIC', 'new website candidates allow only one paid search attempt',
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) ilike '%max_attempt_count, evidence%1,%'),
  ('SAFETY', 'installation pauses contact discovery and Brave fallback',
    (select not runtime_enabled and not brave_fallback_enabled
      and discovery_enabled and not website_verification_v2_enabled
      and not contact_extraction_shadow_enabled
     from public.complete_power_outage_contact_discovery_state where singleton)),
  ('SAFETY', 'contact runtime control cannot enable email sending',
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) not ilike '%email_dispatch_enabled = true%'),
  ('ISOLATION', 'contact runtime stays in COMPLETE scope',
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) not ilike '%power_outage_store%'),
  ('CRON', 'local-first contact discovery checks safely every fifteen seconds',
    exists (select 1 from cron.job where jobname = 'complete_contact_local_first_v1_every_fifteen_seconds' and active)),
  ('CRON', 'derived contact pipeline reconciles every minute',
    exists (select 1 from cron.job where jobname = 'complete_contact_local_pipeline_v1_every_minute' and active))
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
