begin;

create or replace function public.get_complete_power_outage_contact_detail_v1(
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
  transport_security text
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
    classification.contact_type,
    classification.normalized_value,
    classification.contact_class,
    classification.classification_status,
    classification.notification_eligible,
    classification.is_primary,
    classification.normalized_domain,
    extracted.source_url,
    classification.transport_security
  from public.complete_power_outage_companies candidate
  join public.complete_power_outage_contact_classification_v2_shadow classification
    on classification.ico = candidate.ico
  join public.complete_power_outage_contact_extraction_shadow_results extracted
    on extracted.id = classification.shadow_contact_id
   and extracted.ico = classification.ico
   and extracted.company_profile_id = classification.company_profile_id
  where candidate.id = requested_candidate_id
    and candidate.candidate_status = 'confirmed'
  order by
    classification.contact_type,
    classification.is_primary desc,
    classification.priority,
    classification.normalized_value;
end;
$$;

revoke all on function public.get_complete_power_outage_contact_detail_v1(uuid)
  from public, anon;
grant execute on function public.get_complete_power_outage_contact_detail_v1(uuid)
  to authenticated, service_role;

update public.complete_power_outage_contact_discovery_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'contactDetailUiEnabled', true,
      'contactDetailUiVersion', 1,
      'contactManagementUiEnabled', false,
      'contactReviewDecisionUiEnabled', false,
      'contactDetailReviewDefaultVisibility', 'collapsed',
      'contactDetailContract', 'complete-contact-detail-v1',
      'contactDetailActivatedAt', now()
    ),
    updated_at = now()
where singleton;

commit;
