begin;

-- Verze 2 klasifikuje jiz vytazene SHADOW kontakty bez dalsich webovych dotazu.
-- Produkcni kontakty, UI, planovani a odesilani e-mailu zustavaji vypnute.
create table if not exists public.complete_power_outage_contact_review_decisions (
  id uuid primary key default gen_random_uuid(),
  shadow_contact_id uuid not null,
  ico text not null,
  company_profile_id uuid not null,
  contact_type text not null,
  normalized_value text not null,
  decision text not null,
  reason text not null,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  rules_version integer not null default 2,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_contact_review_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_review_type_check check (contact_type in ('email', 'phone')),
  constraint cpo_contact_review_value_check check (btrim(normalized_value) <> ''),
  constraint cpo_contact_review_decision_check check (
    decision in ('approved', 'rejected', 'revoked')
  ),
  constraint cpo_contact_review_reason_check check (btrim(reason) <> ''),
  constraint cpo_contact_review_rules_check check (rules_version > 0),
  constraint cpo_contact_review_evidence_check check (jsonb_typeof(evidence) = 'object')
);

create index if not exists cpo_contact_review_decisions_latest_idx
  on public.complete_power_outage_contact_review_decisions (
    shadow_contact_id, created_at desc, id desc
  );

create or replace function public.prevent_complete_power_outage_contact_review_decision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie rozhodnuti o kontaktu je nemenna; vlozte nove rozhodnuti.';
end;
$$;

drop trigger if exists cpo_contact_review_decisions_immutable
  on public.complete_power_outage_contact_review_decisions;
create trigger cpo_contact_review_decisions_immutable
before update or delete on public.complete_power_outage_contact_review_decisions
for each row execute function public.prevent_complete_power_outage_contact_review_decision_mutation();

alter table public.complete_power_outage_contact_review_decisions enable row level security;
revoke all on table public.complete_power_outage_contact_review_decisions
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_review_decisions to service_role;
revoke all on function public.prevent_complete_power_outage_contact_review_decision_mutation()
  from public, anon, authenticated;

create table if not exists public.complete_power_outage_contact_classification_v2_shadow (
  shadow_contact_id uuid primary key
    references public.complete_power_outage_contact_extraction_shadow_results(id) on delete cascade,
  ico text not null,
  company_profile_id uuid not null,
  normalized_domain text not null,
  contact_type text not null,
  normalized_value text not null,
  contact_class text not null,
  classification_status text not null,
  notification_eligible boolean not null,
  priority integer not null,
  rank_within_company integer not null,
  is_primary boolean not null,
  transport_security text not null,
  reason_codes text[] not null default '{}'::text[],
  rules_version integer not null default 2,
  classified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_classification_v2_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_classification_v2_type_check check (contact_type in ('email', 'phone')),
  constraint cpo_contact_classification_v2_class_check check (
    contact_class in (
      'operations', 'general', 'commercial', 'personal', 'administrative',
      'sensitive', 'unknown', 'phone_general', 'phone_unknown'
    )
  ),
  constraint cpo_contact_classification_v2_status_check check (
    classification_status in ('automatic', 'needs_review', 'informational')
  ),
  constraint cpo_contact_classification_v2_eligibility_check check (
    (contact_type = 'email'
      and notification_eligible = (classification_status = 'automatic'))
    or (contact_type = 'phone'
      and classification_status = 'informational'
      and not notification_eligible)
  ),
  constraint cpo_contact_classification_v2_priority_check check (
    priority between 1 and 100 and rank_within_company > 0
  ),
  constraint cpo_contact_classification_v2_primary_check check (
    not is_primary
    or (contact_type = 'email' and notification_eligible)
    or contact_type = 'phone'
  ),
  constraint cpo_contact_classification_v2_transport_check check (
    transport_security in ('https', 'http')
  ),
  constraint cpo_contact_classification_v2_rules_check check (rules_version = 2),
  constraint cpo_contact_classification_v2_unique
    unique (ico, contact_type, normalized_value)
);

create index if not exists cpo_contact_classification_v2_company_idx
  on public.complete_power_outage_contact_classification_v2_shadow (
    ico, contact_type, rank_within_company
  );

drop trigger if exists cpo_contact_classification_v2_set_updated_at
  on public.complete_power_outage_contact_classification_v2_shadow;
create trigger cpo_contact_classification_v2_set_updated_at
before update on public.complete_power_outage_contact_classification_v2_shadow
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_classification_v2_shadow enable row level security;
revoke all on table public.complete_power_outage_contact_classification_v2_shadow
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_classification_v2_shadow to service_role;

create or replace function public.refresh_complete_power_outage_contact_classification_v2_shadow()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare processed_count bigint;
declare automatic_email_count bigint;
declare review_email_count bigint;
declare phone_count bigint;
begin
  with base as materialized (
    select
      result_row.id as shadow_contact_id,
      result_row.ico,
      result_row.company_profile_id,
      result_row.normalized_domain,
      result_row.contact_type,
      result_row.normalized_value,
      result_row.contact_role,
      result_row.is_personal,
      result_row.confidence,
      result_row.source_url,
      result_row.extraction_methods,
      lower(split_part(result_row.normalized_value, '@', 1)) as local_part,
      regexp_replace(
        lower(reverse(split_part(reverse(result_row.normalized_domain), '.', 2))),
        '[^a-z0-9]', '', 'g'
      ) as domain_label
    from public.complete_power_outage_contact_extraction_shadow_results result_row
  ), email_classified as (
    select
      base.*,
      case
        when base.local_part ~ '^(whistleblowing|oznamovatel|privacy|gdpr|dpo|abuse)([._-]|$)'
          then 'sensitive'
        when base.local_part ~ '^(fakturace|faktury|ucto|uctarna|ucetni|accounting|finance|personalni|hr|kariera|career|marketing|eshop|e-shop|webshop|nakup)([._-]|$)'
          then 'administrative'
        when base.local_part ~ '^(servis|service|servisni|provoz|vyroba|technik|technicke|udrzba|maintenance|dispecink|dispatch|doprava|logistika|sklad|mistr|vedouci|zkusebna|lakovna|technologie|nahradni)([._-]|$)'
          then 'operations'
        when base.local_part ~ '^(info|kontakt|contact|office|recepce|reception|sekretariat|mail|hello|firma|company)([._-]|$)'
          or regexp_replace(base.local_part, '[^a-z0-9]', '', 'g') = base.domain_label
          or (
            length(regexp_replace(base.local_part, '[^a-z0-9]', '', 'g')) >= 5
            and base.domain_label like regexp_replace(base.local_part, '[^a-z0-9]', '', 'g') || '%'
          )
          then 'general'
        when base.local_part ~ '^(obchod|obchodni|sales|poptav[a-z]*|rfq|nabid[a-z]*|export)([._-]|$)'
          or base.local_part ~ '^priprava[._-]?nabid'
          or base.local_part in (
            'okna.priprava',
            'vysavace.odsavace',
            'alucomposite',
            'modrylom'
          )
          then 'commercial'
        when base.is_personal then 'personal'
        else 'unknown'
      end as contact_class
    from base
    where base.contact_type = 'email'
  ), classified as (
    select
      email_classified.*,
      case
        when email_classified.contact_class in ('operations', 'general', 'commercial')
          then 'automatic'
        else 'needs_review'
      end as classification_status,
      case email_classified.contact_class
        when 'operations' then 10
        when 'general' then 20
        when 'commercial' then 30
        when 'administrative' then 70
        when 'personal' then 80
        when 'unknown' then 85
        when 'sensitive' then 90
        else 95
      end as priority
    from email_classified

    union all

    select
      base.*,
      case when base.contact_role = 'general' then 'phone_general' else 'phone_unknown' end,
      'informational',
      case
        when base.contact_role = 'general' then 10
        when 'tel_link' = any(base.extraction_methods) then 20
        else 30
      end
    from base
    where base.contact_type = 'phone'
  ), ranked as (
    select
      classified.*,
      row_number() over (
        partition by classified.ico, classified.contact_type
        order by
          classified.priority,
          classified.confidence desc,
          classified.normalized_value
      )::integer as rank_within_company
    from classified
  ), upserted as (
    insert into public.complete_power_outage_contact_classification_v2_shadow as existing (
      shadow_contact_id, ico, company_profile_id, normalized_domain,
      contact_type, normalized_value, contact_class, classification_status,
      notification_eligible, priority, rank_within_company, is_primary,
      transport_security, reason_codes, rules_version, classified_at
    )
    select
      ranked.shadow_contact_id,
      ranked.ico,
      ranked.company_profile_id,
      ranked.normalized_domain,
      ranked.contact_type,
      ranked.normalized_value,
      ranked.contact_class,
      ranked.classification_status,
      ranked.contact_type = 'email' and ranked.classification_status = 'automatic',
      ranked.priority,
      ranked.rank_within_company,
      ranked.rank_within_company = 1
        and (ranked.contact_type = 'phone' or ranked.classification_status = 'automatic'),
      case when ranked.source_url ~* '^https://' then 'https' else 'http' end,
      array_remove(array[
        'classification_v2_1_' || ranked.contact_class,
        case when ranked.source_url !~* '^https://' then 'public_http_source' end,
        case when ranked.classification_status = 'needs_review' then 'manual_approval_required' end
      ], null),
      2,
      now()
    from ranked
    on conflict (shadow_contact_id) do update
    set ico = excluded.ico,
        company_profile_id = excluded.company_profile_id,
        normalized_domain = excluded.normalized_domain,
        contact_type = excluded.contact_type,
        normalized_value = excluded.normalized_value,
        contact_class = excluded.contact_class,
        classification_status = excluded.classification_status,
        notification_eligible = excluded.notification_eligible,
        priority = excluded.priority,
        rank_within_company = excluded.rank_within_company,
        is_primary = excluded.is_primary,
        transport_security = excluded.transport_security,
        reason_codes = excluded.reason_codes,
        rules_version = excluded.rules_version,
        classified_at = excluded.classified_at
    where (
      existing.ico,
      existing.company_profile_id,
      existing.normalized_domain,
      existing.contact_type,
      existing.normalized_value,
      existing.contact_class,
      existing.classification_status,
      existing.notification_eligible,
      existing.priority,
      existing.rank_within_company,
      existing.is_primary,
      existing.transport_security,
      existing.reason_codes,
      existing.rules_version
    ) is distinct from (
      excluded.ico,
      excluded.company_profile_id,
      excluded.normalized_domain,
      excluded.contact_type,
      excluded.normalized_value,
      excluded.contact_class,
      excluded.classification_status,
      excluded.notification_eligible,
      excluded.priority,
      excluded.rank_within_company,
      excluded.is_primary,
      excluded.transport_security,
      excluded.reason_codes,
      excluded.rules_version
    )
    returning shadow_contact_id
  )
  select count(*) into processed_count from upserted;

  delete from public.complete_power_outage_contact_classification_v2_shadow classification
  where not exists (
    select 1
    from public.complete_power_outage_contact_extraction_shadow_results result_row
    where result_row.id = classification.shadow_contact_id
  );

  select
    count(*) filter (where contact_type = 'email' and notification_eligible),
    count(*) filter (where contact_type = 'email' and classification_status = 'needs_review'),
    count(*) filter (where contact_type = 'phone')
  into automatic_email_count, review_email_count, phone_count
  from public.complete_power_outage_contact_classification_v2_shadow;

  update public.complete_power_outage_contact_discovery_state
  set last_activity_at = now(),
      metadata = metadata || jsonb_build_object(
        'contactClassificationShadowVersion', 2,
        'contactClassificationShadowRevision', '2.1',
        'contactClassificationShadowRefreshedAt', now(),
        'contactClassificationAutomaticEmailCount', automatic_email_count,
        'contactClassificationReviewEmailCount', review_email_count,
        'contactClassificationPhoneCount', phone_count,
        'contactClassificationExternalRequests', 0,
        'contactClassificationProductionContactsPersisted', false,
        'contactReviewDefaultScope', 'companies_without_automatic_email',
        'personalContactsDefaultVisibility', 'collapsed'
      )
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'rulesVersion', 2,
    'rulesRevision', '2.1',
    'processedCount', processed_count,
    'automaticEmailCount', automatic_email_count,
    'reviewEmailCount', review_email_count,
    'phoneCount', phone_count,
    'externalRequestCount', 0,
    'refreshedAt', now()
  );
end;
$$;

revoke all on function public.refresh_complete_power_outage_contact_classification_v2_shadow()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_contact_classification_v2_shadow()
  to service_role;

select public.refresh_complete_power_outage_contact_classification_v2_shadow();

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete_contact_classification_v2_shadow_every_minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'complete_contact_classification_v2_shadow_every_minute',
    '* * * * *',
    $job$select public.refresh_complete_power_outage_contact_classification_v2_shadow();$job$
  );
end
$$;

notify pgrst, 'reload schema';
commit;
