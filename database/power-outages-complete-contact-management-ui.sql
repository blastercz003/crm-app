begin;

create or replace view public.complete_power_outage_contact_classification_effective_v1
with (security_invoker = true)
as
with latest_contact_decision as (
  select distinct on (decision.shadow_contact_id)
    decision.shadow_contact_id,
    decision.decision,
    decision.created_at
  from public.complete_power_outage_contact_review_decisions decision
  order by decision.shadow_contact_id, decision.created_at desc, decision.id desc
), latest_domain_decision as (
  select distinct on (decision.ico, decision.normalized_domain)
    decision.ico,
    decision.normalized_domain,
    decision.decision
  from public.complete_power_outage_contact_domain_review_decisions decision
  order by decision.ico, decision.normalized_domain, decision.created_at desc, decision.id desc
), resolved as (
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
  where extraction_queue.authorization_source = 'automatic_v3'
     or (
       extraction_queue.authorization_source = 'manual_review'
       and latest_domain_decision.decision = 'approved'
     )
), ranked as (
  select
    resolved.*,
    row_number() over (
      partition by resolved.ico, resolved.contact_type
      order by
        resolved.notification_eligible desc,
        resolved.priority,
        resolved.normalized_value
    ) as effective_rank
  from resolved
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

revoke all on table public.complete_power_outage_contact_classification_effective_v1
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_classification_effective_v1
  to service_role;

drop function if exists public.get_complete_power_outage_contact_detail_v1(uuid);
create function public.get_complete_power_outage_contact_detail_v1(
  requested_candidate_id uuid
)
returns table (
  contact_type text,
  contact_value text,
  contact_class text,
  classification_status text,
  notification_eligible boolean,
  is_primary boolean,
  normalized_domain text,
  source_url text,
  transport_security text,
  review_decision text
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and (
        profile.role = 'admin'
        or coalesce(profile.can_view_power_outages, false)
      )
  ) then
    raise exception 'Pro zobrazeni kontaktu nemate opravneni.';
  end if;

  return query
  select
    effective.contact_type,
    effective.normalized_value,
    effective.contact_class,
    effective.effective_classification_status,
    effective.notification_eligible,
    effective.is_primary,
    effective.normalized_domain,
    effective.source_url,
    effective.transport_security,
    effective.latest_review_decision
  from public.complete_power_outage_companies candidate
  join public.complete_power_outage_contact_classification_effective_v1 effective
    on effective.ico = candidate.ico
  where candidate.id = requested_candidate_id
    and candidate.candidate_status = 'confirmed'
  order by
    effective.contact_type,
    effective.is_primary desc,
    effective.priority,
    effective.normalized_value;
end;
$$;

revoke all on function public.get_complete_power_outage_contact_detail_v1(uuid)
  from public, anon;
grant execute on function public.get_complete_power_outage_contact_detail_v1(uuid)
  to authenticated, service_role;

create or replace function public.get_complete_power_outage_contact_management_summary_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Sprava dohledavani kontaktu je dostupna pouze administratorum.';
  end if;

  select jsonb_build_object(
    'enabled', state_row.ui_enabled
      and coalesce((state_row.metadata ->> 'contactManagementUiEnabled')::boolean, false),
    'selectedSelectorKey', state_row.selected_selector_key,
    'selectedSelectorName', selector.display_name,
    'targetCompanyCount', coalesce(batch.target_ico_count, 0),
    'verifiedWebsiteCount', (
      select count(*)
      from public.complete_power_outage_contact_discovery_website_v3_results website
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = website.ico
      where website.result_status = 'verified_company'
    ),
    'companyWithPrimaryEmailCount', (
      select count(distinct effective.ico)
      from public.complete_power_outage_contact_classification_effective_v1 effective
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = effective.ico
      where effective.contact_type = 'email' and effective.is_primary
    ),
    'companyWithPhoneCount', (
      select count(distinct effective.ico)
      from public.complete_power_outage_contact_classification_effective_v1 effective
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = effective.ico
      where effective.contact_type = 'phone'
    ),
    'actionableReviewCompanyCount', (
      select count(distinct review_contact.ico)
      from public.complete_power_outage_contact_classification_effective_v1 review_contact
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = review_contact.ico
      where review_contact.contact_type = 'email'
        and review_contact.effective_classification_status = 'needs_review'
        and not exists (
          select 1
          from public.complete_power_outage_contact_classification_effective_v1 usable
          where usable.ico = review_contact.ico
            and usable.contact_type = 'email'
            and usable.notification_eligible
        )
    ),
    'contactReviewCount', (
      select count(*)
      from public.complete_power_outage_contact_classification_effective_v1 effective
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = effective.ico
      where effective.contact_type = 'email'
        and effective.effective_classification_status = 'needs_review'
    ),
    'domainReviewCount', (
      select count(*)
      from public.complete_power_outage_contact_discovery_website_v3_results website
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = website.ico
      left join lateral (
        select decision.decision
        from public.complete_power_outage_contact_domain_review_decisions decision
        where decision.ico = website.ico
          and decision.normalized_domain = website.normalized_domain
        order by decision.created_at desc, decision.id desc
        limit 1
      ) latest_decision on true
      where website.result_status = 'needs_review'
        and website.candidate_url is not null
        and website.normalized_domain is not null
        and coalesce(latest_decision.decision, 'revoked') = 'revoked'
    ),
    'noWebsiteCount', (
      select count(*)
      from public.complete_power_outage_contact_discovery_website_v3_results website
      join public.complete_power_outage_contact_discovery_batch_items batch_item
        on batch_item.batch_id = batch.id and batch_item.ico = website.ico
      where website.result_status = 'no_website'
    ),
    'pendingCount',
      (select count(*) from public.complete_power_outage_contact_discovery_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status in ('waiting_profile', 'pending'))
      + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status = 'pending'),
    'processingCount',
      (select count(*) from public.complete_power_outage_contact_discovery_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status = 'processing')
      + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status = 'processing'),
    'errorCount',
      (select count(*) from public.complete_power_outage_contact_discovery_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status = 'error')
      + (select count(*) from public.complete_power_outage_contact_extraction_shadow_queue queue_row
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = batch.id and batch_item.ico = queue_row.ico
        where queue_row.queue_status = 'error'),
    'lastActivityAt', state_row.last_activity_at,
    'lastErrorCode', state_row.last_error_code,
    'lastErrorMessage', state_row.last_error_message,
    'emailPlanningEnabled', state_row.email_planning_enabled,
    'emailDispatchEnabled', state_row.email_dispatch_enabled
  ) into result
  from public.complete_power_outage_contact_discovery_state state_row
  join public.complete_power_outage_contact_discovery_selectors selector
    on selector.selector_key = state_row.selected_selector_key
  left join lateral (
    select discovery_batch.id, discovery_batch.target_ico_count
    from public.complete_power_outage_contact_discovery_batches discovery_batch
    where discovery_batch.selector_key = state_row.selected_selector_key
    order by discovery_batch.created_at desc
    limit 1
  ) batch on true
  where state_row.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.get_complete_power_outage_contact_management_workspace_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Sprava dohledavani kontaktu je dostupna pouze administratorum.';
  end if;

  select jsonb_build_object(
    'summary', public.get_complete_power_outage_contact_management_summary_v1(),
    'selectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', selector_row.selector_key,
        'name', selector_row.display_name,
        'companyCount', selector_row.company_count,
        'profileReadyCount', selector_row.profile_ready_count
      ) order by selector_row.sort_order, selector_row.selector_key)
      from (
        select
          selector.selector_key,
          selector.display_name,
          count(target.ico)::bigint as company_count,
          count(target.ico) filter (where target.has_company_profile)::bigint as profile_ready_count,
          case selector.selector_key
            when 'top_v1' then 1 when 'grade_a' then 2
            when 'grade_b' then 3 when 'all_confirmed' then 4 else 5
          end as sort_order
        from public.complete_power_outage_contact_discovery_selectors selector
        left join public.complete_power_outage_contact_discovery_selector_targets target
          on target.selector_key = selector.selector_key
        where selector.lifecycle_status = 'active'
        group by selector.selector_key, selector.display_name
      ) selector_row
    ), '[]'::jsonb),
    'contactReviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'contactId', review_row.shadow_contact_id,
        'companyName', review_row.official_name,
        'ico', review_row.ico,
        'domain', review_row.normalized_domain,
        'email', review_row.normalized_value,
        'contactClass', review_row.contact_class,
        'sourceUrl', review_row.source_url,
        'transportSecurity', review_row.transport_security,
        'actionable', review_row.actionable
      ) order by review_row.actionable desc, review_row.official_name, review_row.normalized_value)
      from (
        select
          effective.shadow_contact_id,
          profile.official_name,
          effective.ico,
          effective.normalized_domain,
          effective.normalized_value,
          effective.contact_class,
          effective.source_url,
          effective.transport_security,
          not exists (
            select 1
            from public.complete_power_outage_contact_classification_effective_v1 usable
            where usable.ico = effective.ico
              and usable.contact_type = 'email'
              and usable.notification_eligible
          ) as actionable
        from public.complete_power_outage_contact_classification_effective_v1 effective
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = active_batch.id and batch_item.ico = effective.ico
        join public.complete_power_outage_company_profiles profile
          on profile.id = effective.company_profile_id and profile.ico = effective.ico
        where effective.contact_type = 'email'
          and effective.effective_classification_status = 'needs_review'
        limit 250
      ) review_row
    ), '[]'::jsonb),
    'domainReviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ico', domain_row.ico,
        'companyName', domain_row.official_name,
        'domain', domain_row.normalized_domain,
        'url', domain_row.candidate_url,
        'confidence', domain_row.confidence,
        'decisionCodes', domain_row.decision_codes
      ) order by domain_row.official_name, domain_row.normalized_domain)
      from (
        select
          website.ico,
          profile.official_name,
          website.normalized_domain,
          website.candidate_url,
          website.confidence,
          website.decision_codes
        from public.complete_power_outage_contact_discovery_website_v3_results website
        join public.complete_power_outage_contact_discovery_batch_items batch_item
          on batch_item.batch_id = active_batch.id and batch_item.ico = website.ico
        join public.complete_power_outage_company_profiles profile
          on profile.id = website.company_profile_id and profile.ico = website.ico
        left join lateral (
          select decision.decision
          from public.complete_power_outage_contact_domain_review_decisions decision
          where decision.ico = website.ico
            and decision.normalized_domain = website.normalized_domain
          order by decision.created_at desc, decision.id desc
          limit 1
        ) latest_decision on true
        where website.result_status = 'needs_review'
          and website.candidate_url is not null
          and website.normalized_domain is not null
          and coalesce(latest_decision.decision, 'revoked') = 'revoked'
        limit 200
      ) domain_row
    ), '[]'::jsonb),
    'recentBatches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', batch_row.id,
        'selectorKey', batch_row.selector_key,
        'status', batch_row.batch_status,
        'targetCount', batch_row.target_ico_count,
        'capturedAt', batch_row.captured_at,
        'finishedAt', batch_row.finished_at
      ) order by batch_row.created_at desc)
      from (
        select *
        from public.complete_power_outage_contact_discovery_batches
        order by created_at desc
        limit 10
      ) batch_row
    ), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_contact_discovery_state state_row
  left join lateral (
    select discovery_batch.id
    from public.complete_power_outage_contact_discovery_batches discovery_batch
    where discovery_batch.selector_key = state_row.selected_selector_key
    order by discovery_batch.created_at desc
    limit 1
  ) active_batch on true
  where state_row.singleton;

  return result;
end;
$$;

create or replace function public.decide_complete_power_outage_contact_review_v1(
  requested_contact_id uuid,
  requested_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare selected_contact public.complete_power_outage_contact_classification_v2_shadow%rowtype;
declare decision_value text := lower(btrim(coalesce(requested_decision, '')));
declare inserted_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Rozhodovat o kontaktech muze pouze administrator.';
  end if;
  if decision_value not in ('approved', 'rejected') then
    raise exception 'Neplatne rozhodnuti o kontaktu.';
  end if;

  select classification.* into selected_contact
  from public.complete_power_outage_contact_classification_v2_shadow classification
  where classification.shadow_contact_id = requested_contact_id
    and classification.contact_type = 'email'
    and classification.classification_status = 'needs_review';
  if selected_contact.shadow_contact_id is null then
    raise exception 'Kontakt ke kontrole nebyl nalezen.';
  end if;

  insert into public.complete_power_outage_contact_review_decisions (
    shadow_contact_id, ico, company_profile_id, contact_type,
    normalized_value, decision, reason, decided_by, rules_version, evidence
  ) values (
    selected_contact.shadow_contact_id,
    selected_contact.ico,
    selected_contact.company_profile_id,
    selected_contact.contact_type,
    selected_contact.normalized_value,
    decision_value,
    case when decision_value = 'approved'
      then 'Schvaleno administratorem v prehledu kontaktu.'
      else 'Zamitnuto administratorem v prehledu kontaktu.' end,
    auth.uid(),
    selected_contact.rules_version,
    jsonb_build_object('contract', 'complete-contact-review-ui-v1')
  ) returning id into inserted_id;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      metadata = metadata || jsonb_build_object(
        'lastContactReviewDecisionAt', now(),
        'lastContactReviewDecisionId', inserted_id
      ),
      updated_at = now()
  where singleton;

  return jsonb_build_object('status', 'succeeded', 'decision', decision_value);
end;
$$;

create or replace function public.decide_complete_power_outage_domain_review_v1(
  requested_ico text,
  requested_domain text,
  requested_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare website public.complete_power_outage_contact_discovery_website_v3_results%rowtype;
declare decision_value text := lower(btrim(coalesce(requested_decision, '')));
declare inserted_id uuid;
declare capture_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Rozhodovat o domenach muze pouze administrator.';
  end if;
  if decision_value not in ('approved', 'rejected') then
    raise exception 'Neplatne rozhodnuti o domene.';
  end if;

  select result_row.* into website
  from public.complete_power_outage_contact_discovery_website_v3_results result_row
  where result_row.ico = requested_ico
    and result_row.normalized_domain = lower(btrim(requested_domain))
    and result_row.result_status = 'needs_review'
    and result_row.candidate_url is not null;
  if website.ico is null then
    raise exception 'Domena ke kontrole nebyla nalezena.';
  end if;

  insert into public.complete_power_outage_contact_domain_review_decisions (
    ico, company_profile_id, normalized_domain, candidate_url,
    decision, reason, decided_by, source_result_version, rules_version, evidence
  ) values (
    website.ico,
    website.company_profile_id,
    website.normalized_domain,
    website.candidate_url,
    decision_value,
    case when decision_value = 'approved'
      then 'Schvaleno administratorem v prehledu kontaktu.'
      else 'Zamitnuto administratorem v prehledu kontaktu.' end,
    auth.uid(),
    3,
    1,
    jsonb_build_object('contract', 'complete-domain-review-ui-v1')
  ) returning id into inserted_id;

  if decision_value = 'approved' then
    capture_result := public.capture_complete_power_outage_contact_extraction_shadow();
  end if;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      metadata = metadata || jsonb_build_object(
        'lastDomainReviewDecisionAt', now(),
        'lastDomainReviewDecisionId', inserted_id
      ),
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'decision', decision_value,
    'capture', capture_result
  );
end;
$$;

create or replace function public.prepare_complete_power_outage_contact_selector_v1(
  requested_selector_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare capture_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Vyber kontaktu muze menit pouze administrator.';
  end if;
  if not exists (
    select 1
    from public.complete_power_outage_contact_discovery_selectors selector
    where selector.selector_key = requested_selector_key
      and selector.lifecycle_status = 'active'
  ) then
    raise exception 'Pozadovany vyber kontaktu neni aktivni.';
  end if;

  capture_result := public.capture_complete_power_outage_contact_discovery_batch(
    requested_selector_key
  );

  update public.complete_power_outage_contact_discovery_state
  set website_lookup_enabled = false,
      metadata = metadata || jsonb_build_object(
        'lastSelectorPreparedFromUiAt', now(),
        'lastSelectorPreparedFromUiBy', auth.uid(),
        'paidWebsiteLookupRequested', false
      ),
      updated_at = now()
  where singleton;

  return capture_result || jsonb_build_object('paidWebsiteLookupRequested', false);
end;
$$;

revoke all on function public.get_complete_power_outage_contact_management_summary_v1()
  from public, anon;
revoke all on function public.get_complete_power_outage_contact_management_workspace_v1()
  from public, anon;
revoke all on function public.decide_complete_power_outage_contact_review_v1(uuid, text)
  from public, anon;
revoke all on function public.decide_complete_power_outage_domain_review_v1(text, text, text)
  from public, anon;
revoke all on function public.prepare_complete_power_outage_contact_selector_v1(text)
  from public, anon;

grant execute on function public.get_complete_power_outage_contact_management_summary_v1()
  to authenticated, service_role;
grant execute on function public.get_complete_power_outage_contact_management_workspace_v1()
  to authenticated, service_role;
grant execute on function public.decide_complete_power_outage_contact_review_v1(uuid, text)
  to authenticated, service_role;
grant execute on function public.decide_complete_power_outage_domain_review_v1(text, text, text)
  to authenticated, service_role;
grant execute on function public.prepare_complete_power_outage_contact_selector_v1(text)
  to authenticated, service_role;

update public.complete_power_outage_contact_discovery_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'contactManagementUiEnabled', true,
      'contactManagementUiVersion', 1,
      'contactManagementUiAudience', 'admin',
      'contactReviewDecisionUiEnabled', true,
      'domainReviewDecisionUiEnabled', true,
      'contactSelectorPreparationUiEnabled', true,
      'paidWebsiteLookupFromUiEnabled', false,
      'emailPlanningUiEnabled', false,
      'emailDispatchUiEnabled', false,
      'contactManagementContract', 'complete-contact-management-ui-v1',
      'contactManagementActivatedAt', now()
    ),
    updated_at = now()
where singleton;

commit;
