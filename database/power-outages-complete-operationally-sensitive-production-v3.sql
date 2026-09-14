begin;

-- Krok 5: produkcni zapojeni finalniho klasifikatoru PROVOZNE CITLIVE v3.
-- Vyber je dynamicky; nevytvari staticky seznam a nemeni runtime odesilani.
do $$
begin
  if to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v3(uuid)') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_state') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_runs') is null
     or to_regclass('public.complete_power_outage_contact_discovery_selectors') is null
     or to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is null
     or to_regprocedure('public.complete_power_outage_is_large_company_v1(text)') is null
     or to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)') is null
     or to_regprocedure('public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)') is null
  then
    raise exception 'Chybi zavislosti pro produkcni zapojeni PROVOZNE CITLIVE v3.';
  end if;
  if not exists (
    select 1
    from public.complete_power_outage_operational_sensitivity_state state
    join public.complete_power_outage_operational_sensitivity_shadow_runs run
      on run.id = state.latest_shadow_run_id
    where state.singleton
      and state.rules_version = 3
      and state.rules_prepared
      and state.shadow_enabled
      and run.rules_version = 3
      and run.status = 'complete'
  ) then
    raise exception 'Finalni SHADOW audit PROVOZNE CITLIVE v3 neni dokoncen.';
  end if;
end
$$;

create or replace function public.complete_power_outage_is_operationally_sensitive_v3(
  requested_candidate_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.complete_power_outage_operational_sensitivity_state state
    join public.complete_power_outage_companies company
      on company.id = requested_candidate_id
     and company.candidate_status = 'confirmed'
     and company.business_relevance_status = 'eligible'
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
     and outage.ends_at >= now()
     and outage.source_status in ('scheduled', 'active')
    cross join lateral public.classify_complete_power_outage_operational_sensitivity_v3(
      requested_candidate_id
    ) decision
    where state.singleton
      and state.rules_version = 3
      and state.rules_prepared
      and state.selector_enabled
      and decision.is_eligible
  );
$$;

revoke all on function public.complete_power_outage_is_operationally_sensitive_v3(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_is_operationally_sensitive_v3(uuid)
  to service_role;

insert into public.complete_power_outage_contact_discovery_selectors (
  selector_key,
  display_name,
  commercial_filter,
  selection_version_key,
  lifecycle_status,
  selector_contract
)
values (
  'operationally_sensitive_v3',
  'PROVOZNĚ CITLIVÉ',
  'operationally_sensitive',
  null,
  'active',
  jsonb_build_object(
    'contract', 'complete-operational-sensitivity-selector-v3',
    'candidateStatus', 'confirmed',
    'currentOutagesOnly', true,
    'eligibleBusinessOnly', true,
    'dynamicClassifier', 'classify_complete_power_outage_operational_sensitivity_v3',
    'missingMapyDisposition', 'neutral',
    'requiresValidIcoForContactOrNotification', true,
    'source', 'ares-and-exact-mapy-evidence'
  )
)
on conflict (selector_key) do update
set display_name = excluded.display_name,
    commercial_filter = excluded.commercial_filter,
    selection_version_key = excluded.selection_version_key,
    lifecycle_status = excluded.lifecycle_status,
    selector_contract = excluded.selector_contract,
    updated_at = now();

update public.complete_power_outage_operational_sensitivity_state
set selector_enabled = true,
    ui_enabled = true,
    contact_selector_enabled = true,
    notification_selector_enabled = true,
    metadata = metadata || jsonb_build_object(
      'productionContract', 'complete-operational-sensitivity-production-v3',
      'productionEnabledAt', now(),
      'dynamicFutureMembership', true,
      'contactsEnabled', true,
      'notificationsEnabled', true,
      'emailRuntimeChanged', false
    ),
    updated_at = now()
where singleton
  and rules_version = 3
  and rules_prepared;

create or replace view public.complete_power_outage_contact_discovery_selector_targets
with (security_invoker = true)
as
with eligible_candidates as (
  select
    selector_row.selector_key,
    selector_row.display_name as selector_display_name,
    selector_row.commercial_filter,
    selector_row.selection_version_key,
    selector_row.selector_contract,
    company.id as candidate_id,
    company.ico,
    company.company_name,
    outage.id as outage_id,
    outage.source,
    outage.starts_at,
    outage.ends_at
  from public.complete_power_outage_contact_discovery_selectors selector_row
  join public.complete_power_outage_companies company
    on company.candidate_status = 'confirmed'
   and company.business_relevance_status = 'eligible'
   and company.ico is not null
   and company.ico ~ '^[0-9]{8}$'
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  left join public.complete_power_outage_top_selection_versions top_version
    on top_version.version_key = selector_row.selection_version_key
  where selector_row.lifecycle_status = 'active'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
    and (
      selector_row.commercial_filter = 'all'
      or selector_row.commercial_filter = 'grade_a'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
      or selector_row.commercial_filter = 'grade_b'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'B'
      or selector_row.commercial_filter = 'top'
        and top_version.lifecycle_status in ('active', 'archived')
        and top_row.rules_version = top_version.internal_rules_version
        and top_row.evaluation_status = 'eligible'
        and top_row.top_eligible
      or selector_row.commercial_filter = 'large_companies'
        and public.complete_power_outage_is_large_company_v1(company.ico)
      or selector_row.commercial_filter = 'operationally_sensitive'
        and exists (
          select 1
          from public.complete_power_outage_operational_sensitivity_state state
          where state.singleton
            and state.contact_selector_enabled
            and state.notification_selector_enabled
        )
        and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
    )
), aggregated as (
  select
    candidate.selector_key,
    candidate.selector_display_name,
    candidate.commercial_filter,
    candidate.selection_version_key,
    candidate.selector_contract,
    candidate.ico,
    (array_agg(candidate.company_name order by candidate.starts_at, candidate.candidate_id))[1]
      as representative_company_name,
    (array_agg(candidate.candidate_id order by candidate.starts_at, candidate.candidate_id))[1]
      as representative_candidate_id,
    count(distinct candidate.candidate_id)::integer as candidate_count,
    count(distinct candidate.outage_id)::integer as outage_count,
    min(candidate.starts_at) as nearest_outage_starts_at,
    max(candidate.ends_at) as latest_outage_ends_at,
    array_agg(distinct candidate.source order by candidate.source) as outage_sources
  from eligible_candidates candidate
  group by candidate.selector_key, candidate.selector_display_name,
    candidate.commercial_filter, candidate.selection_version_key,
    candidate.selector_contract, candidate.ico
)
select
  aggregated.selector_key,
  aggregated.selector_display_name,
  aggregated.commercial_filter,
  aggregated.selection_version_key,
  aggregated.ico,
  profile.id as company_profile_id,
  coalesce(profile.official_name, aggregated.representative_company_name) as company_name,
  aggregated.representative_candidate_id,
  aggregated.candidate_count,
  aggregated.outage_count,
  aggregated.nearest_outage_starts_at,
  aggregated.latest_outage_ends_at,
  aggregated.outage_sources,
  profile.id is not null as has_company_profile,
  aggregated.selector_contract
from aggregated
left join public.complete_power_outage_company_profiles profile
  on profile.ico = aggregated.ico;

revoke all on table public.complete_power_outage_contact_discovery_selector_targets
  from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_discovery_selector_targets
  to service_role;

create or replace function public.get_cpo_communication_filtered_scope_v1(
  p_mode text,
  p_clients_only boolean,
  p_query text,
  p_owner_filter text,
  p_source text,
  p_entity_kind text,
  p_communication_status text,
  p_commercial_filter text
)
returns table (
  candidate_id uuid,
  sort_at timestamptz,
  sort_score integer,
  is_client_priority boolean,
  client_match_count integer,
  client_match_method text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemate opravneni zobrazit kompletni odstavky.' using errcode = '42501';
  end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatny rezim vypisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatny distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatny typ firmy.'; end if;
  if p_communication_status not in ('all', 'not_contacted', 'contacted', 'unreachable', 'interested', 'offer_sent', 'job_won', 'closed_no_job') then raise exception 'Neplatny stav komunikace.'; end if;
  if p_commercial_filter not in ('all', 'top', 'large_companies', 'grade_a', 'grade_b', 'operationally_sensitive') then raise exception 'Neplatny obchodni vyber.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatny filtr vlastnika.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;
  if selected_owner is not null then
    if not public.current_user_is_admin() then
      raise exception 'Filtr ostatnich vlastniku je dostupny pouze administratorovi.' using errcode = '42501';
    end if;
    if selected_owner not in (
      '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid,
      '735d158c-667a-42c0-8af0-6ee12a9c1f11'::uuid
    ) then
      raise exception 'Tento vlastnik neni pro filtr KOMPLETNI povolen.' using errcode = '42501';
    end if;
  end if;

  return query
  select
    company.id,
    case when p_mode = 'current' then outage.starts_at else outage.ends_at end,
    coalesce(score_row.score, -1),
    coalesce(client_match.is_client, false),
    coalesce(client_match.match_count, 0),
    client_match.match_method
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
  left join public.complete_power_outage_communication_states communication on communication.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = company.id
  left join lateral (
    select true as is_client, count(*)::integer as match_count,
      (array_agg(link.match_method order by case link.match_method when 'ico_exact' then 0 when 'name_exact' then 1 else 2 end))[1] as match_method
    from public.complete_power_outage_client_links link
    where link.candidate_id = company.id
      and public.current_user_can_view_client(link.client_id)
    having count(*) > 0
  ) client_match on true
  where company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
      or (p_mode = 'archive' and outage.ends_at < now()))
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (p_communication_status = 'all'
      or p_communication_status = 'not_contacted' and coalesce(communication.communication_status, 'not_contacted') = 'not_contacted'
      or p_communication_status <> 'not_contacted' and communication.communication_status = p_communication_status)
    and (
      coalesce(p_clients_only, false) and coalesce(client_match.is_client, false)
      or not coalesce(p_clients_only, false) and (
        p_commercial_filter = 'all'
        or p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
        or p_commercial_filter = 'grade_a' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
        or p_commercial_filter = 'grade_b' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'
        or p_commercial_filter = 'large_companies'
          and company.candidate_status = 'confirmed'
          and public.complete_power_outage_is_large_company_v1(company.ico)
        or p_commercial_filter = 'operationally_sensitive'
          and company.candidate_status = 'confirmed'
          and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
      )
    )
    and (p_owner_filter = 'all'
      or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
      or p_owner_filter = 'unassigned' and assignment.owner_id is null
      or selected_owner is not null and assignment.owner_id = selected_owner)
    and (clean_query = '' or company.company_name ilike '%' || clean_query || '%'
      or coalesce(company.ico, '') ilike '%' || clean_query || '%'
      or address.municipality ilike '%' || clean_query || '%'
      or address.street ilike '%' || clean_query || '%'
      or address.raw_address ilike '%' || clean_query || '%'
      or coalesce(company.display_address, '') ilike '%' || clean_query || '%');
end;
$$;

create or replace function public.get_complete_power_outage_commercial_selection_counts_v5(
  p_mode text default 'current', p_query text default '', p_owner_filter text default 'all',
  p_source text default 'all', p_entity_kind text default 'all',
  p_communication_status text default 'all', p_clients_only boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with scope as materialized (
    select candidate_id
    from public.get_cpo_communication_filtered_scope_v1(
      p_mode, p_clients_only, p_query, p_owner_filter, p_source,
      p_entity_kind, p_communication_status, 'all'
    )
  )
  select jsonb_build_object(
    'all', count(*),
    'top', count(*) filter (where coalesce(top_row.top_eligible, false)),
    'largeCompanies', count(*) filter (
      where company.candidate_status = 'confirmed'
        and public.complete_power_outage_is_large_company_v1(company.ico)
    ),
    'operationallySensitive', count(*) filter (
      where company.candidate_status = 'confirmed'
        and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
    ),
    'gradeA', count(*) filter (
      where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
    ),
    'gradeB', count(*) filter (
      where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'
    )
  )
  from scope
  join public.complete_power_outage_companies company on company.id = scope.candidate_id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = scope.candidate_id
  left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = scope.candidate_id;
$$;

revoke all on function public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)
  from public, anon;
grant execute on function public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean)
  to authenticated;

notify pgrst, 'reload schema';
commit;
