begin;

-- Volitelný uživatelský filtr POUZE ODSTÁVKY KLIENTŮ.
-- Vypnutý režim deleguje beze změny na bezpečné v6. Zapnutý režim používá
-- pouze klienty dostupné právě přihlášenému uživateli a zachovává TOP/A/B,
-- hledání, distributora, stav, typ i vlastníka jako další závazné filtry.
do $$
begin
  if to_regprocedure(
       'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
     ) is null
     or to_regprocedure(
       'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'
     ) is null
     or to_regclass('public.complete_power_outage_client_links') is null
     or to_regprocedure('public.current_user_can_view_client(uuid)') is null
  then
    raise exception 'Chybí dokončená etapa 3 klientské priority.';
  end if;
end
$$;

create or replace function public.get_complete_power_outage_company_page_v8(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
  p_cursor_client_priority boolean default null,
  p_clients_only boolean default false,
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all',
  p_sort text default 'date'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_limit integer := least(100, greatest(1, coalesce(p_limit, 60)));
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result jsonb;
begin
  if not coalesce(p_clients_only, false) then
    return public.get_complete_power_outage_company_page_v6(
      p_mode, p_limit, p_cursor_at, p_cursor_id, p_cursor_score, p_query,
      p_owner_filter, p_source, p_entity_kind, p_candidate_status,
      p_commercial_filter, p_sort
    );
  end if;

  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_sort not in ('date', 'score') then raise exception 'Neplatné řazení obchodního výběru.'; end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_commercial_filter not in ('all', 'top', 'grade_a', 'grade_b') then raise exception 'Neplatný obchodní výběr.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;
  if p_cursor_at is not null and p_cursor_id is null then
    raise exception 'Neúplný kurzor stránkování klientů.';
  end if;
  if p_cursor_at is not null and p_sort = 'score' and p_cursor_score is null then
    raise exception 'Kurzor řazení podle skóre neobsahuje skóre.';
  end if;

  with page_rows as materialized (
    select
      company.id as candidate_id,
      case when p_mode = 'current' then outage.starts_at else outage.ends_at end as sort_at,
      coalesce(score_row.score, -1) as sort_score,
      client_match.match_count,
      client_match.match_method
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
    join lateral (
      select
        count(*)::integer as match_count,
        (array_agg(link.match_method order by
          case link.match_method
            when 'ico_exact' then 0
            when 'name_exact' then 1
            else 2
          end
        ))[1] as match_method
      from public.complete_power_outage_client_links link
      where link.candidate_id = company.id
        and public.current_user_can_view_client(link.client_id)
      having count(*) > 0
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
        p_commercial_filter = 'all'
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
      )
      and (
        p_cursor_at is null
        or p_cursor_id is null
        or p_sort = 'date' and (
          p_mode = 'current' and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
          or p_mode = 'archive' and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id)
        )
        or p_sort = 'score' and p_cursor_score is not null and (
          coalesce(score_row.score, -1) < p_cursor_score
          or coalesce(score_row.score, -1) = p_cursor_score
            and p_mode = 'current'
            and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
          or coalesce(score_row.score, -1) = p_cursor_score
            and p_mode = 'archive'
            and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id)
        )
      )
    order by
      case when p_sort = 'score' then coalesce(score_row.score, -1) end desc,
      case when p_mode = 'current' then outage.starts_at end asc,
      case when p_mode = 'archive' then outage.ends_at end desc,
      case when p_mode = 'current' then company.id end asc,
      case when p_mode = 'archive' then company.id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select *
    from page_rows
    order by
      case when p_sort = 'score' then sort_score end desc,
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select
      row_number() over (order by
        case when p_sort = 'score' then visible_rows.sort_score end desc,
        case when p_mode = 'current' then visible_rows.sort_at end asc,
        case when p_mode = 'archive' then visible_rows.sort_at end desc,
        case when p_mode = 'current' then visible_rows.candidate_id end asc,
        case when p_mode = 'archive' then visible_rows.candidate_id end desc
      ) as position,
      visible_rows.sort_at,
      visible_rows.sort_score,
      visible_rows.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id,
        'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status,
        'notes', assignment.notes,
        'claimed_at', assignment.claimed_at,
        'assignment_updated_at', assignment.updated_at,
        'commercial_score', score_row.score,
        'commercial_grade', score_row.grade,
        'commercial_selection_eligible', coalesce(top_row.top_eligible, false),
        'commercial_score_status', score_row.score_status,
        'has_linked_job', coalesce(job_link.match_count, 0) > 0,
        'linked_job_count', coalesce(job_link.match_count, 0),
        'is_accessible_client', true,
        'accessible_client_match_count', visible_rows.match_count,
        'accessible_client_match_method', visible_rows.match_method
      ) as item
    from visible_rows
    join public.complete_power_outage_company_overview overview
      on overview.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_scores score_row
      on score_row.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_top_selections top_row
      on top_row.candidate_id = visible_rows.candidate_id
    left join lateral (
      select count(*)::integer as match_count
      from public.complete_power_outage_job_links job_link_row
      where job_link_row.candidate_id = visible_rows.candidate_id
    ) job_link on true
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by position) from serialized),
      '[]'::jsonb
    ),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (
      select jsonb_build_object(
        'at', sort_at,
        'id', candidate_id,
        'score', sort_score,
        'clientPriority', true
      )
      from serialized
      order by position desc
      limit 1
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.count_complete_power_outage_companies_v5(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all',
  p_clients_only boolean default false
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
  if not coalesce(p_clients_only, false) then
    return public.count_complete_power_outage_companies_v3(
      p_mode, p_query, p_owner_filter, p_source, p_entity_kind,
      p_candidate_status, p_commercial_filter
    );
  end if;

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
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and exists (
      select 1
      from public.complete_power_outage_client_links link
      where link.candidate_id = company.id
        and public.current_user_can_view_client(link.client_id)
    )
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
      p_commercial_filter = 'all'
      or p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
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

create or replace function public.get_complete_power_outage_commercial_selection_counts_v4(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_clients_only boolean default false
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
  if not coalesce(p_clients_only, false) then
    return public.get_complete_power_outage_commercial_selection_counts_v2(
      p_mode, p_query, p_owner_filter, p_source, p_entity_kind,
      p_candidate_status
    );
  end if;

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
    'top', count(*) filter (where coalesce(top_row.top_eligible, false)),
    'gradeA', count(*) filter (
      where score_row.score_status in ('complete', 'preliminary')
        and score_row.grade = 'A'
    ),
    'gradeB', count(*) filter (
      where score_row.score_status in ('complete', 'preliminary')
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
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and exists (
      select 1
      from public.complete_power_outage_client_links link
      where link.candidate_id = company.id
        and public.current_user_can_view_client(link.client_id)
    )
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

revoke all on function public.get_complete_power_outage_company_page_v8(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) from public, anon;
revoke all on function public.count_complete_power_outage_companies_v5(
  text,text,text,text,text,text,text,boolean
) from public, anon;
revoke all on function public.get_complete_power_outage_commercial_selection_counts_v4(
  text,text,text,text,text,text,boolean
) from public, anon;

grant execute on function public.get_complete_power_outage_company_page_v8(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) to authenticated;
grant execute on function public.count_complete_power_outage_companies_v5(
  text,text,text,text,text,text,text,boolean
) to authenticated;
grant execute on function public.get_complete_power_outage_commercial_selection_counts_v4(
  text,text,text,text,text,text,boolean
) to authenticated;

update public.complete_power_outage_client_priority_state
set metadata = metadata || jsonb_build_object(
      'clientFilterContract', 'complete-client-only-filter-v1',
      'clientFilterActivatedAt', now(),
      'clientFilterDefault', false,
      'clientFilterPageFunction', 'get_complete_power_outage_company_page_v8',
      'clientFilterCountFunction', 'count_complete_power_outage_companies_v5',
      'clientFilterSelectionCountsFunction', 'get_complete_power_outage_commercial_selection_counts_v4',
      'clientFilterRespectsCommercialSelection', true,
      'clientFilterRespectsOtherTableFilters', true
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
