begin;

-- Krok 5 v2 SHADOW: prisnejsi overeni oficialnich domen.
-- V1 vysledky zustavaji beze zmeny; kontakty, UI a e-maily zustavaji vypnute.
alter table public.complete_power_outage_contact_discovery_state
  add column if not exists website_verification_v2_enabled boolean not null default false;

create table if not exists public.complete_power_outage_contact_discovery_website_v2_results (
  ico text primary key
    references public.complete_power_outage_contact_discovery_queue(ico) on delete restrict,
  company_profile_id uuid not null,
  result_status text not null default 'pending',
  website_kind text,
  candidate_url text,
  normalized_domain text,
  confidence numeric(5,4) not null default 0,
  verification_methods text[] not null default '{}'::text[],
  reason_codes text[] not null default '{}'::text[],
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 5,
  next_attempt_at timestamptz,
  processing_token uuid,
  processing_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_website_v2_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_website_v2_status_check check (
    result_status in (
      'pending', 'processing', 'verified_company', 'verified_group',
      'needs_review', 'no_website', 'error', 'cancelled'
    )
  ),
  constraint cpo_contact_website_v2_kind_check check (
    website_kind is null or website_kind in ('company', 'group')
  ),
  constraint cpo_contact_website_v2_result_check check (
    (
      result_status = 'verified_company'
      and website_kind = 'company'
      and candidate_url ~* '^https?://'
      and normalized_domain is not null
      and confidence >= 0.9
    )
    or (
      result_status = 'verified_group'
      and website_kind = 'group'
      and candidate_url ~* '^https?://'
      and normalized_domain is not null
      and confidence >= 0.9
    )
    or result_status not in ('verified_company', 'verified_group')
  ),
  constraint cpo_contact_website_v2_processing_check check (
    (
      result_status = 'processing'
      and processing_token is not null
      and processing_expires_at is not null
    )
    or (
      result_status <> 'processing'
      and processing_token is null
      and processing_expires_at is null
    )
  ),
  constraint cpo_contact_website_v2_attempt_check check (
    attempt_count >= 0 and attempt_count <= max_attempt_count
    and max_attempt_count between 1 and 20
  ),
  constraint cpo_contact_website_v2_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index if not exists cpo_contact_website_v2_work_idx
  on public.complete_power_outage_contact_discovery_website_v2_results (
    result_status, next_attempt_at, created_at, ico
  ) where result_status in ('pending', 'error');

drop trigger if exists cpo_contact_website_v2_set_updated_at
  on public.complete_power_outage_contact_discovery_website_v2_results;
create trigger cpo_contact_website_v2_set_updated_at
before update on public.complete_power_outage_contact_discovery_website_v2_results
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_discovery_website_v2_results
  enable row level security;
revoke all on table public.complete_power_outage_contact_discovery_website_v2_results
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_discovery_website_v2_results
  to service_role;

create or replace function public.claim_complete_power_outage_contact_discovery_website_v2()
returns table (
  ico text,
  company_profile_id uuid,
  company_name text,
  processing_token uuid,
  attempt_count integer,
  prior_website_url text
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
begin
  if not coalesce((
    select state_row.website_verification_v2_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then return; end if;

  update public.complete_power_outage_contact_discovery_website_v2_results result_row
  set result_status = 'error',
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = case
        when result_row.attempt_count < result_row.max_attempt_count
          then now() + interval '2 minutes'
        else null
      end,
      finished_at = case
        when result_row.attempt_count >= result_row.max_attempt_count then now()
        else null
      end,
      last_error_code = 'COMPLETE_CONTACT_WEBSITE_V2_LEASE_EXPIRED',
      last_error_message = 'Predchozi v2 worker nedokoncil overeni domeny pred vyprsenim lease.'
  where result_row.result_status = 'processing'
    and result_row.processing_expires_at <= now();

  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.result_status = 'processing'
      and result_row.processing_expires_at > now()
  ) then return; end if;

  return query
  with selected as materialized (
    select result_row.ico
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.attempt_count < result_row.max_attempt_count
      and result_row.result_status in ('pending', 'error')
      and coalesce(result_row.next_attempt_at, now()) <= now()
    order by result_row.next_attempt_at nulls first, result_row.created_at, result_row.ico
    for update skip locked
    limit 1
  ), claimed as (
    update public.complete_power_outage_contact_discovery_website_v2_results result_row
    set result_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '5 minutes',
        started_at = coalesce(result_row.started_at, now()),
        finished_at = null,
        attempt_count = result_row.attempt_count + 1,
        next_attempt_at = null,
        last_error_code = null,
        last_error_message = null
    from selected
    where result_row.ico = selected.ico
    returning result_row.ico, result_row.company_profile_id,
      result_row.processing_token, result_row.attempt_count
  )
  select claimed.ico, claimed.company_profile_id, profile.official_name,
    claimed.processing_token, claimed.attempt_count, website.website_url
  from claimed
  join public.complete_power_outage_company_profiles profile
    on profile.id = claimed.company_profile_id and profile.ico = claimed.ico
  left join public.complete_power_outage_contact_discovery_queue v1_queue
    on v1_queue.ico = claimed.ico
  left join public.complete_power_outage_company_websites website
    on website.id = v1_queue.discovered_website_id
   and website.company_profile_id = claimed.company_profile_id;
end;
$$;

create or replace function public.finish_complete_power_outage_contact_discovery_website_v2(
  requested_ico text,
  requested_processing_token uuid,
  requested_result text,
  requested_website_kind text default null,
  requested_candidate_url text default null,
  requested_normalized_domain text default null,
  requested_confidence numeric default 0,
  requested_verification_methods text[] default '{}'::text[],
  requested_reason_codes text[] default '{}'::text[],
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
  result_row public.complete_power_outage_contact_discovery_website_v2_results%rowtype;
  next_attempt timestamptz;
  terminal_result boolean := true;
begin
  if requested_result not in (
    'verified_company', 'verified_group', 'needs_review', 'no_website', 'error'
  ) then raise exception 'Neplatny v2 vysledek webu: %.', requested_result; end if;
  if jsonb_typeof(coalesce(requested_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'V2 dukaz musi byt JSON objekt.';
  end if;

  select * into result_row
  from public.complete_power_outage_contact_discovery_website_v2_results
  where complete_power_outage_contact_discovery_website_v2_results.ico = requested_ico
    and complete_power_outage_contact_discovery_website_v2_results.result_status = 'processing'
    and complete_power_outage_contact_discovery_website_v2_results.processing_token = requested_processing_token
    and complete_power_outage_contact_discovery_website_v2_results.processing_expires_at > now()
  for update;
  if not found then return false; end if;

  if requested_result in ('verified_company', 'verified_group') then
    if requested_candidate_url !~* '^https?://'
       or nullif(btrim(requested_normalized_domain), '') is null
       or requested_confidence < 0.9
       or (
         requested_result = 'verified_company'
         and requested_website_kind is distinct from 'company'
       )
       or (
         requested_result = 'verified_group'
         and requested_website_kind is distinct from 'group'
       )
    then raise exception 'Overeny v2 vysledek nema uplny first-party dukaz.'; end if;
  end if;

  if requested_result = 'error' and requested_retryable
     and result_row.attempt_count < result_row.max_attempt_count then
    terminal_result := false;
    next_attempt := now() + make_interval(
      mins => least(60, (2 ^ greatest(0, result_row.attempt_count - 1))::integer)
    );
  end if;

  update public.complete_power_outage_contact_discovery_website_v2_results
  set result_status = requested_result,
      website_kind = case when requested_result like 'verified_%' then requested_website_kind else null end,
      candidate_url = case when requested_result like 'verified_%' then requested_candidate_url else null end,
      normalized_domain = case when requested_result like 'verified_%' then requested_normalized_domain else null end,
      confidence = case when requested_result like 'verified_%' then requested_confidence else 0 end,
      verification_methods = coalesce(requested_verification_methods, '{}'::text[]),
      reason_codes = coalesce(requested_reason_codes, '{}'::text[]),
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = next_attempt,
      finished_at = case when terminal_result then now() else null end,
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then requested_error_message else null end,
      evidence = coalesce(requested_evidence, '{}'::jsonb)
  where complete_power_outage_contact_discovery_website_v2_results.ico = requested_ico;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then requested_error_message else null end,
      metadata = metadata || jsonb_build_object(
        'websiteVerificationV2LastIco', requested_ico,
        'websiteVerificationV2LastResult', requested_result,
        'websiteVerificationV2LastActivityAt', now()
      )
  where singleton;
  return true;
end;
$$;

create or replace function public.activate_complete_power_outage_contact_discovery_website_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepared_batch_id uuid;
  target_count bigint;
begin
  perform 1 from public.complete_power_outage_contact_discovery_state
  where singleton for update;
  if not found then raise exception 'Chybi stav dohledavani kontaktu.'; end if;

  select nullif(metadata ->> 'preparedBatchId', '')::uuid into prepared_batch_id
  from public.complete_power_outage_contact_discovery_state where singleton;
  if prepared_batch_id is null then raise exception 'Chybi pripravena davka.'; end if;

  insert into public.complete_power_outage_contact_discovery_website_v2_results (
    ico, company_profile_id, result_status, next_attempt_at, evidence
  )
  select queue_row.ico, queue_row.company_profile_id, 'pending', now(),
    jsonb_build_object(
      'contract', 'complete-contact-official-website-v2-shadow',
      'sourceBatchId', prepared_batch_id,
      'v1Status', queue_row.queue_status,
      'v1ResultPreserved', true
    )
  from public.complete_power_outage_contact_discovery_queue queue_row
  where queue_row.origin_batch_id = prepared_batch_id
    and queue_row.company_profile_id is not null
  on conflict (ico) do nothing;

  select count(*) into target_count
  from public.complete_power_outage_contact_discovery_website_v2_results;

  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = true,
      website_lookup_enabled = false,
      website_verification_v2_enabled = true,
      contact_extraction_enabled = false,
      ui_enabled = false,
      email_planning_enabled = false,
      email_dispatch_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'websiteVerificationV2ActivatedAt', now(),
        'websiteVerificationV2Contract', 'complete-contact-official-website-v2-shadow',
        'websiteVerificationV2TargetCount', target_count,
        'v1ResultsPreserved', true,
        'contactExtraction', false,
        'emailSending', false
      )
  where singleton;

  return jsonb_build_object(
    'status', 'active', 'targetCount', target_count, 'activatedAt', now()
  );
end;
$$;

create or replace function public.pause_complete_power_outage_contact_discovery_website_v2()
returns boolean
language sql
security definer
set search_path = ''
as $$
  update public.complete_power_outage_contact_discovery_state
  set website_verification_v2_enabled = false,
      discovery_enabled = false,
      metadata = metadata || jsonb_build_object('websiteVerificationV2PausedAt', now())
  where singleton
  returning true;
$$;

create or replace function public.request_complete_power_outage_contact_discovery_website_v2()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare app_url text; automation_token text; request_id bigint;
begin
  if not coalesce((
    select website_verification_v2_enabled
    from public.complete_power_outage_contact_discovery_state where singleton
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
    url := app_url || '/api/power-outages/complete/contact-discovery/websites-v2/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Official-Website-V2-Shadow/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

create or replace view public.complete_power_outage_contact_discovery_website_v2_overview
with (security_invoker = true)
as
select
  state_row.website_verification_v2_enabled,
  count(result_row.ico)::bigint as target_count,
  count(*) filter (where result_row.result_status = 'pending')::bigint as pending_count,
  count(*) filter (where result_row.result_status = 'processing')::bigint as processing_count,
  count(*) filter (where result_row.result_status = 'verified_company')::bigint as verified_company_count,
  count(*) filter (where result_row.result_status = 'verified_group')::bigint as verified_group_count,
  count(*) filter (where result_row.result_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where result_row.result_status = 'no_website')::bigint as no_website_count,
  count(*) filter (where result_row.result_status = 'error')::bigint as error_count,
  max(result_row.updated_at) as latest_activity_at
from public.complete_power_outage_contact_discovery_state state_row
left join public.complete_power_outage_contact_discovery_website_v2_results result_row on true
where state_row.singleton
group by state_row.website_verification_v2_enabled;

revoke all on function public.claim_complete_power_outage_contact_discovery_website_v2()
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_contact_discovery_website_v2(text,uuid,text,text,text,text,numeric,text[],text[],jsonb,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.activate_complete_power_outage_contact_discovery_website_v2()
  from public, anon, authenticated;
revoke all on function public.pause_complete_power_outage_contact_discovery_website_v2()
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_contact_discovery_website_v2()
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_contact_discovery_website_v2() to service_role;
grant execute on function public.finish_complete_power_outage_contact_discovery_website_v2(text,uuid,text,text,text,text,numeric,text[],text[],jsonb,text,text,boolean) to service_role;
grant execute on function public.activate_complete_power_outage_contact_discovery_website_v2() to service_role;
grant execute on function public.pause_complete_power_outage_contact_discovery_website_v2() to service_role;
grant execute on function public.request_complete_power_outage_contact_discovery_website_v2() to service_role;
revoke all on table public.complete_power_outage_contact_discovery_website_v2_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_discovery_website_v2_overview to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'complete_contact_discovery_websites_every_minute',
      'complete_contact_discovery_websites_every_fifteen_seconds',
      'complete_contact_discovery_websites_v2_every_fifteen_seconds'
    )
  loop perform cron.unschedule(existing_job.jobid); end loop;
  perform public.activate_complete_power_outage_contact_discovery_website_v2();
  perform cron.schedule(
    'complete_contact_discovery_websites_v2_every_fifteen_seconds',
    '15 seconds',
    $job$select public.request_complete_power_outage_contact_discovery_website_v2();$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;
