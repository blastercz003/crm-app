begin;

-- Etapa 1: neveřejný stavový automat pro lokální dohledání kontaktů a následný
-- auditovaný Brave fallback. Tento soubor nevytváří cron, nevolá HTTP a nemění
-- existující v2/v3 ověřování webů, extrakci ani klasifikaci kontaktů.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_state') is null
    or to_regclass('public.complete_power_outage_contact_discovery_batches') is null
    or to_regclass('public.complete_power_outage_contact_discovery_batch_items') is null
    or to_regclass('public.complete_power_outage_contact_discovery_website_v2_results') is null
    or to_regclass('public.complete_power_outage_contact_discovery_website_v3_results') is null
    or to_regclass('public.complete_power_outage_contact_extraction_shadow_queue') is null
    or to_regclass('public.complete_power_outage_contact_classification_effective_v1') is null then
    raise exception 'Chybi zavislosti pro local-first orchestraci kontaktu v2.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_contact_pipeline_v2_shadow (
  batch_id uuid not null,
  ico text not null,
  company_profile_id uuid,
  company_name_snapshot text not null,
  pipeline_status text not null,
  fallback_eligible boolean not null default false,
  brave_used boolean not null default false,
  brave_query_count integer not null default 0,
  brave_candidate_count integer not null default 0,
  local_candidate_count integer not null default 0,
  has_verified_company_domain boolean not null default false,
  has_any_email boolean not null default false,
  has_eligible_email boolean not null default false,
  has_phone boolean not null default false,
  email_count integer not null default 0,
  eligible_email_count integer not null default 0,
  review_email_count integer not null default 0,
  phone_count integer not null default 0,
  website_result_status text,
  extraction_queue_status text,
  source_fingerprint text not null,
  reason_codes text[] not null default '{}'::text[],
  source_snapshot jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (batch_id, ico),
  constraint cpo_contact_pipeline_v2_batch_item_fkey
    foreign key (batch_id, ico)
    references public.complete_power_outage_contact_discovery_batch_items(batch_id, ico)
    on delete restrict,
  constraint cpo_contact_pipeline_v2_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico)
    on delete restrict,
  constraint cpo_contact_pipeline_v2_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_contact_pipeline_v2_name_check check (btrim(company_name_snapshot) <> ''),
  constraint cpo_contact_pipeline_v2_status_check check (pipeline_status in (
    'waiting_profile',
    'local_pending',
    'local_processing',
    'local_contact_found',
    'brave_eligible',
    'brave_pending',
    'brave_processing',
    'brave_contact_found',
    'domain_review',
    'contact_review',
    'no_usable_email',
    'no_website',
    'technical_error'
  )),
  constraint cpo_contact_pipeline_v2_fallback_check check (
    fallback_eligible = (pipeline_status = 'brave_eligible')
  ),
  constraint cpo_contact_pipeline_v2_counts_check check (
    brave_query_count >= 0
    and brave_candidate_count >= 0
    and local_candidate_count >= 0
    and email_count >= 0
    and eligible_email_count >= 0
    and review_email_count >= 0
    and phone_count >= 0
    and eligible_email_count <= email_count
    and review_email_count <= email_count
  ),
  constraint cpo_contact_pipeline_v2_contact_flags_check check (
    has_any_email = (email_count > 0)
    and has_eligible_email = (eligible_email_count > 0)
    and has_phone = (phone_count > 0)
  ),
  constraint cpo_contact_pipeline_v2_brave_counts_check check (
    (brave_used and brave_query_count > 0)
    or (not brave_used and brave_query_count = 0 and brave_candidate_count = 0)
  ),
  constraint cpo_contact_pipeline_v2_fingerprint_check check (
    source_fingerprint ~ '^[a-f0-9]{32}$'
  ),
  constraint cpo_contact_pipeline_v2_reasons_check check (
    array_position(reason_codes, null) is null
  ),
  constraint cpo_contact_pipeline_v2_snapshot_check check (
    jsonb_typeof(source_snapshot) = 'object'
  )
);

create index if not exists cpo_contact_pipeline_v2_status_idx
  on public.complete_power_outage_contact_pipeline_v2_shadow (
    batch_id, pipeline_status, evaluated_at, ico
  );

create index if not exists cpo_contact_pipeline_v2_fallback_idx
  on public.complete_power_outage_contact_pipeline_v2_shadow (
    batch_id, evaluated_at, ico
  ) where fallback_eligible;

drop trigger if exists cpo_contact_pipeline_v2_set_updated_at
  on public.complete_power_outage_contact_pipeline_v2_shadow;
create trigger cpo_contact_pipeline_v2_set_updated_at
before update on public.complete_power_outage_contact_pipeline_v2_shadow
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_pipeline_v2_shadow
  enable row level security;
revoke all on table public.complete_power_outage_contact_pipeline_v2_shadow
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_pipeline_v2_shadow
  to service_role;

create or replace function public.refresh_complete_power_outage_contact_pipeline_v2_shadow()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  selected_batch_id uuid;
  affected_count integer := 0;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('complete-contact-pipeline-v2-shadow'));

  select batch.id into selected_batch_id
  from public.complete_power_outage_contact_discovery_state state_row
  join lateral (
    select candidate_batch.id
    from public.complete_power_outage_contact_discovery_batches candidate_batch
    where candidate_batch.selector_key = state_row.selected_selector_key
      and candidate_batch.batch_status in ('ready', 'active', 'paused', 'completed')
    order by candidate_batch.created_at desc, candidate_batch.id desc
    limit 1
  ) batch on true
  where state_row.singleton;

  if selected_batch_id is null then
    return jsonb_build_object(
      'status', 'no_batch',
      'externalRequestCount', 0,
      'workerStarted', false
    );
  end if;

  with contact_counts as materialized (
    select
      effective.ico,
      count(*) filter (where effective.contact_type = 'email')::integer as email_count,
      count(*) filter (
        where effective.contact_type = 'email'
          and effective.notification_eligible
      )::integer as eligible_email_count,
      count(*) filter (
        where effective.contact_type = 'email'
          and effective.effective_classification_status = 'needs_review'
      )::integer as review_email_count,
      count(*) filter (where effective.contact_type = 'phone')::integer as phone_count
    from public.complete_power_outage_contact_classification_effective_v1 effective
    group by effective.ico
  ), source_rows as materialized (
    select
      item.batch_id,
      item.ico,
      item.company_profile_id,
      item.company_name,
      v2.result_status as v2_status,
      v2.updated_at as v2_updated_at,
      v2.evidence as v2_evidence,
      v3.result_status as v3_status,
      v3.updated_at as v3_updated_at,
      extraction.queue_status as extraction_status,
      extraction.updated_at as extraction_updated_at,
      coalesce(contact.email_count, 0) as email_count,
      coalesce(contact.eligible_email_count, 0) as eligible_email_count,
      coalesce(contact.review_email_count, 0) as review_email_count,
      coalesce(contact.phone_count, 0) as phone_count,
      case
        when coalesce(v2.evidence #>> '{search,queryCount}', '') ~ '^[0-9]+$'
          then (v2.evidence #>> '{search,queryCount}')::integer
        else 0
      end as brave_query_count,
      case
        when coalesce(v2.evidence #>> '{search,acceptedCandidateCount}', '') ~ '^[0-9]+$'
          then (v2.evidence #>> '{search,acceptedCandidateCount}')::integer
        else 0
      end as brave_candidate_count,
      case
        when coalesce(v2.evidence ->> 'localCandidateCount', '') ~ '^[0-9]+$'
          then (v2.evidence ->> 'localCandidateCount')::integer
        else 0
      end as local_candidate_count
    from public.complete_power_outage_contact_discovery_batch_items item
    left join public.complete_power_outage_contact_discovery_website_v2_results v2
      on v2.ico = item.ico and v2.company_profile_id = item.company_profile_id
    left join public.complete_power_outage_contact_discovery_website_v3_results v3
      on v3.ico = item.ico and v3.company_profile_id = item.company_profile_id
    left join public.complete_power_outage_contact_extraction_shadow_queue extraction
      on extraction.ico = item.ico and extraction.company_profile_id = item.company_profile_id
    left join contact_counts contact on contact.ico = item.ico
    where item.batch_id = selected_batch_id
  ), classified as materialized (
    select
      source.*,
      source.brave_query_count > 0 as brave_used,
      case
        when source.company_profile_id is null then 'waiting_profile'
        when source.eligible_email_count > 0 and source.brave_query_count > 0
          then 'brave_contact_found'
        when source.eligible_email_count > 0
          then 'local_contact_found'
        when source.brave_query_count > 0 and source.review_email_count > 0
          then 'contact_review'
        when source.brave_query_count > 0 and source.v3_status = 'needs_review'
          then 'domain_review'
        when source.extraction_status = 'error'
          or source.v2_status = 'error'
          then 'technical_error'
        when source.brave_query_count > 0
          and source.extraction_status in ('pending', 'processing')
          then 'brave_processing'
        when source.brave_query_count > 0
          and source.v3_status = 'verified_company'
          and source.extraction_status is null
          then 'brave_processing'
        when source.brave_query_count > 0 and source.v3_status = 'no_website'
          then 'no_website'
        when source.brave_query_count > 0
          and source.extraction_status in ('contacts_found', 'no_contact', 'needs_review', 'cancelled')
          then 'no_usable_email'
        when source.brave_query_count > 0
          then 'no_website'
        when source.extraction_status in ('contacts_found', 'no_contact', 'needs_review', 'cancelled')
          or source.v3_status in ('needs_review', 'no_website')
          or source.v2_status in ('needs_review', 'no_website')
          then 'brave_eligible'
        when source.v2_status = 'processing'
          or source.extraction_status = 'processing'
          then 'local_processing'
        else 'local_pending'
      end as pipeline_status
    from source_rows source
  )
  insert into public.complete_power_outage_contact_pipeline_v2_shadow (
    batch_id,
    ico,
    company_profile_id,
    company_name_snapshot,
    pipeline_status,
    fallback_eligible,
    brave_used,
    brave_query_count,
    brave_candidate_count,
    local_candidate_count,
    has_verified_company_domain,
    has_any_email,
    has_eligible_email,
    has_phone,
    email_count,
    eligible_email_count,
    review_email_count,
    phone_count,
    website_result_status,
    extraction_queue_status,
    source_fingerprint,
    reason_codes,
    source_snapshot,
    evaluated_at
  )
  select
    classified.batch_id,
    classified.ico,
    classified.company_profile_id,
    classified.company_name,
    classified.pipeline_status,
    classified.pipeline_status = 'brave_eligible',
    classified.brave_used,
    classified.brave_query_count,
    classified.brave_candidate_count,
    classified.local_candidate_count,
    coalesce(classified.v3_status = 'verified_company', false),
    classified.email_count > 0,
    classified.eligible_email_count > 0,
    classified.phone_count > 0,
    classified.email_count,
    classified.eligible_email_count,
    classified.review_email_count,
    classified.phone_count,
    coalesce(classified.v3_status, classified.v2_status),
    classified.extraction_status,
    md5(concat_ws('|',
      classified.company_profile_id::text,
      classified.v2_status,
      classified.v2_updated_at::text,
      classified.v3_status,
      classified.v3_updated_at::text,
      classified.extraction_status,
      classified.extraction_updated_at::text,
      classified.email_count::text,
      classified.eligible_email_count::text,
      classified.review_email_count::text,
      classified.phone_count::text
    )),
    array_remove(array[
      case when classified.company_profile_id is null then 'missing_company_profile' end,
      case when classified.brave_used then 'audited_brave_search_recorded' end,
      case when classified.pipeline_status = 'brave_eligible' then 'local_phase_has_no_eligible_email' end,
      case when classified.review_email_count > 0 then 'review_email_available' end,
      case when classified.phone_count > 0 and classified.eligible_email_count = 0 then 'phone_without_eligible_email' end,
      case when classified.v3_status = 'needs_review' then 'domain_requires_review' end,
      case when classified.v3_status = 'no_website' then 'verified_website_not_found' end,
      case when classified.extraction_status = 'no_contact' then 'website_has_no_extracted_contact' end,
      case when classified.pipeline_status = 'technical_error' then 'technical_error_requires_attention' end
    ]::text[], null),
    jsonb_build_object(
      'contract', 'complete-contact-local-first-orchestration-v2-shadow',
      'readOnlyProjection', true,
      'v2WebsiteStatus', classified.v2_status,
      'v3WebsiteStatus', classified.v3_status,
      'extractionStatus', classified.extraction_status,
      'braveSearchRecorded', classified.brave_used,
      'fallbackTrigger', 'missing_eligible_email',
      'auditedBraveQueryLimit', 2,
      'auditedBraveCandidateLimit', 5,
      'workerEnabled', false
    ),
    now()
  from classified
  on conflict (batch_id, ico) do update
  set company_profile_id = excluded.company_profile_id,
      company_name_snapshot = excluded.company_name_snapshot,
      pipeline_status = excluded.pipeline_status,
      fallback_eligible = excluded.fallback_eligible,
      brave_used = excluded.brave_used,
      brave_query_count = excluded.brave_query_count,
      brave_candidate_count = excluded.brave_candidate_count,
      local_candidate_count = excluded.local_candidate_count,
      has_verified_company_domain = excluded.has_verified_company_domain,
      has_any_email = excluded.has_any_email,
      has_eligible_email = excluded.has_eligible_email,
      has_phone = excluded.has_phone,
      email_count = excluded.email_count,
      eligible_email_count = excluded.eligible_email_count,
      review_email_count = excluded.review_email_count,
      phone_count = excluded.phone_count,
      website_result_status = excluded.website_result_status,
      extraction_queue_status = excluded.extraction_queue_status,
      source_fingerprint = excluded.source_fingerprint,
      reason_codes = excluded.reason_codes,
      source_snapshot = excluded.source_snapshot,
      evaluated_at = excluded.evaluated_at;

  get diagnostics affected_count = row_count;

  select jsonb_build_object(
    'status', 'succeeded',
    'batchId', selected_batch_id,
    'processedCount', affected_count,
    'localContactFoundCount', count(*) filter (
      where pipeline.pipeline_status = 'local_contact_found'
    ),
    'braveEligibleCount', count(*) filter (
      where pipeline.pipeline_status = 'brave_eligible'
    ),
    'braveAlreadyUsedCount', count(*) filter (where pipeline.brave_used),
    'usableEmailCompanyCount', count(*) filter (where pipeline.has_eligible_email),
    'reviewCount', count(*) filter (
      where pipeline.pipeline_status in ('domain_review', 'contact_review')
    ),
    'terminalWithoutEmailCount', count(*) filter (
      where pipeline.pipeline_status in ('no_usable_email', 'no_website')
    ),
    'errorCount', count(*) filter (
      where pipeline.pipeline_status = 'technical_error'
    ),
    'externalRequestCount', 0,
    'workerStarted', false,
    'refreshedAt', now()
  ) into result
  from public.complete_power_outage_contact_pipeline_v2_shadow pipeline
  where pipeline.batch_id = selected_batch_id;

  return result;
end;
$$;

revoke all on function public.refresh_complete_power_outage_contact_pipeline_v2_shadow()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_contact_pipeline_v2_shadow()
  to service_role;

create or replace view public.complete_power_outage_contact_pipeline_v2_shadow_overview
with (security_invoker = true)
as
select
  pipeline.batch_id,
  batch.selector_key,
  batch.batch_status,
  count(*)::bigint as target_count,
  count(*) filter (where pipeline.pipeline_status = 'waiting_profile')::bigint
    as waiting_profile_count,
  count(*) filter (where pipeline.pipeline_status = 'local_pending')::bigint
    as local_pending_count,
  count(*) filter (where pipeline.pipeline_status = 'local_processing')::bigint
    as local_processing_count,
  count(*) filter (where pipeline.pipeline_status = 'local_contact_found')::bigint
    as local_contact_found_count,
  count(*) filter (where pipeline.pipeline_status = 'brave_eligible')::bigint
    as brave_eligible_count,
  count(*) filter (where pipeline.pipeline_status in ('brave_pending', 'brave_processing'))::bigint
    as brave_work_count,
  count(*) filter (where pipeline.pipeline_status = 'brave_contact_found')::bigint
    as brave_contact_found_count,
  count(*) filter (where pipeline.pipeline_status = 'domain_review')::bigint
    as domain_review_count,
  count(*) filter (where pipeline.pipeline_status = 'contact_review')::bigint
    as contact_review_count,
  count(*) filter (where pipeline.pipeline_status = 'no_usable_email')::bigint
    as no_usable_email_count,
  count(*) filter (where pipeline.pipeline_status = 'no_website')::bigint
    as no_website_count,
  count(*) filter (where pipeline.pipeline_status = 'technical_error')::bigint
    as error_count,
  count(*) filter (where pipeline.has_eligible_email)::bigint
    as usable_email_company_count,
  count(*) filter (where pipeline.has_phone)::bigint
    as phone_company_count,
  coalesce(sum(pipeline.brave_query_count), 0)::bigint as recorded_brave_query_count,
  max(pipeline.evaluated_at) as last_evaluated_at
from public.complete_power_outage_contact_pipeline_v2_shadow pipeline
join public.complete_power_outage_contact_discovery_batches batch
  on batch.id = pipeline.batch_id
group by pipeline.batch_id, batch.selector_key, batch.batch_status;

alter view public.complete_power_outage_contact_pipeline_v2_shadow_overview
  set (security_invoker = true);
revoke all on table public.complete_power_outage_contact_pipeline_v2_shadow_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_pipeline_v2_shadow_overview
  to service_role;

-- Jednorázově pouze promítne již existující auditovaná data do SHADOW automatu.
-- Neprovede žádný externí požadavek.
select public.refresh_complete_power_outage_contact_pipeline_v2_shadow()
  as contact_pipeline_v2_shadow_snapshot;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (values
  ('TABLE'::text, 'local-first contact pipeline v2 SHADOW state exists'::text,
    to_regclass('public.complete_power_outage_contact_pipeline_v2_shadow') is not null),
  ('VIEW', 'local-first contact pipeline v2 SHADOW overview exists',
    to_regclass('public.complete_power_outage_contact_pipeline_v2_shadow_overview') is not null),
  ('FUNCTION', 'deterministic local-first contact pipeline projection exists',
    to_regprocedure('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()') is not null),
  ('DATA', 'pipeline snapshot contains no duplicate company in a batch',
    not exists (
      select 1
      from public.complete_power_outage_contact_pipeline_v2_shadow
      group by batch_id, ico having count(*) > 1
    )),
  ('DATA', 'fallback candidates have no eligible email and no prior Brave search',
    not exists (
      select 1
      from public.complete_power_outage_contact_pipeline_v2_shadow
      where fallback_eligible
        and (has_eligible_email or brave_used or pipeline_status <> 'brave_eligible')
    )),
  ('DATA', 'every recorded Brave use has an audited query count',
    not exists (
      select 1
      from public.complete_power_outage_contact_pipeline_v2_shadow
      where brave_used and brave_query_count not between 1 and 2
    )),
  ('LOGIC', 'usable local email prevents Brave fallback eligibility',
    not exists (
      select 1
      from public.complete_power_outage_contact_pipeline_v2_shadow
      where has_eligible_email and fallback_eligible
    )),
  ('LOGIC', 'fallback trigger is missing eligible email',
    pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      ilike '%fallbackTrigger%missing_eligible_email%'),
  ('LOGIC', 'audited Brave query and candidate limits are recorded',
    not exists (
      select 1
      from public.complete_power_outage_contact_pipeline_v2_shadow
      where source_snapshot ->> 'auditedBraveQueryLimit' <> '2'
        or source_snapshot ->> 'auditedBraveCandidateLimit' <> '5'
    )),
  ('GRANT', 'authenticated cannot inspect or refresh private pipeline state',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_pipeline_v2_shadow',
      'SELECT'
    )
    and not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_contact_pipeline_v2_shadow_overview',
      'SELECT'
    )
    and not has_function_privilege(
      'authenticated',
      'public.refresh_complete_power_outage_contact_pipeline_v2_shadow()',
      'EXECUTE'
    )),
  ('RLS', 'local-first pipeline SHADOW table has RLS',
    (select class.relrowsecurity
     from pg_class class
     join pg_namespace namespace on namespace.oid = class.relnamespace
     where namespace.nspname = 'public'
       and class.relname = 'complete_power_outage_contact_pipeline_v2_shadow')),
  ('ISOLATION', 'local-first pipeline remains in COMPLETE scope',
    pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%power_outage_store%'
    and pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%client_email%'),
  ('SAFETY', 'stage one projection performs no HTTP or Brave request',
    pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%net.http%'
    and pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%request_complete_power_outage_contact%'
    and pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%diagnoseOfficialWebsite%'),
  ('SAFETY', 'stage one does not change runtime switches',
    pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%update public.complete_power_outage_contact_discovery_state%'),
  ('SAFETY', 'stage one creates no automatic schedule',
    not exists (
      select 1 from cron.job
      where jobname = 'complete_contact_pipeline_v2_shadow_orchestration'
    )),
  ('SAFETY', 'email planning and dispatch are not activated',
    pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%email_planning_enabled%'
    and pg_get_functiondef('public.refresh_complete_power_outage_contact_pipeline_v2_shadow()'::regprocedure)
      not ilike '%email_dispatch_enabled%')
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
