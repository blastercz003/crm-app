begin;

-- Etapa 3: produkcni orchestrace local-first -> Brave fallback.
-- Odesilani e-mailu se nemeni. Brave se uvolni pouze po terminalnim lokalnim
-- vysledku bez pouzitelneho e-mailu a stejna firma se placene nevyhleda znovu.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_local_discovery_v2_shadow') is null
    or to_regclass('public.complete_power_outage_contact_local_discovery_v2_contacts') is null
    or to_regclass('public.complete_power_outage_contact_pipeline_v2_shadow') is null then
    raise exception 'Chybi zavislosti pro etapu 3 local-first kontaktu.';
  end if;
end
$$;

-- Lokalne overena domena ma stejny izolovany SHADOW charakter jako automatic_v3.
alter table public.complete_power_outage_contact_extraction_shadow_queue
  drop constraint if exists cpo_contact_extraction_shadow_auth_check;
alter table public.complete_power_outage_contact_extraction_shadow_queue
  add constraint cpo_contact_extraction_shadow_auth_check check (
    (authorization_source in ('automatic_v3', 'automatic_local_v2') and manual_decision_id is null)
    or (authorization_source = 'manual_review' and manual_decision_id is not null)
  );

create or replace function public.promote_complete_power_outage_local_contacts_v2_shadow()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare queue_count integer := 0; contact_count integer := 0;
begin
  insert into public.complete_power_outage_contact_extraction_shadow_queue (
    ico, company_profile_id, website_url, normalized_domain,
    authorization_source, manual_decision_id, queue_status, contact_count,
    attempt_count, max_attempt_count, finished_at, evidence
  )
  select
    local_row.ico,
    local_row.company_profile_id,
    min(contact.source_url),
    min(contact.normalized_domain),
    'automatic_local_v2',
    null,
    'contacts_found',
    count(*)::integer,
    0,
    2,
    now(),
    jsonb_build_object(
      'contract', 'complete-contact-local-first-stage3',
      'authorizationSource', 'automatic_local_v2',
      'localOnly', true,
      'braveRequestCount', 0,
      'productionContactsPersisted', false
    )
  from public.complete_power_outage_contact_local_discovery_v2_shadow local_row
  join public.complete_power_outage_contact_local_discovery_v2_contacts contact
    on contact.ico = local_row.ico
  where local_row.queue_status = 'local_contact_found'
    and local_row.eligible_email_count > 0
  group by local_row.ico, local_row.company_profile_id
  on conflict (ico) do nothing;
  get diagnostics queue_count = row_count;

  insert into public.complete_power_outage_contact_extraction_shadow_results (
    ico, company_profile_id, normalized_domain, contact_type,
    contact_value, normalized_value, source_url, contact_scope,
    contact_role, is_personal, confidence, extraction_methods,
    review_flags, evidence, extracted_at
  )
  select
    contact.ico,
    contact.company_profile_id,
    contact.normalized_domain,
    contact.contact_type,
    contact.normalized_value,
    contact.normalized_value,
    contact.source_url,
    'company',
    contact.contact_role,
    contact.is_personal,
    contact.confidence,
    contact.extraction_methods,
    contact.review_flags,
    jsonb_build_object(
      'contract', 'complete-contact-local-first-stage3',
      'authorizationSource', 'automatic_local_v2',
      'productionContact', false,
      'braveRequestCount', 0
    ),
    now()
  from public.complete_power_outage_contact_local_discovery_v2_contacts contact
  join public.complete_power_outage_contact_extraction_shadow_queue extraction
    on extraction.ico = contact.ico
   and extraction.company_profile_id = contact.company_profile_id
   and extraction.authorization_source = 'automatic_local_v2'
  on conflict (ico, contact_type, normalized_value) do update
  set source_url = excluded.source_url,
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
  get diagnostics contact_count = row_count;

  return jsonb_build_object(
    'status', 'succeeded',
    'queueInsertedCount', queue_count,
    'contactUpsertedCount', contact_count,
    'productionContactCount', 0,
    'braveRequestCount', 0
  );
end;
$$;

-- Efektivni pohled prijme lokalne overene weby a bezpecne funkcni ARES adresy.
-- Osobni ARES adresy se automaticky nepovoluji.
create or replace view public.complete_power_outage_contact_classification_effective_v1
with (security_invoker = true)
as
with latest_contact_decision as (
  select distinct on (decision.shadow_contact_id)
    decision.shadow_contact_id, decision.decision, decision.created_at
  from public.complete_power_outage_contact_review_decisions decision
  order by decision.shadow_contact_id, decision.created_at desc, decision.id desc
), latest_domain_decision as (
  select distinct on (decision.ico, decision.normalized_domain)
    decision.ico, decision.normalized_domain, decision.decision
  from public.complete_power_outage_contact_domain_review_decisions decision
  order by decision.ico, decision.normalized_domain, decision.created_at desc, decision.id desc
), resolved_web as (
  select
    classification.shadow_contact_id,
    classification.ico,
    classification.company_profile_id,
    classification.normalized_domain,
    classification.contact_type,
    classification.normalized_value,
    classification.contact_class,
    classification.classification_status as base_classification_status,
    case latest_contact_decision.decision
      when 'approved' then 'manual_approved'
      when 'rejected' then 'manual_rejected'
      else classification.classification_status
    end as effective_classification_status,
    case latest_contact_decision.decision
      when 'approved' then true
      when 'rejected' then false
      else classification.notification_eligible
    end as notification_eligible,
    classification.priority,
    classification.transport_security,
    classification.reason_codes,
    extracted.source_url,
    latest_contact_decision.decision as latest_review_decision,
    latest_contact_decision.created_at as latest_review_decided_at
  from public.complete_power_outage_contact_classification_v2_shadow classification
  join public.complete_power_outage_contact_extraction_shadow_results extracted
    on extracted.id = classification.shadow_contact_id
   and extracted.ico = classification.ico
   and extracted.company_profile_id = classification.company_profile_id
  join public.complete_power_outage_contact_extraction_shadow_queue extraction_queue
    on extraction_queue.ico = classification.ico
   and extraction_queue.company_profile_id = classification.company_profile_id
  left join latest_domain_decision
    on latest_domain_decision.ico = classification.ico
   and latest_domain_decision.normalized_domain = classification.normalized_domain
  left join latest_contact_decision
    on latest_contact_decision.shadow_contact_id = classification.shadow_contact_id
  where extraction_queue.authorization_source in ('automatic_v3', 'automatic_local_v2')
     or (
       extraction_queue.authorization_source = 'manual_review'
       and latest_domain_decision.decision = 'approved'
     )
), resolved_ares as (
  select
    contact.id as shadow_contact_id,
    profile.ico,
    profile.id as company_profile_id,
    lower(split_part(contact.normalized_value, '@', 2)) as normalized_domain,
    'email'::text as contact_type,
    contact.normalized_value,
    case
      when lower(split_part(contact.normalized_value, '@', 1))
        ~ '^(servis|service|servisni|provoz|vyroba|technik|technicke|udrzba|maintenance|dispecink|dispatch|doprava|logistika|sklad|mistr|vedouci|zkusebna|lakovna|technologie|nahradni)([._-]|$)'
        then 'operations'
      when lower(split_part(contact.normalized_value, '@', 1))
        ~ '^(obchod|obchodni|sales|poptav[a-z]*|rfq|nabid[a-z]*|export)([._-]|$)'
        or lower(split_part(contact.normalized_value, '@', 1)) ~ '^priprava[._-]?nabid'
        then 'commercial'
      else 'general'
    end as contact_class,
    'automatic'::text as base_classification_status,
    'automatic'::text as effective_classification_status,
    true as notification_eligible,
    case
      when lower(split_part(contact.normalized_value, '@', 1))
        ~ '^(servis|service|servisni|provoz|vyroba|technik|technicke|udrzba|maintenance|dispecink|dispatch|doprava|logistika|sklad|mistr|vedouci|zkusebna|lakovna|technologie|nahradni)([._-]|$)'
        then 10
      when lower(split_part(contact.normalized_value, '@', 1))
        ~ '^(obchod|obchodni|sales|poptav[a-z]*|rfq|nabid[a-z]*|export)([._-]|$)'
        then 30
      else 20
    end as priority,
    case when contact.source_url ~* '^https://' then 'https' else 'http' end as transport_security,
    array['public_ares_contact', 'automatic_functional_address']::text[] as reason_codes,
    contact.source_url,
    null::text as latest_review_decision,
    null::timestamptz as latest_review_decided_at
  from public.complete_power_outage_company_contacts contact
  join public.complete_power_outage_company_profiles profile
    on profile.id = contact.company_profile_id
  where contact.contact_type = 'email'
    and contact.is_public_at_source
    and contact.source_validity_status <> 'invalid'
    and contact.outreach_permission_status <> 'blocked'
    and public.complete_power_outage_contact_email_is_automatic_v1(contact.normalized_value)
), resolved as (
  select * from resolved_web
  union all
  select * from resolved_ares
), deduplicated as (
  select distinct on (resolved.ico, resolved.contact_type, resolved.normalized_value)
    resolved.*
  from resolved
  order by resolved.ico, resolved.contact_type, resolved.normalized_value,
    resolved.notification_eligible desc,
    case when 'public_ares_contact' = any(resolved.reason_codes) then 1 else 0 end,
    resolved.priority
), ranked as (
  select
    deduplicated.*,
    row_number() over (
      partition by deduplicated.ico, deduplicated.contact_type
      order by deduplicated.notification_eligible desc,
        deduplicated.priority, deduplicated.normalized_value
    ) as effective_rank
  from deduplicated
)
select
  ranked.shadow_contact_id,
  ranked.ico,
  ranked.company_profile_id,
  ranked.normalized_domain,
  ranked.contact_type,
  ranked.normalized_value,
  ranked.contact_class,
  ranked.base_classification_status,
  ranked.effective_classification_status,
  ranked.notification_eligible,
  case
    when ranked.contact_type = 'email'
      then ranked.notification_eligible and ranked.effective_rank = 1
    else ranked.effective_rank = 1
  end as is_primary,
  ranked.priority,
  ranked.transport_security,
  ranked.reason_codes,
  ranked.source_url,
  ranked.latest_review_decision,
  ranked.latest_review_decided_at
from ranked;

alter view public.complete_power_outage_contact_classification_effective_v1
  set (security_invoker = true);
revoke all on table public.complete_power_outage_contact_classification_effective_v1
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_classification_effective_v1 to service_role;

-- V2 claim smi vzit pouze firmu explicitne uvolnenou local-first automatem.
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
  if not coalesce((select website_verification_v2_enabled
    from public.complete_power_outage_contact_discovery_state where singleton), false)
  then return; end if;

  update public.complete_power_outage_contact_discovery_website_v2_results result_row
  set result_status = 'needs_review',
      reason_codes = case when 'worker_lease_expired_terminal' = any(result_row.reason_codes)
        then result_row.reason_codes else array_append(result_row.reason_codes, 'worker_lease_expired_terminal') end,
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      finished_at = now(),
      last_error_code = null,
      last_error_message = null,
      evidence = result_row.evidence || jsonb_build_object(
        'workerLeaseExpiredAt', now(), 'automaticRetrySuppressed', true
      )
  where result_row.result_status = 'processing'
    and result_row.processing_expires_at <= now();

  if exists (
    select 1 from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.result_status = 'processing'
      and result_row.processing_expires_at > now()
  ) then return; end if;

  return query
  with selected as materialized (
    select result_row.ico
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    join public.complete_power_outage_contact_local_discovery_v2_shadow local_row
      on local_row.ico = result_row.ico
     and local_row.queue_status = 'no_eligible_contact'
     and local_row.eligible_email_count = 0
    where result_row.attempt_count < result_row.max_attempt_count
      and result_row.result_status in ('pending', 'error')
      and coalesce(result_row.next_attempt_at, now()) <= now()
      and result_row.evidence ->> 'localFirstRelease' = 'true'
    order by result_row.next_attempt_at nulls first, result_row.created_at, result_row.ico
    for update of result_row skip locked
    limit 1
  ), claimed as (
    update public.complete_power_outage_contact_discovery_website_v2_results result_row
    set result_status = 'processing',
        processing_token = gen_random_uuid(),
        processing_expires_at = now() + interval '4 minutes',
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
    claimed.processing_token, claimed.attempt_count, null::text
  from claimed
  join public.complete_power_outage_company_profiles profile
    on profile.id = claimed.company_profile_id and profile.ico = claimed.ico;
end;
$$;

create or replace function public.reconcile_complete_power_outage_contact_local_first_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  state_row public.complete_power_outage_contact_discovery_state%rowtype;
  capture_result jsonb := '{}'::jsonb;
  local_capture_result jsonb := '{}'::jsonb;
  promotion_result jsonb := '{}'::jsonb;
  classification_result jsonb := '{}'::jsonb;
  released_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('complete-contact-local-first-v2-reconcile'));
  select * into state_row
  from public.complete_power_outage_contact_discovery_state where singleton for update;
  if not state_row.runtime_enabled then
    return jsonb_build_object('status', 'disabled', 'braveReleasedCount', 0);
  end if;

  -- Funkce zachyceni vyzaduje pozastavene technicke prepinace. Zmena je uvnitr
  -- jedne transakce, takze ji ostatni workery nikdy neuvidi.
  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = false,
      website_lookup_enabled = false,
      website_verification_v2_enabled = false,
      contact_extraction_enabled = false
  where singleton;

  capture_result := public.capture_complete_power_outage_contact_discovery_batch(
    state_row.selected_selector_key
  );

  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = true,
      website_lookup_enabled = false,
      website_verification_v2_enabled = state_row.brave_fallback_enabled,
      website_verification_v3_enabled = true,
      local_discovery_v2_shadow_enabled = true,
      contact_extraction_shadow_enabled = true,
      contact_extraction_enabled = false
  where singleton;

  local_capture_result := public.capture_complete_power_outage_contact_local_discovery_v2_shadow();
  promotion_result := public.promote_complete_power_outage_local_contacts_v2_shadow();
  classification_result := public.refresh_complete_power_outage_contact_classification_v2_shadow();

  if state_row.brave_fallback_enabled then
    insert into public.complete_power_outage_contact_discovery_website_v2_results (
      ico, company_profile_id, result_status, attempt_count, max_attempt_count,
      next_attempt_at, evidence
    )
    select
      local_row.ico,
      local_row.company_profile_id,
      'pending',
      0,
      2,
      now(),
      jsonb_build_object(
        'contract', 'complete-contact-local-first-stage3',
        'sourceBatchId', local_row.origin_batch_id,
        'localFirstRelease', true,
        'localResult', local_row.queue_status,
        'localEligibleEmailCount', local_row.eligible_email_count,
        'braveSearchPreviouslyPerformed', false,
        'releasedAt', now()
      )
    from public.complete_power_outage_contact_local_discovery_v2_shadow local_row
    where local_row.queue_status = 'no_eligible_contact'
      and local_row.eligible_email_count = 0
    on conflict (ico) do update
    set result_status = 'pending',
        website_kind = null,
        candidate_url = null,
        normalized_domain = null,
        confidence = 0,
        verification_methods = '{}'::text[],
        reason_codes = '{}'::text[],
        attempt_count = 0,
        max_attempt_count = 2,
        next_attempt_at = now(),
        processing_token = null,
        processing_expires_at = null,
        started_at = null,
        finished_at = null,
        last_error_code = null,
        last_error_message = null,
        evidence = excluded.evidence
    where coalesce(public.complete_power_outage_contact_discovery_website_v2_results.evidence ->> 'localFirstRelease', 'false') <> 'true'
      and coalesce(public.complete_power_outage_contact_discovery_website_v2_results.evidence -> 'search', 'null'::jsonb) = 'null'::jsonb;
    get diagnostics released_count = row_count;
  end if;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      metadata = metadata || jsonb_build_object(
        'localFirstRuntimeContract', 'complete-contact-local-first-stage3',
        'localFirstLastReconciledAt', now(),
        'localFirstLastCapture', capture_result,
        'localFirstLastLocalCapture', local_capture_result,
        'localFirstLastPromotion', promotion_result,
        'localFirstLastClassification', classification_result,
        'localFirstLastBraveReleasedCount', released_count,
        'emailSendingChanged', false
      ),
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'capture', capture_result,
    'localCapture', local_capture_result,
    'promotion', promotion_result,
    'classification', classification_result,
    'braveReleasedCount', released_count,
    'emailSendingChanged', false
  );
end;
$$;

create or replace function public.set_complete_power_outage_contact_runtime_v1(
  requested_enabled boolean,
  requested_brave_fallback_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Dohledavani kontaktu muze menit pouze administrator.'; end if;
  if requested_brave_fallback_enabled and not requested_enabled then
    raise exception 'Brave fallback nelze zapnout pri pozastavenem dohledavani.';
  end if;

  perform pg_advisory_xact_lock(hashtext('complete-contact-discovery-runtime-v1'));

  if requested_enabled then
    update public.complete_power_outage_contact_discovery_state
    set discovery_enabled = false,
        website_lookup_enabled = false,
        website_verification_v2_enabled = false,
        local_discovery_v2_shadow_enabled = false,
        contact_extraction_enabled = false
    where singleton;
    perform public.capture_complete_power_outage_contact_discovery_batch(
      (select selected_selector_key from public.complete_power_outage_contact_discovery_state where singleton)
    );
  end if;

  update public.complete_power_outage_contact_discovery_state
  set runtime_enabled = requested_enabled,
      brave_fallback_enabled = requested_enabled and requested_brave_fallback_enabled,
      discovery_enabled = true,
      website_lookup_enabled = false,
      local_discovery_v2_shadow_enabled = requested_enabled,
      website_verification_v2_enabled = requested_enabled and requested_brave_fallback_enabled,
      website_verification_v3_enabled = true,
      contact_extraction_shadow_enabled = requested_enabled,
      contact_extraction_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'runtimeContract', 'complete-contact-local-first-stage3',
        'runtimeChangedAt', now(),
        'runtimeChangedBy', auth.uid(),
        'runtimeEnabled', requested_enabled,
        'braveFallbackEnabled', requested_enabled and requested_brave_fallback_enabled,
        'localDiscoveryEnabled', requested_enabled,
        'emailSendingChanged', false
      ),
      updated_at = now()
  where singleton;

  if requested_enabled then
    perform public.reconcile_complete_power_outage_contact_local_first_v2();
  end if;
  result := public.get_complete_power_outage_contact_runtime_v1();
  return result;
end;
$$;

create or replace function public.get_complete_power_outage_contact_runtime_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare result jsonb; selected_batch_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Rizeni dohledavani kontaktu je dostupne pouze administratorum.'; end if;

  select batch.id into selected_batch_id
  from public.complete_power_outage_contact_discovery_state state_row
  left join lateral (
    select candidate.id
    from public.complete_power_outage_contact_discovery_batches candidate
    where candidate.selector_key = state_row.selected_selector_key
    order by candidate.created_at desc limit 1
  ) batch on true
  where state_row.singleton;

  select public.get_complete_power_outage_contact_runtime_v1() || jsonb_build_object(
    'localDiscoveryEnabled', state_row.local_discovery_v2_shadow_enabled,
    'localPendingCount', (select count(*) from public.complete_power_outage_contact_local_discovery_v2_shadow q where q.origin_batch_id = selected_batch_id and q.queue_status = 'pending'),
    'localProcessingCount', (select count(*) from public.complete_power_outage_contact_local_discovery_v2_shadow q where q.origin_batch_id = selected_batch_id and q.queue_status = 'processing'),
    'localContactFoundCount', (select count(*) from public.complete_power_outage_contact_local_discovery_v2_shadow q where q.origin_batch_id = selected_batch_id and q.queue_status = 'local_contact_found'),
    'localNoEligibleCount', (select count(*) from public.complete_power_outage_contact_local_discovery_v2_shadow q where q.origin_batch_id = selected_batch_id and q.queue_status = 'no_eligible_contact'),
    'bravePendingCount', (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results w join public.complete_power_outage_contact_discovery_batch_items i on i.batch_id = selected_batch_id and i.ico = w.ico where w.evidence ->> 'localFirstRelease' = 'true' and w.result_status = 'pending'),
    'braveProcessingCount', (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results w join public.complete_power_outage_contact_discovery_batch_items i on i.batch_id = selected_batch_id and i.ico = w.ico where w.evidence ->> 'localFirstRelease' = 'true' and w.result_status = 'processing'),
    'braveFinishedCount', (select count(*) from public.complete_power_outage_contact_discovery_website_v2_results w join public.complete_power_outage_contact_discovery_batch_items i on i.batch_id = selected_batch_id and i.ico = w.ico where w.evidence ->> 'localFirstRelease' = 'true' and w.result_status in ('verified_company', 'verified_group', 'needs_review', 'no_website')),
    'braveQueryCount', (select coalesce(sum(case when coalesce(w.evidence #>> '{search,queryCount}', '') ~ '^[0-9]+$' then (w.evidence #>> '{search,queryCount}')::integer else 0 end), 0) from public.complete_power_outage_contact_discovery_website_v2_results w join public.complete_power_outage_contact_discovery_batch_items i on i.batch_id = selected_batch_id and i.ico = w.ico),
    'localFirstContract', 'complete-contact-local-first-stage3'
  ) into result
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton;
  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.get_complete_power_outage_contact_management_summary_v3()
returns jsonb
language sql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
  select public.get_complete_power_outage_contact_management_summary_v2()
    || public.get_complete_power_outage_contact_runtime_v2();
$$;

revoke all on function public.promote_complete_power_outage_local_contacts_v2_shadow() from public, anon, authenticated;
revoke all on function public.reconcile_complete_power_outage_contact_local_first_v2() from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_contact_discovery_website_v2() from public, anon, authenticated;
revoke all on function public.get_complete_power_outage_contact_runtime_v2() from public, anon;
revoke all on function public.get_complete_power_outage_contact_management_summary_v3() from public, anon;
grant execute on function public.promote_complete_power_outage_local_contacts_v2_shadow() to service_role;
grant execute on function public.reconcile_complete_power_outage_contact_local_first_v2() to service_role;
grant execute on function public.claim_complete_power_outage_contact_discovery_website_v2() to service_role;
grant execute on function public.get_complete_power_outage_contact_runtime_v2() to authenticated, service_role;
grant execute on function public.get_complete_power_outage_contact_management_summary_v3() to authenticated, service_role;

do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job
    where jobname = 'complete_contact_local_first_v2_reconcile_every_minute'
  loop perform cron.unschedule(existing_job.jobid); end loop;
  perform cron.schedule(
    'complete_contact_local_first_v2_reconcile_every_minute',
    '* * * * *',
    $job$select public.reconcile_complete_power_outage_contact_local_first_v2();$job$
  );
end
$$;

-- Nasazeni pouze instaluje finalni kontrakt. Stav zustane pozastaveny a admin
-- jej zapne v popupu az po kontrole auditu.
update public.complete_power_outage_contact_discovery_state
set runtime_enabled = false,
    brave_fallback_enabled = false,
    local_discovery_v2_shadow_enabled = false,
    website_verification_v2_enabled = false,
    contact_extraction_shadow_enabled = false,
    metadata = metadata || jsonb_build_object(
      'localFirstRuntimeContract', 'complete-contact-local-first-stage3',
      'localFirstStage3InstalledAt', now(),
      'localFirstStage3Enabled', false,
      'emailSendingChanged', false
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

with function_contract as (
  select
    pg_get_functiondef('public.reconcile_complete_power_outage_contact_local_first_v2()'::regprocedure) as reconcile_definition,
    pg_get_functiondef('public.claim_complete_power_outage_contact_discovery_website_v2()'::regprocedure) as claim_definition,
    pg_get_functiondef('public.set_complete_power_outage_contact_runtime_v1(boolean,boolean)'::regprocedure) as runtime_definition
), audit as (
  select 'FUNCTION'::text as check_type, 'final local-first reconciler exists'::text as object_name,
    to_regprocedure('public.reconcile_complete_power_outage_contact_local_first_v2()') is not null as is_correct
  union all
  select 'FUNCTION', 'admin runtime controls local and Brave phases together',
    runtime_definition ilike '%local_discovery_v2_shadow_enabled = requested_enabled%'
      and runtime_definition ilike '%website_verification_v2_enabled = requested_enabled and requested_brave_fallback_enabled%'
  from function_contract
  union all
  select 'DATA', 'Brave queue contains only local no-email releases',
    not exists (
      select 1 from public.complete_power_outage_contact_discovery_website_v2_results website
      where website.evidence ->> 'localFirstRelease' = 'true'
        and not exists (
          select 1 from public.complete_power_outage_contact_local_discovery_v2_shadow local_row
          where local_row.ico = website.ico
            and local_row.queue_status = 'no_eligible_contact'
            and local_row.eligible_email_count = 0
        )
    )
  union all
  select 'DATA', 'usable local email never enters Brave fallback',
    not exists (
      select 1
      from public.complete_power_outage_contact_local_discovery_v2_shadow local_row
      join public.complete_power_outage_contact_discovery_website_v2_results website on website.ico = local_row.ico
      where local_row.eligible_email_count > 0
        and website.evidence ->> 'localFirstRelease' = 'true'
    )
  union all
  select 'LOGIC', 'Brave claim requires explicit local no-email evidence',
    claim_definition ilike '%local_row.queue_status = ''no_eligible_contact''%'
      and claim_definition ilike '%local_row.eligible_email_count = 0%'
      and claim_definition ilike '%localFirstRelease%'
  from function_contract
  union all
  select 'LOGIC', 'Brave search is never automatically repeated after recorded search',
    reconcile_definition ilike '%evidence -> ''search''%'
      and reconcile_definition ilike '%braveSearchPreviouslyPerformed%'
  from function_contract
  union all
  select 'LOGIC', 'new selector firms are reconciled automatically',
    reconcile_definition ilike '%capture_complete_power_outage_contact_discovery_batch%'
      and reconcile_definition ilike '%capture_complete_power_outage_contact_local_discovery_v2_shadow%'
  from function_contract
  union all
  select 'LOGIC', 'local verified contacts enter effective SHADOW classification',
    pg_get_viewdef('public.complete_power_outage_contact_classification_effective_v1'::regclass, true)
      ilike '%automatic_local_v2%'
  union all
  select 'LOGIC', 'public functional ARES contacts enter effective classification',
    pg_get_viewdef('public.complete_power_outage_contact_classification_effective_v1'::regclass, true)
      ilike '%complete_power_outage_contact_email_is_automatic_v1%'
  union all
  select 'GRANT', 'authenticated cannot run pipeline or Brave workers',
    not has_function_privilege('authenticated', 'public.reconcile_complete_power_outage_contact_local_first_v2()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.claim_complete_power_outage_contact_discovery_website_v2()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.request_complete_power_outage_contact_local_discovery_v2_shadow()', 'EXECUTE')
  union all
  select 'ISOLATION', 'final contact pipeline stays in COMPLETE scope',
    reconcile_definition not ilike '%market_power_outage%'
  from function_contract
  union all
  select 'CRON', 'final reconciler runs every minute but remains runtime gated',
    count(*) = 1 and bool_and(active) and min(schedule) = '* * * * *'
  from cron.job where jobname = 'complete_contact_local_first_v2_reconcile_every_minute'
  union all
  select 'SAFETY', 'stage three installation remains paused',
    not runtime_enabled and not brave_fallback_enabled
      and not local_discovery_v2_shadow_enabled and not website_verification_v2_enabled
  from public.complete_power_outage_contact_discovery_state where singleton
  union all
  select 'SAFETY', 'contact runtime never changes email planning or dispatch',
    runtime_definition not ilike '%email_planning_enabled =%'
      and runtime_definition not ilike '%email_dispatch_enabled =%'
      and reconcile_definition not ilike '%email_planning_enabled =%'
      and reconcile_definition not ilike '%email_dispatch_enabled =%'
  from function_contract
  union all
  select 'SAFETY', 'Brave keeps audited retry and runtime budget',
    metadata ->> 'websiteVerificationV2TimeBudgetContract' = 'v1'
      and coalesce((metadata ->> 'websiteVerificationV2MaximumAttempts')::integer, 0) = 2
  from public.complete_power_outage_contact_discovery_state where singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
