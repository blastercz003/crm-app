begin;

-- ETAPA 3: aktivace uživatelsky izolované klientské priority v UI.
-- Klientské záznamy dostupné přihlášenému uživateli jsou součástí každého
-- výběru AI SELECT a stojí před ostatními výsledky. Ostatní filtry platí dál.
do $$
begin
  if to_regclass('public.complete_power_outage_client_links') is null
     or to_regclass('public.complete_power_outage_client_priority_state') is null
     or to_regprocedure(
       'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
     ) is null
     or to_regprocedure('public.current_user_can_view_client(uuid)') is null
  then
    raise exception 'Chybí úspěšně dokončená etapa 2 klientské priority.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_client_priority_state
    where singleton
      and matching_enabled
      and priority_query_enabled
      and last_status = 'succeeded'
      and last_success_at is not null
      and last_error_code is null
  ) then
    raise exception 'Klientské párování není v bezpečném stavu pro aktivaci UI.';
  end if;
end
$$;

create or replace function public.count_complete_power_outage_companies_v4(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all'
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result bigint;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_commercial_filter not in ('all', 'top', 'grade_a', 'grade_b') then raise exception 'Neplatný obchodní výběr.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  select count(*) into result
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment
    on assignment.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  left join lateral (
    select true as is_client_priority
    from public.complete_power_outage_client_links link
    where link.candidate_id = company.id
      and public.current_user_can_view_client(link.client_id)
    limit 1
  ) client_match on true
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and (
      (p_mode = 'current' and outage.ends_at >= now()
        and outage.source_status in ('scheduled', 'active'))
      or (p_mode = 'archive' and outage.ends_at < now())
    )
    and (
      p_candidate_status = 'visible'
        and company.candidate_status in ('confirmed', 'needs_review')
      or p_candidate_status <> 'visible'
        and company.candidate_status = p_candidate_status
    )
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (
      coalesce(client_match.is_client_priority, false)
      or p_commercial_filter = 'all'
      or p_commercial_filter = 'top'
        and coalesce(top_row.top_eligible, false)
      or p_commercial_filter = 'grade_a'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
      or p_commercial_filter = 'grade_b'
        and score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'B'
    )
    and (
      p_owner_filter = 'all'
      or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
      or p_owner_filter = 'unassigned' and assignment.owner_id is null
      or selected_owner is not null and assignment.owner_id = selected_owner
    )
    and (
      clean_query = ''
      or company.company_name ilike '%' || clean_query || '%'
      or coalesce(company.ico, '') ilike '%' || clean_query || '%'
      or address.municipality ilike '%' || clean_query || '%'
      or address.street ilike '%' || clean_query || '%'
      or address.raw_address ilike '%' || clean_query || '%'
      or coalesce(company.display_address, '') ilike '%' || clean_query || '%'
    );

  return result;
end;
$$;

create or replace function public.get_complete_power_outage_commercial_selection_counts_v3(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result jsonb;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  select jsonb_build_object(
    'all', count(*),
    'top', count(*) filter (
      where coalesce(client_match.is_client_priority, false)
        or coalesce(top_row.top_eligible, false)
    ),
    'gradeA', count(*) filter (
      where coalesce(client_match.is_client_priority, false)
        or score_row.score_status in ('complete', 'preliminary')
          and score_row.grade = 'A'
    ),
    'gradeB', count(*) filter (
      where coalesce(client_match.is_client_priority, false)
        or score_row.score_status in ('complete', 'preliminary')
          and score_row.grade = 'B'
    )
  ) into result
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address
    on address.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment
    on assignment.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row
    on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row
    on top_row.candidate_id = company.id
  left join lateral (
    select true as is_client_priority
    from public.complete_power_outage_client_links link
    where link.candidate_id = company.id
      and public.current_user_can_view_client(link.client_id)
    limit 1
  ) client_match on true
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and (
      (p_mode = 'current' and outage.ends_at >= now()
        and outage.source_status in ('scheduled', 'active'))
      or (p_mode = 'archive' and outage.ends_at < now())
    )
    and (
      p_candidate_status = 'visible'
        and company.candidate_status in ('confirmed', 'needs_review')
      or p_candidate_status <> 'visible'
        and company.candidate_status = p_candidate_status
    )
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (
      p_owner_filter = 'all'
      or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
      or p_owner_filter = 'unassigned' and assignment.owner_id is null
      or selected_owner is not null and assignment.owner_id = selected_owner
    )
    and (
      clean_query = ''
      or company.company_name ilike '%' || clean_query || '%'
      or coalesce(company.ico, '') ilike '%' || clean_query || '%'
      or address.municipality ilike '%' || clean_query || '%'
      or address.street ilike '%' || clean_query || '%'
      or address.raw_address ilike '%' || clean_query || '%'
      or coalesce(company.display_address, '') ilike '%' || clean_query || '%'
    );

  return result;
end;
$$;

revoke all on function public.count_complete_power_outage_companies_v4(
  text,text,text,text,text,text,text
) from public, anon;
revoke all on function public.get_complete_power_outage_commercial_selection_counts_v3(
  text,text,text,text,text,text
) from public, anon;
grant execute on function public.count_complete_power_outage_companies_v4(
  text,text,text,text,text,text,text
) to authenticated;
grant execute on function public.get_complete_power_outage_commercial_selection_counts_v3(
  text,text,text,text,text,text
) to authenticated;

update public.complete_power_outage_client_priority_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'uiContract', 'complete-client-priority-ui-v1',
      'uiActivatedAt', now(),
      'pageFunction', 'get_complete_power_outage_company_page_v7',
      'countFunction', 'count_complete_power_outage_companies_v4',
      'selectionCountsFunction', 'get_complete_power_outage_commercial_selection_counts_v3',
      'clientRowsOverrideCommercialSelection', true,
      'otherTableFiltersRemainBinding', true,
      'clientIdentifiersExposed', false
    ),
    updated_at = now()
where singleton;

commit;
