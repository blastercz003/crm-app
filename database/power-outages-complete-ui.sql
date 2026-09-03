begin;

create or replace view public.complete_power_outage_company_overview
with (security_invoker = true)
as
select
  company.id as candidate_id,
  company.outage_address_id,
  address.outage_id,
  outage.source,
  outage.external_id,
  outage.source_status,
  outage.title,
  outage.description,
  outage.starts_at,
  outage.ends_at,
  outage.archive_at,
  outage.source_url,
  outage.announcement_url,
  outage.first_seen_at,
  outage.last_seen_at,
  address.address_scope,
  address.municipality,
  address.town_part,
  address.street,
  address.house_number,
  address.orientation_number,
  address.postal_code,
  address.raw_address,
  address.latitude as address_latitude,
  address.longitude as address_longitude,
  company.company_name,
  company.ico,
  company.legal_form,
  company.nace_codes,
  company.employee_category,
  company.entity_kind,
  company.display_address,
  company.latitude,
  company.longitude,
  company.confidence,
  company.candidate_status,
  company.source_count,
  company.evaluation_version,
  company.evaluation_reasons,
  company.evaluated_at,
  company.resolved_at,
  company.metadata,
  coalesce((
    select array_agg(distinct evidence.provider order by evidence.provider)
    from public.complete_power_outage_company_evidence evidence
    where evidence.company_id = company.id
  ), '{}'::text[]) as evidence_providers,
  (select count(*)::integer
   from public.complete_power_outage_company_evidence evidence
   where evidence.company_id = company.id) as evidence_count,
  company.business_relevance_status,
  company.business_relevance_version,
  company.business_relevance_reasons,
  company.business_relevance_evaluated_at
from public.complete_power_outage_companies company
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id;

comment on view public.complete_power_outage_company_overview is
  'Read-only přehled kandidátních firem pro UI režimu KOMPLETNÍ; RLS se vyhodnocuje na zdrojových tabulkách.';

revoke all on table public.complete_power_outage_company_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_overview to authenticated;

create or replace view public.complete_power_outage_provider_overview
with (security_invoker = true)
as
select
  quota.provider,
  coalesce(counts.ready_count, 0)::integer as ready_count,
  coalesce(counts.pending_count, 0)::integer as pending_count,
  coalesce(counts.not_found_count, 0)::integer as not_found_count,
  coalesce(counts.error_count, 0)::integer as error_count,
  quota.minute_request_count,
  quota.day_request_count,
  quota.last_request_at
from public.complete_power_outage_provider_quota quota
left join lateral (
  select
    count(*) filter (where lookup.lookup_status = 'ready') as ready_count,
    count(*) filter (where lookup.lookup_status = 'pending') as pending_count,
    count(*) filter (where lookup.lookup_status = 'not_found') as not_found_count,
    count(*) filter (where lookup.lookup_status = 'error') as error_count
  from public.complete_power_outage_target_lookups lookup
  where lookup.provider = quota.provider
) counts on true
where quota.provider in ('ares', 'mapy', 'google');

revoke all on table public.complete_power_outage_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_provider_overview to authenticated;

commit;
