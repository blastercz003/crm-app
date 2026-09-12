begin;

-- Krok 5 v3 SHADOW: bezplatne a deterministicke prehodnoceni dukazu v2.
-- V1 i v2 vysledky zustavaji zachovane. Kontakty, UI a vsechny e-mailove faze
-- zustavaji vypnute.
alter table public.complete_power_outage_contact_discovery_state
  add column if not exists website_verification_v3_enabled boolean not null default false;

create table if not exists public.complete_power_outage_contact_discovery_domain_policies (
  normalized_domain text primary key,
  policy_type text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_domain_policy_domain_check check (
    normalized_domain = lower(btrim(normalized_domain))
    and normalized_domain ~ '^[a-z0-9.-]+$'
  ),
  constraint cpo_contact_domain_policy_type_check check (
    policy_type in ('third_party_directory', 'manual_review', 'trusted_first_party')
  )
);

insert into public.complete_power_outage_contact_discovery_domain_policies (
  normalized_domain, policy_type, reason
)
values
  ('aobp.cz', 'third_party_directory', 'clensky nebo oborovy katalog'),
  ('etendry.cz', 'third_party_directory', 'portal verejnych zakazek'),
  ('expanzo.com', 'third_party_directory', 'firemni databaze'),
  ('exporters.czechtrade.gov.cz', 'third_party_directory', 'exportni katalog'),
  ('gemin.cz', 'third_party_directory', 'portal verejnych zakazek'),
  ('ikatalog.bvv.cz', 'third_party_directory', 'veletrzni katalog'),
  ('infoaktualne.cz', 'third_party_directory', 'regionalni katalog'),
  ('slatinak.cz', 'third_party_directory', 'mistni informacni portal'),
  ('smlouvy.gov.cz', 'third_party_directory', 'verejny registr smluv'),
  ('sovak.cz', 'third_party_directory', 'clensky oborovy portal'),
  ('tikatalog.bvv.cz', 'third_party_directory', 'veletrzni katalog'),
  ('volnamistaunas.cz', 'third_party_directory', 'pracovni portal')
on conflict (normalized_domain) do update
set policy_type = excluded.policy_type,
    reason = excluded.reason,
    updated_at = now();

drop trigger if exists cpo_contact_domain_policies_set_updated_at
  on public.complete_power_outage_contact_discovery_domain_policies;
create trigger cpo_contact_domain_policies_set_updated_at
before update on public.complete_power_outage_contact_discovery_domain_policies
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_discovery_domain_policies
  enable row level security;
revoke all on table public.complete_power_outage_contact_discovery_domain_policies
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_discovery_domain_policies
  to service_role;

create table if not exists public.complete_power_outage_contact_discovery_website_v3_results (
  ico text primary key
    references public.complete_power_outage_contact_discovery_website_v2_results(ico)
    on delete restrict,
  company_profile_id uuid not null,
  result_status text not null,
  v2_result_status text not null,
  candidate_url text,
  normalized_domain text,
  confidence numeric(5,4) not null default 0,
  exact_ico_evidence boolean not null default false,
  same_domain_email_evidence boolean not null default false,
  first_party_domain_match boolean not null default false,
  shared_domain_count integer not null default 0,
  decision_codes text[] not null default '{}'::text[],
  evidence jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_website_v3_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico) on delete restrict,
  constraint cpo_contact_website_v3_status_check check (
    result_status in ('verified_company', 'needs_review', 'no_website')
  ),
  constraint cpo_contact_website_v3_v2_status_check check (
    v2_result_status in (
      'verified_company', 'verified_group', 'needs_review', 'no_website', 'error'
    )
  ),
  constraint cpo_contact_website_v3_verified_check check (
    result_status <> 'verified_company'
    or (
      candidate_url ~* '^https?://'
      and normalized_domain is not null
      and confidence >= 0.9
      and exact_ico_evidence
      and same_domain_email_evidence
      and first_party_domain_match
      and shared_domain_count = 1
      and cardinality(decision_codes) = 0
    )
  ),
  constraint cpo_contact_website_v3_shared_count_check check (shared_domain_count >= 0),
  constraint cpo_contact_website_v3_evidence_check check (jsonb_typeof(evidence) = 'object')
);

drop trigger if exists cpo_contact_website_v3_set_updated_at
  on public.complete_power_outage_contact_discovery_website_v3_results;
create trigger cpo_contact_website_v3_set_updated_at
before update on public.complete_power_outage_contact_discovery_website_v3_results
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_discovery_website_v3_results
  enable row level security;
revoke all on table public.complete_power_outage_contact_discovery_website_v3_results
  from public, anon, authenticated;
grant all on table public.complete_power_outage_contact_discovery_website_v3_results
  to service_role;

create or replace function public.complete_power_outage_contact_domain_matches_company_v3(
  requested_domain text,
  requested_company_name text
)
returns boolean
language sql
stable
strict
set search_path = ''
as $$
  with normalized as (
    select
      regexp_replace(
        regexp_replace(lower(btrim(requested_domain)), '^www\.', ''),
        '[^a-z0-9]', '', 'g'
      ) as domain_flat,
      regexp_replace(
        lower(public.unaccent(btrim(requested_company_name))),
        '[^[:alnum:]]+', ' ', 'g'
      ) as company_name
  ), tokens as (
    select token
    from normalized,
      regexp_split_to_table(company_name, '[[:space:]]+') token
    where token <> ''
      and token not in (
        'a', 'as', 'cz', 'czech', 'firma', 'group', 'holding', 'k', 'ks',
        'o', 'podnik', 'r', 's', 'se', 'sp', 'spol', 'spolecnost', 'sro',
        'statni', 'v', 'vos'
      )
  )
  select coalesce(bool_or(
    (length(token) >= 4 and position(token in domain_flat) > 0)
    or (
      length(token) = 3
      and (domain_flat = token or domain_flat like token || '%')
    )
  ), false)
  from normalized, tokens;
$$;

create or replace function public.refresh_complete_power_outage_contact_discovery_website_v3()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $$
declare
  processed_count bigint;
  verified_count bigint;
  review_count bigint;
  missing_count bigint;
begin
  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
      and (
        state_row.contact_extraction_enabled
        or state_row.ui_enabled
        or state_row.email_planning_enabled
        or state_row.email_dispatch_enabled
      )
  ) then
    raise exception 'V3 SHADOW nelze spustit pri aktivni kontaktni nebo e-mailove fazi.';
  end if;

  with domain_usage as (
    select result_row.normalized_domain, count(distinct result_row.ico)::integer as company_count
    from public.complete_power_outage_contact_discovery_website_v2_results result_row
    where result_row.result_status in ('verified_company', 'verified_group')
      and result_row.normalized_domain is not null
    group by result_row.normalized_domain
  ), enriched as (
    select
      v2.ico,
      v2.company_profile_id,
      v2.result_status as v2_result_status,
      v2.candidate_url,
      v2.normalized_domain,
      v2.confidence,
      'exact_ico_on_website' = any(v2.verification_methods) as exact_ico_evidence,
      'same_domain_email' = any(v2.verification_methods) as same_domain_email_evidence,
      coalesce(public.complete_power_outage_contact_domain_matches_company_v3(
        v2.normalized_domain,
        profile.official_name
      ), false) as first_party_domain_match,
      coalesce(domain_usage.company_count, 0) as shared_domain_count,
      policy.policy_type,
      policy.reason as policy_reason,
      v2.reason_codes as v2_reason_codes,
      v2.evidence as v2_evidence
    from public.complete_power_outage_contact_discovery_website_v2_results v2
    join public.complete_power_outage_company_profiles profile
      on profile.id = v2.company_profile_id and profile.ico = v2.ico
    left join domain_usage on domain_usage.normalized_domain = v2.normalized_domain
    left join lateral (
      select domain_policy.policy_type, domain_policy.reason
      from public.complete_power_outage_contact_discovery_domain_policies domain_policy
      where v2.normalized_domain = domain_policy.normalized_domain
        or v2.normalized_domain like '%.' || domain_policy.normalized_domain
      order by length(domain_policy.normalized_domain) desc
      limit 1
    ) policy on true
  ), classified as (
    select
      enriched.*,
      case
        when v2_result_status = 'no_website' then 'no_website'
        when v2_result_status not in ('verified_company', 'verified_group') then 'needs_review'
        when policy_type = 'third_party_directory' then 'needs_review'
        when v2_result_status = 'verified_group' then 'needs_review'
        when shared_domain_count <> 1 then 'needs_review'
        when not exact_ico_evidence then 'needs_review'
        when not same_domain_email_evidence then 'needs_review'
        when not first_party_domain_match then 'needs_review'
        else 'verified_company'
      end as result_status,
      case
        when v2_result_status not in ('verified_company', 'verified_group')
          then coalesce(v2_reason_codes, '{}'::text[])
        else array_remove(array[
          case when policy_type = 'third_party_directory' then 'third_party_directory_domain' end,
          case when v2_result_status = 'verified_group' then 'group_relationship_not_proven_v3' end,
          case when shared_domain_count <> 1 then 'domain_shared_by_multiple_icos' end,
          case when not exact_ico_evidence then 'exact_ico_evidence_required_v3' end,
          case when not same_domain_email_evidence then 'same_domain_email_required_v3' end,
          case when not first_party_domain_match then 'company_domain_identity_mismatch' end
        ]::text[], null)
      end as decision_codes
    from enriched
  )
  insert into public.complete_power_outage_contact_discovery_website_v3_results (
    ico, company_profile_id, result_status, v2_result_status,
    candidate_url, normalized_domain, confidence,
    exact_ico_evidence, same_domain_email_evidence, first_party_domain_match,
    shared_domain_count, decision_codes, evidence, evaluated_at
  )
  select
    classified.ico,
    classified.company_profile_id,
    classified.result_status,
    classified.v2_result_status,
    classified.candidate_url,
    classified.normalized_domain,
    case when classified.result_status = 'verified_company' then classified.confidence else 0 end,
    classified.exact_ico_evidence,
    classified.same_domain_email_evidence,
    classified.first_party_domain_match,
    classified.shared_domain_count,
    classified.decision_codes,
    jsonb_build_object(
      'contract', 'complete-contact-official-website-v3-shadow',
      'sourceContract', 'complete-contact-official-website-v2-shadow',
      'externalRequestsPerformed', false,
      'rawHtmlStored', false,
      'contactsPersisted', false,
      'v2EvidencePreserved', true,
      'domainPolicyType', classified.policy_type,
      'domainPolicyReason', classified.policy_reason,
      'v2Evidence', classified.v2_evidence
    ),
    now()
  from classified
  on conflict (ico) do update
  set company_profile_id = excluded.company_profile_id,
      result_status = excluded.result_status,
      v2_result_status = excluded.v2_result_status,
      candidate_url = excluded.candidate_url,
      normalized_domain = excluded.normalized_domain,
      confidence = excluded.confidence,
      exact_ico_evidence = excluded.exact_ico_evidence,
      same_domain_email_evidence = excluded.same_domain_email_evidence,
      first_party_domain_match = excluded.first_party_domain_match,
      shared_domain_count = excluded.shared_domain_count,
      decision_codes = excluded.decision_codes,
      evidence = excluded.evidence,
      evaluated_at = excluded.evaluated_at;

  delete from public.complete_power_outage_contact_discovery_website_v3_results v3
  where not exists (
    select 1
    from public.complete_power_outage_contact_discovery_website_v2_results v2
    where v2.ico = v3.ico
  );

  select count(*),
    count(*) filter (where result_status = 'verified_company'),
    count(*) filter (where result_status = 'needs_review'),
    count(*) filter (where result_status = 'no_website')
  into processed_count, verified_count, review_count, missing_count
  from public.complete_power_outage_contact_discovery_website_v3_results;

  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = false,
      website_lookup_enabled = false,
      website_verification_v2_enabled = false,
      website_verification_v3_enabled = true,
      contact_extraction_enabled = false,
      ui_enabled = false,
      email_planning_enabled = false,
      email_dispatch_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'websiteVerificationV3Contract', 'complete-contact-official-website-v3-shadow',
        'websiteVerificationV3EvaluatedAt', now(),
        'websiteVerificationV3ProcessedCount', processed_count,
        'websiteVerificationV3ExternalRequests', 0,
        'websiteVerificationV3Source', 'stored-v2-evidence'
      )
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'processedCount', processed_count,
    'verifiedCompanyCount', verified_count,
    'needsReviewCount', review_count,
    'noWebsiteCount', missing_count,
    'externalRequestCount', 0,
    'evaluatedAt', now()
  );
end;
$$;

revoke all on function public.complete_power_outage_contact_domain_matches_company_v3(text,text)
  from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_contact_discovery_website_v3()
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_contact_domain_matches_company_v3(text,text)
  to service_role;
grant execute on function public.refresh_complete_power_outage_contact_discovery_website_v3()
  to service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete_contact_discovery_websites_v2_every_fifteen_seconds'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end
$$;

select public.refresh_complete_power_outage_contact_discovery_website_v3();

notify pgrst, 'reload schema';
commit;
