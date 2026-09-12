begin;

-- Etapa 2: samostatny bezplatny SHADOW worker. Nejprve vyuzije verejne ARES
-- kontakty, drive overene domeny a nejvyse tri deterministicke .cz varianty.
-- Brave ani jiny vyhledavaci provider tato etapa nevola. Instalace worker
-- ponecha vypnuty a nijak nemeni e-mailove planovani nebo odesilani.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_pipeline_v2_shadow') is null
    or to_regclass('public.complete_power_outage_company_websites') is null
    or to_regclass('public.complete_power_outage_company_contacts') is null then
    raise exception 'Chybi zavislosti pro etapu 2 local-first kontaktu.';
  end if;
end
$$;

alter table public.complete_power_outage_contact_discovery_state
  add column if not exists local_discovery_v2_shadow_enabled boolean not null default false;

create or replace function public.complete_power_outage_contact_email_is_automatic_v1(
  requested_email text
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when lower(split_part(btrim(requested_email), '@', 1))
      ~ '^(servis|service|servisni|provoz|vyroba|technik|technicke|udrzba|maintenance|dispecink|dispatch|doprava|logistika|sklad|mistr|vedouci|zkusebna|lakovna|technologie|nahradni)([._-]|$)'
      then true
    when lower(split_part(btrim(requested_email), '@', 1))
      ~ '^(info|kontakt|contact|office|recepce|reception|sekretariat|mail|hello|firma|company)([._-]|$)'
      then true
    when lower(split_part(btrim(requested_email), '@', 1))
      ~ '^(obchod|obchodni|sales|poptav[a-z]*|rfq|nabid[a-z]*|export)([._-]|$)'
      then true
    when lower(split_part(btrim(requested_email), '@', 1))
      ~ '^priprava[._-]?nabid' then true
    when lower(split_part(btrim(requested_email), '@', 1)) in (
      'okna.priprava', 'vysavace.odsavace', 'alucomposite', 'modrylom'
    ) then true
    else false
  end;
$$;

create table if not exists public.complete_power_outage_contact_local_discovery_v2_shadow (
  ico text primary key,
  origin_batch_id uuid not null,
  company_profile_id uuid not null,
  company_name_snapshot text not null,
  queue_status text not null default 'pending',
  contact_count integer not null default 0,
  email_count integer not null default 0,
  eligible_email_count integer not null default 0,
  phone_count integer not null default 0,
  checked_candidate_count integer not null default 0,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 1,
  processing_token uuid,
  processing_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_local_v2_batch_item_fkey
    foreign key (origin_batch_id, ico)
    references public.complete_power_outage_contact_discovery_batch_items(batch_id, ico)
    on delete restrict,
  constraint cpo_contact_local_v2_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico)
    on delete restrict,
  constraint cpo_contact_local_v2_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_contact_local_v2_name_check check (btrim(company_name_snapshot) <> ''),
  constraint cpo_contact_local_v2_status_check check (queue_status in (
    'pending', 'processing', 'local_contact_found', 'no_eligible_contact',
    'needs_review', 'technical_error', 'cancelled'
  )),
  constraint cpo_contact_local_v2_counts_check check (
    contact_count >= 0 and email_count >= 0 and eligible_email_count >= 0
    and phone_count >= 0 and checked_candidate_count >= 0
    and eligible_email_count <= email_count
    and email_count + phone_count = contact_count
  ),
  constraint cpo_contact_local_v2_attempt_check check (
    attempt_count >= 0 and attempt_count <= max_attempt_count
    and max_attempt_count = 1
  ),
  constraint cpo_contact_local_v2_processing_check check (
    (queue_status = 'processing' and processing_token is not null and processing_expires_at is not null)
    or (queue_status <> 'processing' and processing_token is null and processing_expires_at is null)
  ),
  constraint cpo_contact_local_v2_result_check check (
    (queue_status = 'local_contact_found' and eligible_email_count > 0 and finished_at is not null)
    or (queue_status in ('no_eligible_contact', 'needs_review', 'technical_error', 'cancelled')
      and finished_at is not null)
    or queue_status in ('pending', 'processing')
  ),
  constraint cpo_contact_local_v2_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index if not exists cpo_contact_local_v2_work_idx
  on public.complete_power_outage_contact_local_discovery_v2_shadow (
    queue_status, created_at, ico
  ) where queue_status = 'pending';

create table if not exists public.complete_power_outage_contact_local_discovery_v2_contacts (
  id uuid primary key default gen_random_uuid(),
  ico text not null references public.complete_power_outage_contact_local_discovery_v2_shadow(ico)
    on delete cascade,
  company_profile_id uuid not null,
  normalized_domain text not null,
  contact_type text not null,
  normalized_value text not null,
  source_url text not null,
  contact_role text not null,
  is_personal boolean not null default false,
  confidence numeric(5,4) not null default 0,
  notification_eligible boolean not null default false,
  extraction_methods text[] not null default '{}'::text[],
  review_flags text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_contact_local_v2_contact_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_local_v2_contact_type_check check (contact_type in ('email', 'phone')),
  constraint cpo_contact_local_v2_contact_value_check check (
    (contact_type = 'email' and normalized_value ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$')
    or (contact_type = 'phone' and normalized_value ~ '^\+420[1-9][0-9]{8}$')
  ),
  constraint cpo_contact_local_v2_contact_domain_check check (
    normalized_domain = lower(btrim(normalized_domain))
    and normalized_domain ~ '^[a-z0-9.-]+$'
  ),
  constraint cpo_contact_local_v2_contact_url_check check (source_url ~* '^https?://'),
  constraint cpo_contact_local_v2_contact_role_check check (
    contact_role in ('general', 'operations', 'customer_service', 'personal', 'unknown')
  ),
  constraint cpo_contact_local_v2_contact_confidence_check check (confidence between 0 and 1),
  constraint cpo_contact_local_v2_contact_eligibility_check check (
    notification_eligible = (
      contact_type = 'email'
      and public.complete_power_outage_contact_email_is_automatic_v1(normalized_value)
    )
  ),
  constraint cpo_contact_local_v2_contact_evidence_check check (jsonb_typeof(evidence) = 'object'),
  unique (ico, contact_type, normalized_value)
);

drop trigger if exists cpo_contact_local_v2_set_updated_at
  on public.complete_power_outage_contact_local_discovery_v2_shadow;
create trigger cpo_contact_local_v2_set_updated_at
before update on public.complete_power_outage_contact_local_discovery_v2_shadow
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_local_discovery_v2_shadow enable row level security;
alter table public.complete_power_outage_contact_local_discovery_v2_contacts enable row level security;
revoke all on table public.complete_power_outage_contact_local_discovery_v2_shadow
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_contact_local_discovery_v2_contacts
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_local_discovery_v2_shadow to service_role;
grant all on table public.complete_power_outage_contact_local_discovery_v2_contacts to service_role;

create or replace function public.capture_complete_power_outage_contact_local_discovery_v2_shadow()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare inserted_count integer := 0; local_ready_count integer := 0;
begin
  perform public.refresh_complete_power_outage_contact_pipeline_v2_shadow();

  with source_rows as materialized (
    select
      pipeline.batch_id,
      pipeline.ico,
      pipeline.company_profile_id,
      pipeline.company_name_snapshot,
      exists (
        select 1
        from public.complete_power_outage_company_contacts contact
        where contact.company_profile_id = pipeline.company_profile_id
          and contact.contact_type = 'email'
          and contact.is_public_at_source
          and contact.source_validity_status <> 'invalid'
          and contact.outreach_permission_status <> 'blocked'
          and public.complete_power_outage_contact_email_is_automatic_v1(contact.normalized_value)
      ) as has_usable_ares_email
    from public.complete_power_outage_contact_pipeline_v2_shadow pipeline
    where pipeline.company_profile_id is not null
      and not pipeline.has_eligible_email
      and not pipeline.brave_used
      and pipeline.pipeline_status in ('local_pending', 'brave_eligible', 'no_usable_email', 'no_website')
      and pipeline.batch_id = (
        select selected_batch.id
        from public.complete_power_outage_contact_discovery_state state_row
        join lateral (
          select batch.id
          from public.complete_power_outage_contact_discovery_batches batch
          where batch.selector_key = state_row.selected_selector_key
            and batch.batch_status in ('ready', 'active', 'paused', 'completed')
          order by batch.created_at desc, batch.id desc
          limit 1
        ) selected_batch on true
        where state_row.singleton
      )
  )
  insert into public.complete_power_outage_contact_local_discovery_v2_shadow (
    ico, origin_batch_id, company_profile_id, company_name_snapshot,
    queue_status, contact_count, email_count, eligible_email_count,
    phone_count, finished_at, evidence
  )
  select
    source.ico, source.batch_id, source.company_profile_id, source.company_name_snapshot,
    case when source.has_usable_ares_email then 'local_contact_found' else 'pending' end,
    case when source.has_usable_ares_email then 1 else 0 end,
    case when source.has_usable_ares_email then 1 else 0 end,
    case when source.has_usable_ares_email then 1 else 0 end,
    0,
    case when source.has_usable_ares_email then now() else null end,
    jsonb_build_object(
      'contract', 'complete-contact-local-discovery-v2-shadow',
      'localOnly', true,
      'braveRequestCount', 0,
      'aresUsableEmailFound', source.has_usable_ares_email,
      'productionContactsMutated', false,
      'emailSendingChanged', false
    )
  from source_rows source
  on conflict (ico) do nothing;

  get diagnostics inserted_count = row_count;
  select count(*) into local_ready_count
  from public.complete_power_outage_contact_local_discovery_v2_shadow
  where queue_status = 'local_contact_found';

  return jsonb_build_object(
    'status', 'captured',
    'insertedCount', inserted_count,
    'localContactFoundCount', local_ready_count,
    'externalRequestCount', 0,
    'braveRequestCount', 0
  );
end;
$$;

create or replace function public.claim_complete_power_outage_contact_local_discovery_v2_shadow()
returns table (
  batch_id uuid,
  ico text,
  company_profile_id uuid,
  company_name text,
  known_website_urls jsonb,
  processing_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
begin
  if not coalesce((
    select state_row.local_discovery_v2_shadow_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then return; end if;

  update public.complete_power_outage_contact_local_discovery_v2_shadow queue_row
  set queue_status = 'needs_review',
      processing_token = null,
      processing_expires_at = null,
      finished_at = now(),
      last_error_code = 'LOCAL_DISCOVERY_LEASE_EXPIRED',
      last_error_message = 'Lokální worker překročil časový limit; automatický pokus se neopakuje.',
      evidence = queue_row.evidence || jsonb_build_object(
        'leaseExpiredAt', now(), 'automaticRetrySuppressed', true, 'braveRequestCount', 0
      )
  where queue_row.queue_status = 'processing'
    and queue_row.processing_expires_at <= now();

  if exists (
    select 1 from public.complete_power_outage_contact_local_discovery_v2_shadow queue_row
    where queue_row.queue_status = 'processing'
      and queue_row.processing_expires_at > now()
  ) then return; end if;

  perform public.capture_complete_power_outage_contact_local_discovery_v2_shadow();

  return query
  with selected as materialized (
    select queue_row.ico
    from public.complete_power_outage_contact_local_discovery_v2_shadow queue_row
    where queue_row.queue_status = 'pending'
      and queue_row.attempt_count < queue_row.max_attempt_count
    order by queue_row.created_at, queue_row.ico
    for update skip locked
    limit 1
  ), claimed as (
    update public.complete_power_outage_contact_local_discovery_v2_shadow queue_row
    set queue_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '150 seconds',
        started_at = coalesce(queue_row.started_at, now()),
        attempt_count = queue_row.attempt_count + 1,
        last_error_code = null,
        last_error_message = null
    from selected
    where queue_row.ico = selected.ico
    returning queue_row.*
  )
  select
    claimed.origin_batch_id,
    claimed.ico,
    claimed.company_profile_id,
    claimed.company_name_snapshot,
    coalesce((
      select jsonb_agg(website.website_url order by website.confidence desc, website.updated_at desc)
      from (
        select website.website_url, website.confidence, website.updated_at
        from public.complete_power_outage_company_websites website
        where website.company_profile_id = claimed.company_profile_id
          and website.verification_status = 'verified'
          and (website.expires_at is null or website.expires_at > now())
        order by website.confidence desc, website.updated_at desc
        limit 2
      ) website
    ), '[]'::jsonb),
    claimed.processing_token,
    claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.finish_complete_power_outage_contact_local_discovery_v2_shadow(
  requested_ico text,
  requested_processing_token uuid,
  requested_result text,
  requested_contacts jsonb default '[]'::jsonb,
  requested_checked_candidates jsonb default '[]'::jsonb,
  requested_error_code text default null,
  requested_error_message text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_row public.complete_power_outage_contact_local_discovery_v2_shadow%rowtype;
  inserted_count integer := 0; found_email_count integer := 0;
  found_eligible_count integer := 0; found_phone_count integer := 0;
  candidate_count integer := 0; final_status text;
begin
  if requested_result not in ('completed', 'error') then
    raise exception 'Neplatny vysledek lokalniho dohledani: %.', requested_result;
  end if;
  if jsonb_typeof(coalesce(requested_contacts, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(requested_contacts, '[]'::jsonb)) > 100
    or jsonb_typeof(coalesce(requested_checked_candidates, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(requested_checked_candidates, '[]'::jsonb)) > 5 then
    raise exception 'Neplatny nebo prilis velky vysledek lokalniho dohledani.';
  end if;

  select * into queue_row
  from public.complete_power_outage_contact_local_discovery_v2_shadow
  where complete_power_outage_contact_local_discovery_v2_shadow.ico = requested_ico
    and complete_power_outage_contact_local_discovery_v2_shadow.queue_status = 'processing'
    and complete_power_outage_contact_local_discovery_v2_shadow.processing_token = requested_processing_token
    and complete_power_outage_contact_local_discovery_v2_shadow.processing_expires_at > now()
  for update;
  if not found then return false; end if;

  candidate_count := jsonb_array_length(coalesce(requested_checked_candidates, '[]'::jsonb));

  if requested_result = 'completed' then
    delete from public.complete_power_outage_contact_local_discovery_v2_contacts
    where ico = requested_ico;

    insert into public.complete_power_outage_contact_local_discovery_v2_contacts (
      ico, company_profile_id, normalized_domain, contact_type, normalized_value,
      source_url, contact_role, is_personal, confidence, notification_eligible,
      extraction_methods, review_flags, evidence
    )
    select
      queue_row.ico,
      queue_row.company_profile_id,
      regexp_replace(
        regexp_replace(lower(split_part(contact."sourceUrl", '/', 3)), '^www\.', ''),
        ':[0-9]+$', ''
      ),
      contact.type,
      contact."normalizedValue",
      contact."sourceUrl",
      contact.role,
      coalesce(contact."isPersonal", false),
      coalesce(contact.confidence, 0),
      contact.type = 'email'
        and public.complete_power_outage_contact_email_is_automatic_v1(contact."normalizedValue"),
      coalesce(contact."extractionMethods", '{}'::text[]),
      coalesce(contact."reviewFlags", '{}'::text[]),
      jsonb_build_object(
        'contract', 'complete-contact-local-discovery-v2-shadow',
        'localOnly', true, 'braveRequestCount', 0, 'productionContact', false
      )
    from jsonb_to_recordset(coalesce(requested_contacts, '[]'::jsonb)) as contact(
      type text,
      "normalizedValue" text,
      "sourceUrl" text,
      role text,
      "isPersonal" boolean,
      confidence numeric,
      "extractionMethods" text[],
      "reviewFlags" text[]
    )
    on conflict (ico, contact_type, normalized_value) do update
    set source_url = excluded.source_url,
        contact_role = excluded.contact_role,
        is_personal = excluded.is_personal,
        confidence = greatest(
          public.complete_power_outage_contact_local_discovery_v2_contacts.confidence,
          excluded.confidence
        ),
        notification_eligible = excluded.notification_eligible,
        extraction_methods = excluded.extraction_methods,
        review_flags = excluded.review_flags,
        evidence = excluded.evidence;
    get diagnostics inserted_count = row_count;

    select
      count(*) filter (where contact_type = 'email'),
      count(*) filter (where notification_eligible),
      count(*) filter (where contact_type = 'phone')
    into found_email_count, found_eligible_count, found_phone_count
    from public.complete_power_outage_contact_local_discovery_v2_contacts
    where ico = requested_ico;

    final_status := case when found_eligible_count > 0
      then 'local_contact_found' else 'no_eligible_contact' end;
  else
    final_status := 'technical_error';
  end if;

  update public.complete_power_outage_contact_local_discovery_v2_shadow
  set queue_status = final_status,
      contact_count = inserted_count,
      email_count = found_email_count,
      eligible_email_count = found_eligible_count,
      phone_count = found_phone_count,
      checked_candidate_count = candidate_count,
      processing_token = null,
      processing_expires_at = null,
      finished_at = now(),
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then requested_error_message else null end,
      evidence = jsonb_build_object(
        'contract', 'complete-contact-local-discovery-v2-shadow',
        'localOnly', true,
        'braveRequestCount', 0,
        'checkedCandidates', coalesce(requested_checked_candidates, '[]'::jsonb),
        'productionContactsMutated', false,
        'emailSendingChanged', false
      )
  where ico = requested_ico;

  perform public.refresh_complete_power_outage_contact_pipeline_v2_shadow();
  return true;
end;
$$;

create or replace function public.request_complete_power_outage_contact_local_discovery_v2_shadow()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare app_url text; automation_token text; request_id bigint;
begin
  if not coalesce((select local_discovery_v2_shadow_enabled
    from public.complete_power_outage_contact_discovery_state where singleton), false)
  then return null; end if;

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
    url := app_url || '/api/power-outages/complete/contact-discovery/local-v2-shadow/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Local-Contact-V2-Shadow/1.0'
    ),
    timeout_milliseconds := 180000
  ) into request_id;
  return request_id;
end;
$$;

create or replace view public.complete_power_outage_contact_local_discovery_v2_overview
with (security_invoker = true)
as
select
  state_row.local_discovery_v2_shadow_enabled,
  count(queue_row.ico)::bigint as target_count,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status = 'local_contact_found')::bigint as local_contact_found_count,
  count(*) filter (where queue_row.queue_status = 'no_eligible_contact')::bigint as no_eligible_contact_count,
  count(*) filter (where queue_row.queue_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where queue_row.queue_status = 'technical_error')::bigint as error_count,
  coalesce(sum(queue_row.checked_candidate_count), 0)::bigint as checked_candidate_count,
  coalesce(sum(queue_row.eligible_email_count), 0)::bigint as eligible_email_count,
  0::bigint as brave_request_count,
  max(queue_row.updated_at) as latest_activity_at
from public.complete_power_outage_contact_discovery_state state_row
left join public.complete_power_outage_contact_local_discovery_v2_shadow queue_row on true
where state_row.singleton
group by state_row.local_discovery_v2_shadow_enabled;

revoke all on function public.complete_power_outage_contact_email_is_automatic_v1(text)
  from public, anon, authenticated;
revoke all on function public.capture_complete_power_outage_contact_local_discovery_v2_shadow()
  from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_contact_local_discovery_v2_shadow()
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_contact_local_discovery_v2_shadow(text,uuid,text,jsonb,jsonb,text,text)
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_contact_local_discovery_v2_shadow()
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_contact_email_is_automatic_v1(text) to service_role;
grant execute on function public.capture_complete_power_outage_contact_local_discovery_v2_shadow() to service_role;
grant execute on function public.claim_complete_power_outage_contact_local_discovery_v2_shadow() to service_role;
grant execute on function public.finish_complete_power_outage_contact_local_discovery_v2_shadow(text,uuid,text,jsonb,jsonb,text,text) to service_role;
grant execute on function public.request_complete_power_outage_contact_local_discovery_v2_shadow() to service_role;
revoke all on table public.complete_power_outage_contact_local_discovery_v2_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_local_discovery_v2_overview to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete_contact_local_discovery_v2_shadow_every_fifteen_seconds'
  loop perform cron.unschedule(existing_job.jobid); end loop;
  perform cron.schedule(
    'complete_contact_local_discovery_v2_shadow_every_fifteen_seconds',
    '15 seconds',
    $job$select public.request_complete_power_outage_contact_local_discovery_v2_shadow();$job$
  );
end
$$;

-- Bezpecny instalacni stav. Fronta se pouze pripravi, zadny HTTP worker nebezi.
update public.complete_power_outage_contact_discovery_state
set local_discovery_v2_shadow_enabled = false,
    metadata = metadata || jsonb_build_object(
      'localDiscoveryV2ShadowContract', 'complete-contact-local-discovery-v2-shadow',
      'localDiscoveryV2ShadowInstalledAt', now(),
      'localDiscoveryV2ShadowEnabled', false,
      'braveFallbackReleasedByStage2', false,
      'emailSendingChanged', false
    ),
    updated_at = now()
where singleton;

select public.capture_complete_power_outage_contact_local_discovery_v2_shadow()
  as local_discovery_v2_shadow_capture;

notify pgrst, 'reload schema';
commit;

with function_contract as (
  select
    pg_get_functiondef('public.claim_complete_power_outage_contact_local_discovery_v2_shadow()'::regprocedure) as claim_definition,
    pg_get_functiondef('public.finish_complete_power_outage_contact_local_discovery_v2_shadow(text,uuid,text,jsonb,jsonb,text,text)'::regprocedure) as finish_definition,
    pg_get_functiondef('public.request_complete_power_outage_contact_local_discovery_v2_shadow()'::regprocedure) as request_definition
), audit as (
  select 'TABLE'::text as check_type, 'isolated local discovery v2 SHADOW queue and contacts exist'::text as object_name,
    to_regclass('public.complete_power_outage_contact_local_discovery_v2_shadow') is not null
      and to_regclass('public.complete_power_outage_contact_local_discovery_v2_contacts') is not null as is_correct
  union all
  select 'FUNCTION', 'controlled local discovery v2 SHADOW claim and completion exist',
    to_regprocedure('public.claim_complete_power_outage_contact_local_discovery_v2_shadow()') is not null
      and to_regprocedure('public.finish_complete_power_outage_contact_local_discovery_v2_shadow(text,uuid,text,jsonb,jsonb,text,text)') is not null
  union all
  select 'GRANT', 'authenticated cannot inspect or run local discovery v2',
    not has_table_privilege('authenticated', 'public.complete_power_outage_contact_local_discovery_v2_shadow', 'SELECT,INSERT,UPDATE,DELETE')
      and not has_table_privilege('authenticated', 'public.complete_power_outage_contact_local_discovery_v2_contacts', 'SELECT,INSERT,UPDATE,DELETE')
      and not has_function_privilege('authenticated', 'public.claim_complete_power_outage_contact_local_discovery_v2_shadow()', 'EXECUTE')
  union all
  select 'LOGIC', 'ARES usable email can finish local pass without HTTP',
    exists (
      select 1 from pg_proc
      where oid = 'public.capture_complete_power_outage_contact_local_discovery_v2_shadow()'::regprocedure
        and pg_get_functiondef(oid) ilike '%has_usable_ares_email%'
    )
  union all
  select 'LOGIC', 'local worker has exactly one automatic attempt',
    not exists (select 1 from public.complete_power_outage_contact_local_discovery_v2_shadow where max_attempt_count <> 1)
  union all
  select 'LOGIC', 'usable local email is calculated by the approved address policy',
    not exists (
      select 1 from public.complete_power_outage_contact_local_discovery_v2_contacts contact
      where contact.notification_eligible <>
        (contact.contact_type = 'email' and public.complete_power_outage_contact_email_is_automatic_v1(contact.normalized_value))
    )
  union all
  select 'LOGIC', 'local worker checks at most five domains per company',
    not exists (select 1 from public.complete_power_outage_contact_local_discovery_v2_shadow where checked_candidate_count > 5)
  union all
  select 'LOGIC', 'local stage never records a Brave request',
    not exists (
      select 1 from public.complete_power_outage_contact_local_discovery_v2_shadow
      where coalesce((evidence ->> 'braveRequestCount')::integer, 0) <> 0
    )
  union all
  select 'ISOLATION', 'local endpoint is separate from audited Brave endpoint',
    request_definition ilike '%/contact-discovery/local-v2-shadow/process%'
      and request_definition not ilike '%websites-v2/process%'
      and request_definition not ilike '%brave%'
  from function_contract
  union all
  select 'SAFETY', 'stage two installation leaves local HTTP worker disabled',
    not local_discovery_v2_shadow_enabled
  from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'SAFETY', 'stage two does not release Brave fallback',
    not coalesce((metadata ->> 'braveFallbackReleasedByStage2')::boolean, true)
  from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'SAFETY', 'local completion cannot mutate production contacts or websites',
    finish_definition not ilike '%insert into public.complete_power_outage_company_contacts%'
      and finish_definition not ilike '%update public.complete_power_outage_company_contacts%'
      and finish_definition not ilike '%insert into public.complete_power_outage_company_websites%'
  from function_contract
  union all
  select 'SAFETY', 'stage two changes no email planning or dispatch switch',
    claim_definition not ilike '%email_planning_enabled =%'
      and claim_definition not ilike '%email_dispatch_enabled =%'
      and finish_definition not ilike '%email_planning_enabled =%'
      and finish_definition not ilike '%email_dispatch_enabled =%'
  from function_contract
  union all
  select 'CRON', 'local discovery v2 checks every fifteen seconds but remains gated',
    count(*) = 1 and bool_and(active) and min(schedule) = '15 seconds'
  from cron.job where jobname = 'complete_contact_local_discovery_v2_shadow_every_fifteen_seconds'
  union all
  select 'RLS', 'local discovery v2 SHADOW tables have RLS',
    bool_and(class_row.relrowsecurity)
  from pg_class class_row
  where class_row.oid in (
    'public.complete_power_outage_contact_local_discovery_v2_shadow'::regclass,
    'public.complete_power_outage_contact_local_discovery_v2_contacts'::regclass
  )
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
