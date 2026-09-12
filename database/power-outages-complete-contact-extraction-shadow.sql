begin;

-- Krok 6: izolovana SHADOW extrakce kontaktu pouze z v3 overenych domen.
-- Produkcni kontakty, UI, planovani a odesilani e-mailu zustavaji vypnute.
alter table public.complete_power_outage_contact_discovery_state
  add column if not exists contact_extraction_shadow_enabled boolean not null default false;

-- Append-only historie budouciho rucniho schvaleni nebo zamitnuti domeny.
-- V tomto kroku nema authenticated zadne opravneni a nevznika zadna UI funkce.
create table if not exists public.complete_power_outage_contact_domain_review_decisions (
  id uuid primary key default gen_random_uuid(),
  ico text not null,
  company_profile_id uuid not null,
  normalized_domain text not null,
  candidate_url text not null,
  decision text not null,
  reason text not null,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  source_result_version integer not null default 3,
  rules_version integer not null default 1,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_contact_domain_review_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_domain_review_url_check check (candidate_url ~* '^https?://'),
  constraint cpo_contact_domain_review_domain_check check (
    normalized_domain = lower(btrim(normalized_domain))
    and normalized_domain ~ '^[a-z0-9.-]+$'
  ),
  constraint cpo_contact_domain_review_decision_check check (
    decision in ('approved', 'rejected', 'revoked')
  ),
  constraint cpo_contact_domain_review_reason_check check (btrim(reason) <> ''),
  constraint cpo_contact_domain_review_source_version_check check (source_result_version > 0),
  constraint cpo_contact_domain_review_rules_check check (rules_version > 0),
  constraint cpo_contact_domain_review_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index if not exists cpo_contact_domain_review_latest_idx
  on public.complete_power_outage_contact_domain_review_decisions (
    ico, normalized_domain, created_at desc, id desc
  );

create or replace function public.prevent_complete_contact_domain_review_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie rozhodnuti o domene je nemenna; vlozte nove rozhodnuti.';
end;
$$;

drop trigger if exists cpo_contact_domain_review_decisions_immutable
  on public.complete_power_outage_contact_domain_review_decisions;
create trigger cpo_contact_domain_review_decisions_immutable
before update or delete on public.complete_power_outage_contact_domain_review_decisions
for each row execute function public.prevent_complete_contact_domain_review_decision_mutation();

alter table public.complete_power_outage_contact_domain_review_decisions enable row level security;
revoke all on table public.complete_power_outage_contact_domain_review_decisions
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_domain_review_decisions to service_role;
revoke all on function public.prevent_complete_contact_domain_review_decision_mutation()
  from public, anon, authenticated;

create table if not exists public.complete_power_outage_contact_extraction_shadow_queue (
  ico text primary key,
  company_profile_id uuid not null,
  website_url text not null,
  normalized_domain text not null,
  authorization_source text not null,
  manual_decision_id uuid
    references public.complete_power_outage_contact_domain_review_decisions(id) on delete restrict,
  queue_status text not null default 'pending',
  contact_count integer not null default 0,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 2,
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
  constraint cpo_contact_extraction_shadow_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_extraction_shadow_url_check check (website_url ~* '^https?://'),
  constraint cpo_contact_extraction_shadow_domain_check check (
    normalized_domain = lower(btrim(normalized_domain))
    and normalized_domain ~ '^[a-z0-9.-]+$'
  ),
  constraint cpo_contact_extraction_shadow_auth_check check (
    (authorization_source = 'automatic_v3' and manual_decision_id is null)
    or (authorization_source = 'manual_review' and manual_decision_id is not null)
  ),
  constraint cpo_contact_extraction_shadow_status_check check (
    queue_status in (
      'pending', 'processing', 'contacts_found', 'no_contact',
      'needs_review', 'error', 'cancelled'
    )
  ),
  constraint cpo_contact_extraction_shadow_count_check check (contact_count >= 0),
  constraint cpo_contact_extraction_shadow_attempt_check check (
    attempt_count >= 0 and attempt_count <= max_attempt_count
    and max_attempt_count between 1 and 4
  ),
  constraint cpo_contact_extraction_shadow_processing_check check (
    (queue_status = 'processing' and processing_token is not null and processing_expires_at is not null)
    or (queue_status <> 'processing' and processing_token is null and processing_expires_at is null)
  ),
  constraint cpo_contact_extraction_shadow_result_check check (
    (queue_status = 'contacts_found' and contact_count > 0 and finished_at is not null)
    or (queue_status in ('no_contact', 'needs_review', 'cancelled') and contact_count = 0 and finished_at is not null)
    or queue_status in ('pending', 'processing', 'error')
  ),
  constraint cpo_contact_extraction_shadow_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index if not exists cpo_contact_extraction_shadow_work_idx
  on public.complete_power_outage_contact_extraction_shadow_queue (
    queue_status, next_attempt_at, created_at, ico
  ) where queue_status in ('pending', 'error');

create table if not exists public.complete_power_outage_contact_extraction_shadow_results (
  id uuid primary key default gen_random_uuid(),
  ico text not null
    references public.complete_power_outage_contact_extraction_shadow_queue(ico) on delete cascade,
  company_profile_id uuid not null,
  normalized_domain text not null,
  contact_type text not null,
  contact_value text not null,
  normalized_value text not null,
  source_url text not null,
  contact_scope text not null,
  contact_role text not null,
  is_personal boolean not null,
  confidence numeric(5,4) not null,
  extraction_methods text[] not null default '{}'::text[],
  review_flags text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint cpo_contact_extraction_result_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_extraction_result_type_check check (contact_type in ('email', 'phone')),
  constraint cpo_contact_extraction_result_value_check check (
    btrim(contact_value) <> '' and btrim(normalized_value) <> ''
  ),
  constraint cpo_contact_extraction_result_normalized_check check (
    (contact_type = 'email' and normalized_value ~* '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$')
    or (contact_type = 'phone' and normalized_value ~ '^\+420[1-9][0-9]{8}$')
  ),
  constraint cpo_contact_extraction_result_url_check check (source_url ~* '^https?://'),
  constraint cpo_contact_extraction_result_scope_check check (contact_scope = 'company'),
  constraint cpo_contact_extraction_result_role_check check (
    contact_role in ('general', 'operations', 'customer_service', 'personal', 'unknown')
  ),
  constraint cpo_contact_extraction_result_confidence_check check (confidence between 0 and 1),
  constraint cpo_contact_extraction_result_evidence_check check (jsonb_typeof(evidence) = 'object'),
  constraint cpo_contact_extraction_result_unique
    unique (ico, contact_type, normalized_value)
);

drop trigger if exists cpo_contact_extraction_shadow_queue_set_updated_at
  on public.complete_power_outage_contact_extraction_shadow_queue;
create trigger cpo_contact_extraction_shadow_queue_set_updated_at
before update on public.complete_power_outage_contact_extraction_shadow_queue
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_extraction_shadow_queue enable row level security;
alter table public.complete_power_outage_contact_extraction_shadow_results enable row level security;
revoke all on table public.complete_power_outage_contact_extraction_shadow_queue
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_contact_extraction_shadow_results
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_extraction_shadow_queue to service_role;
grant all on table public.complete_power_outage_contact_extraction_shadow_results to service_role;

create or replace function public.capture_complete_power_outage_contact_extraction_shadow()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare inserted_count bigint;
declare target_count bigint;
begin
  with latest_manual_decision as (
    select distinct on (decision.ico, decision.normalized_domain)
      decision.id, decision.ico, decision.company_profile_id, decision.normalized_domain,
      decision.candidate_url, decision.decision
    from public.complete_power_outage_contact_domain_review_decisions decision
    order by decision.ico, decision.normalized_domain, decision.created_at desc, decision.id desc
  ), eligible as (
    select
      v3.ico, v3.company_profile_id, v3.candidate_url as website_url,
      v3.normalized_domain, 'automatic_v3'::text as authorization_source,
      null::uuid as manual_decision_id, 0 as preference
    from public.complete_power_outage_contact_discovery_website_v3_results v3
    where v3.result_status = 'verified_company'

    union all

    select
      v3.ico, v3.company_profile_id, decision.candidate_url,
      decision.normalized_domain, 'manual_review', decision.id, 1
    from public.complete_power_outage_contact_discovery_website_v3_results v3
    join latest_manual_decision decision
      on decision.ico = v3.ico
     and decision.company_profile_id = v3.company_profile_id
     and decision.normalized_domain = v3.normalized_domain
     and decision.decision = 'approved'
    where v3.result_status = 'needs_review'
  ), selected as (
    select distinct on (eligible.ico) eligible.*
    from eligible
    order by eligible.ico, eligible.preference
  )
  insert into public.complete_power_outage_contact_extraction_shadow_queue (
    ico, company_profile_id, website_url, normalized_domain,
    authorization_source, manual_decision_id, queue_status,
    next_attempt_at, evidence
  )
  select
    selected.ico, selected.company_profile_id, selected.website_url,
    selected.normalized_domain, selected.authorization_source,
    selected.manual_decision_id, 'pending', now(),
    jsonb_build_object(
      'contract', 'complete-contact-extraction-shadow-v1',
      'authorizationSource', selected.authorization_source,
      'manualDecisionId', selected.manual_decision_id,
      'productionContactsPersisted', false
    )
  from selected
  on conflict (ico) do nothing;

  get diagnostics inserted_count = row_count;
  select count(*) into target_count
  from public.complete_power_outage_contact_extraction_shadow_queue;
  return jsonb_build_object(
    'status', 'captured', 'insertedCount', inserted_count,
    'targetCount', target_count, 'capturedAt', now()
  );
end;
$$;

create or replace function public.claim_complete_power_outage_contact_extraction_shadow()
returns table (
  ico text,
  company_profile_id uuid,
  website_url text,
  normalized_domain text,
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
    select state_row.contact_extraction_shadow_enabled
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
  ), false) then return; end if;

  update public.complete_power_outage_contact_extraction_shadow_queue queue_row
  set queue_status = 'needs_review',
      contact_count = 0,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      finished_at = now(),
      last_error_code = null,
      last_error_message = null,
      evidence = queue_row.evidence || jsonb_build_object(
        'workerLeaseExpiredAt', now(),
        'automaticRetrySuppressed', true,
        'reasonCodes', jsonb_build_array('contact_extraction_lease_expired')
      )
  where queue_row.queue_status = 'processing'
    and queue_row.processing_expires_at <= now();

  if exists (
    select 1
    from public.complete_power_outage_contact_extraction_shadow_queue queue_row
    where queue_row.queue_status = 'processing'
      and queue_row.processing_expires_at > now()
  ) then return; end if;

  return query
  with selected as materialized (
    select queue_row.ico
    from public.complete_power_outage_contact_extraction_shadow_queue queue_row
    where queue_row.attempt_count < queue_row.max_attempt_count
      and queue_row.queue_status in ('pending', 'error')
      and coalesce(queue_row.next_attempt_at, now()) <= now()
    order by queue_row.next_attempt_at nulls first, queue_row.created_at, queue_row.ico
    for update skip locked
    limit 1
  ), claimed as (
    update public.complete_power_outage_contact_extraction_shadow_queue queue_row
    set queue_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '150 seconds',
        started_at = coalesce(queue_row.started_at, now()),
        finished_at = null,
        attempt_count = queue_row.attempt_count + 1,
        next_attempt_at = null,
        last_error_code = null,
        last_error_message = null
    from selected
    where queue_row.ico = selected.ico
    returning queue_row.*
  )
  select claimed.ico, claimed.company_profile_id, claimed.website_url,
    claimed.normalized_domain, claimed.processing_token, claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.finish_complete_power_outage_contact_extraction_shadow(
  requested_ico text,
  requested_processing_token uuid,
  requested_result text,
  requested_contacts jsonb default '[]'::jsonb,
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
  queue_row public.complete_power_outage_contact_extraction_shadow_queue%rowtype;
  inserted_count integer := 0;
  terminal_result boolean := true;
  next_attempt timestamptz;
begin
  if requested_result not in ('contacts_found', 'no_contact', 'needs_review', 'error') then
    raise exception 'Neplatny vysledek SHADOW extrakce kontaktu: %.', requested_result;
  end if;
  if jsonb_typeof(coalesce(requested_contacts, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(requested_contacts, '[]'::jsonb)) > 100 then
    raise exception 'Kontakty musi byt JSON pole s nejvyse 100 polozkami.';
  end if;
  if jsonb_typeof(coalesce(requested_evidence, '{}'::jsonb)) <> 'object' then
    raise exception 'Dukaz extrakce musi byt JSON objekt.';
  end if;

  select * into queue_row
  from public.complete_power_outage_contact_extraction_shadow_queue
  where complete_power_outage_contact_extraction_shadow_queue.ico = requested_ico
    and complete_power_outage_contact_extraction_shadow_queue.queue_status = 'processing'
    and complete_power_outage_contact_extraction_shadow_queue.processing_token = requested_processing_token
    and complete_power_outage_contact_extraction_shadow_queue.processing_expires_at > now()
  for update;
  if not found then return false; end if;

  if requested_result = 'error' and requested_retryable
     and queue_row.attempt_count < queue_row.max_attempt_count then
    terminal_result := false;
    next_attempt := now() + interval '2 minutes';
  end if;

  if requested_result <> 'error' then
    delete from public.complete_power_outage_contact_extraction_shadow_results
    where ico = requested_ico;

    insert into public.complete_power_outage_contact_extraction_shadow_results (
      ico, company_profile_id, normalized_domain, contact_type,
      contact_value, normalized_value, source_url, contact_scope,
      contact_role, is_personal, confidence, extraction_methods,
      review_flags, evidence, extracted_at
    )
    select
      queue_row.ico,
      queue_row.company_profile_id,
      queue_row.normalized_domain,
      contact.type,
      contact.value,
      contact."normalizedValue",
      contact."sourceUrl",
      contact.scope,
      contact.role,
      coalesce(contact."isPersonal", false),
      coalesce(contact.confidence, 0),
      coalesce(contact."extractionMethods", '{}'::text[]),
      coalesce(contact."reviewFlags", '{}'::text[]),
      jsonb_build_object(
        'contract', 'complete-contact-extraction-shadow-v1',
        'authorizationSource', queue_row.authorization_source,
        'manualDecisionId', queue_row.manual_decision_id,
        'productionContact', false
      ),
      now()
    from jsonb_to_recordset(coalesce(requested_contacts, '[]'::jsonb)) as contact(
      type text,
      value text,
      "normalizedValue" text,
      "sourceUrl" text,
      scope text,
      role text,
      "isPersonal" boolean,
      confidence numeric,
      "extractionMethods" text[],
      "reviewFlags" text[]
    )
    on conflict (ico, contact_type, normalized_value) do update
    set contact_value = excluded.contact_value,
        source_url = excluded.source_url,
        contact_scope = excluded.contact_scope,
        contact_role = excluded.contact_role,
        is_personal = excluded.is_personal,
        confidence = greatest(
          public.complete_power_outage_contact_extraction_shadow_results.confidence,
          excluded.confidence
        ),
        extraction_methods = excluded.extraction_methods,
        review_flags = excluded.review_flags,
        evidence = excluded.evidence,
        extracted_at = excluded.extracted_at;
    get diagnostics inserted_count = row_count;
  end if;

  if requested_result = 'contacts_found' and inserted_count = 0 then
    raise exception 'Vysledek contacts_found neobsahuje zadny platny kontakt.';
  end if;
  if requested_result in ('no_contact', 'needs_review') and inserted_count <> 0 then
    raise exception 'Vysledek bez kontaktu nesmi obsahovat kontaktni polozky.';
  end if;

  update public.complete_power_outage_contact_extraction_shadow_queue
  set queue_status = requested_result,
      contact_count = case when requested_result = 'contacts_found' then inserted_count else 0 end,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = next_attempt,
      finished_at = case when terminal_result then now() else null end,
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then requested_error_message else null end,
      evidence = coalesce(requested_evidence, '{}'::jsonb)
        || jsonb_build_object('productionContactsPersisted', false)
  where ico = requested_ico;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      last_error_code = case when requested_result = 'error' then requested_error_code else null end,
      last_error_message = case when requested_result = 'error' then requested_error_message else null end,
      metadata = metadata || jsonb_build_object(
        'contactExtractionShadowLastIco', requested_ico,
        'contactExtractionShadowLastResult', requested_result,
        'contactExtractionShadowLastActivityAt', now()
      )
  where singleton;
  return true;
end;
$$;

create or replace function public.request_complete_power_outage_contact_extraction_shadow()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare app_url text; automation_token text; request_id bigint;
begin
  if not coalesce((
    select contact_extraction_shadow_enabled
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
    url := app_url || '/api/power-outages/complete/contact-discovery/contacts-shadow/process',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Contact-Extraction-Shadow/1.0'
    ),
    timeout_milliseconds := 180000
  ) into request_id;
  return request_id;
end;
$$;

create or replace view public.complete_power_outage_contact_extraction_shadow_overview
with (security_invoker = true)
as
select
  state_row.contact_extraction_shadow_enabled,
  count(queue_row.ico)::bigint as target_count,
  count(*) filter (where queue_row.queue_status = 'pending')::bigint as pending_count,
  count(*) filter (where queue_row.queue_status = 'processing')::bigint as processing_count,
  count(*) filter (where queue_row.queue_status = 'contacts_found')::bigint as contacts_found_count,
  count(*) filter (where queue_row.queue_status = 'no_contact')::bigint as no_contact_count,
  count(*) filter (where queue_row.queue_status = 'needs_review')::bigint as needs_review_count,
  count(*) filter (where queue_row.queue_status = 'error')::bigint as error_count,
  coalesce(sum(queue_row.contact_count), 0)::bigint as extracted_contact_count,
  max(queue_row.updated_at) as latest_activity_at
from public.complete_power_outage_contact_discovery_state state_row
left join public.complete_power_outage_contact_extraction_shadow_queue queue_row on true
where state_row.singleton
group by state_row.contact_extraction_shadow_enabled;

revoke all on function public.capture_complete_power_outage_contact_extraction_shadow()
  from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_contact_extraction_shadow()
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_contact_extraction_shadow(text,uuid,text,jsonb,jsonb,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_contact_extraction_shadow()
  from public, anon, authenticated;
grant execute on function public.capture_complete_power_outage_contact_extraction_shadow() to service_role;
grant execute on function public.claim_complete_power_outage_contact_extraction_shadow() to service_role;
grant execute on function public.finish_complete_power_outage_contact_extraction_shadow(text,uuid,text,jsonb,jsonb,text,text,boolean)
  to service_role;
grant execute on function public.request_complete_power_outage_contact_extraction_shadow() to service_role;
revoke all on table public.complete_power_outage_contact_extraction_shadow_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_extraction_shadow_overview to service_role;

select public.capture_complete_power_outage_contact_extraction_shadow();

update public.complete_power_outage_contact_discovery_state
set discovery_enabled = true,
    website_lookup_enabled = false,
    website_verification_v2_enabled = false,
    website_verification_v3_enabled = true,
    contact_extraction_shadow_enabled = true,
    contact_extraction_enabled = false,
    ui_enabled = false,
    email_planning_enabled = false,
    email_dispatch_enabled = false,
    last_activity_at = now(),
    last_error_code = null,
    last_error_message = null,
    metadata = metadata || jsonb_build_object(
      'contactExtractionShadowContract', 'complete-contact-extraction-shadow-v1',
      'contactExtractionShadowActivatedAt', now(),
      'contactExtractionShadowSelector', 'verified-v3-or-manually-approved',
      'productionContactsPersisted', false,
      'productionContactCountAtShadowActivation', (
        select count(*) from public.complete_power_outage_company_contacts
      ),
      'emailSending', false
    )
where singleton;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete_contact_extraction_shadow_every_fifteen_seconds'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'complete_contact_extraction_shadow_every_fifteen_seconds',
    '15 seconds',
    $job$select public.request_complete_power_outage_contact_extraction_shadow();$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;
