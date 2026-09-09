begin;

do $$
begin
  if to_regprocedure('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)') is null
     or to_regclass('public.complete_power_outage_company_scores') is null then
    raise exception 'Chybí aktivovaná vrstva AI SELECT.';
  end if;
end
$$;

create or replace function public.get_complete_power_outage_company_page_v4(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
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
  if p_sort = 'date' then
    return public.get_complete_power_outage_company_page_v3(
      p_mode, p_limit, p_cursor_at, p_cursor_id, p_query, p_owner_filter,
      p_source, p_entity_kind, p_candidate_status, p_commercial_filter
    );
  end if;
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_sort <> 'score' then raise exception 'Neplatné řazení obchodního výběru.'; end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_commercial_filter not in ('all', 'top', 'grade_a', 'grade_b') then raise exception 'Neplatný obchodní výběr.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  with page_rows as materialized (
    select company.id as candidate_id,
      case when p_mode = 'current' then outage.starts_at else outage.ends_at end as sort_at,
      coalesce(score_row.score, -1) as sort_score
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
    left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
    where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
      and company.business_relevance_status = 'eligible'
      and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
        or (p_mode = 'archive' and outage.ends_at < now()))
      and (p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review')
        or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status)
      and (p_source = 'all' or outage.source::text = p_source)
      and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
      and (p_commercial_filter = 'all' or score_row.score_status in ('complete', 'preliminary') and (
        p_commercial_filter = 'top' and score_row.selection_eligible
        or p_commercial_filter = 'grade_a' and score_row.grade = 'A'
        or p_commercial_filter = 'grade_b' and score_row.grade = 'B'))
      and (p_owner_filter = 'all'
        or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
        or p_owner_filter = 'unassigned' and assignment.owner_id is null
        or selected_owner is not null and assignment.owner_id = selected_owner)
      and (clean_query = ''
        or company.company_name ilike '%' || clean_query || '%'
        or coalesce(company.ico, '') ilike '%' || clean_query || '%'
        or address.municipality ilike '%' || clean_query || '%'
        or address.street ilike '%' || clean_query || '%'
        or address.raw_address ilike '%' || clean_query || '%'
        or coalesce(company.display_address, '') ilike '%' || clean_query || '%')
      and (p_cursor_at is null or p_cursor_id is null or p_cursor_score is null or (
        coalesce(score_row.score, -1) < p_cursor_score
        or coalesce(score_row.score, -1) = p_cursor_score and p_mode = 'current'
          and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
        or coalesce(score_row.score, -1) = p_cursor_score and p_mode = 'archive'
          and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id)))
    order by coalesce(score_row.score, -1) desc,
      case when p_mode = 'current' then outage.starts_at end asc,
      case when p_mode = 'archive' then outage.ends_at end desc,
      case when p_mode = 'current' then company.id end asc,
      case when p_mode = 'archive' then company.id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select * from page_rows
    order by sort_score desc,
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select row_number() over (order by visible_rows.sort_score desc,
        case when p_mode = 'current' then visible_rows.sort_at end asc,
        case when p_mode = 'archive' then visible_rows.sort_at end desc,
        case when p_mode = 'current' then visible_rows.candidate_id end asc,
        case when p_mode = 'archive' then visible_rows.candidate_id end desc) as position,
      visible_rows.sort_at, visible_rows.sort_score, visible_rows.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id,
        'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status,
        'notes', assignment.notes,
        'claimed_at', assignment.claimed_at,
        'assignment_updated_at', assignment.updated_at,
        'commercial_score', score_row.score,
        'commercial_grade', score_row.grade,
        'commercial_selection_eligible', coalesce(score_row.selection_eligible, false),
        'commercial_score_status', score_row.score_status
      ) as item
    from visible_rows
    join public.complete_power_outage_company_overview overview on overview.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = visible_rows.candidate_id
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by position) from serialized), '[]'::jsonb),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (select jsonb_build_object('at', sort_at, 'id', candidate_id, 'score', sort_score) from serialized order by position desc limit 1)
  ) into result;
  return result;
end;
$$;

create or replace function public.get_complete_power_outage_commercial_selection_counts(
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
    'top', count(*) filter (where score_row.score_status in ('complete', 'preliminary') and score_row.selection_eligible),
    'gradeA', count(*) filter (where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'),
    'gradeB', count(*) filter (where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B')
  ) into result
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active')) or (p_mode = 'archive' and outage.ends_at < now()))
    and (p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review') or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status)
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (p_owner_filter = 'all' or p_owner_filter = 'mine' and assignment.owner_id = current_user_id or p_owner_filter = 'unassigned' and assignment.owner_id is null or selected_owner is not null and assignment.owner_id = selected_owner)
    and (clean_query = '' or company.company_name ilike '%' || clean_query || '%' or coalesce(company.ico, '') ilike '%' || clean_query || '%' or address.municipality ilike '%' || clean_query || '%' or address.street ilike '%' || clean_query || '%' or address.raw_address ilike '%' || clean_query || '%' or coalesce(company.display_address, '') ilike '%' || clean_query || '%');
  return result;
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text) to authenticated;
revoke all on function public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text) from public, anon;
grant execute on function public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text) to authenticated;

update public.complete_power_outage_commercial_selection_state
set metadata = metadata || jsonb_build_object(
  'uiContract', 'complete-commercial-selection-ui-v2',
  'defaultFilter', 'all',
  'defaultSort', 'date',
  'countsRespectBaseFilters', true,
  'countsAndSortingActivatedAt', now()
)
where singleton and scoring_enabled and ui_enabled;

do $$
begin
  if not exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and scoring_enabled and ui_enabled
      and metadata ->> 'uiContract' = 'complete-commercial-selection-ui-v2'
  ) then
    raise exception 'Rozšířené ovládání AI SELECT nelze aktivovat.';
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
