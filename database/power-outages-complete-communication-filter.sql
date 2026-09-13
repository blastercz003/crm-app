begin;

do $$
begin
  if to_regprocedure('public.get_complete_power_outage_company_page_v10(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is null
     or to_regclass('public.complete_power_outage_communication_states') is null
  then
    raise exception 'Chybi zavislosti pro filtr komunikace KOMPLETNI.';
  end if;
end
$$;

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
  if p_commercial_filter not in ('all', 'top', 'large_companies', 'grade_a', 'grade_b') then raise exception 'Neplatny obchodni vyber.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatny filtr vlastnika.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  return query
  select
    company.id,
    case when p_mode = 'current' then outage.starts_at else outage.ends_at end,
    coalesce(score_row.score, -1),
    case when coalesce(p_clients_only, false) then true else coalesce(client_match.is_client, false) end,
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
    where link.candidate_id = company.id and public.current_user_can_view_client(link.client_id)
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
      coalesce(p_clients_only, false) and coalesce(client_match.is_client, false) and (
        p_commercial_filter = 'all'
        or p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
        or p_commercial_filter = 'grade_a' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
        or p_commercial_filter = 'grade_b' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'
        or p_commercial_filter = 'large_companies' and company.candidate_status = 'confirmed' and public.complete_power_outage_is_large_company_v1(company.ico)
      )
      or not coalesce(p_clients_only, false) and (
        coalesce(client_match.is_client, false)
        or p_commercial_filter = 'all'
        or p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
        or p_commercial_filter = 'grade_a' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
        or p_commercial_filter = 'grade_b' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'
        or p_commercial_filter = 'large_companies' and company.candidate_status = 'confirmed' and public.complete_power_outage_is_large_company_v1(company.ico)
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

revoke all on function public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)
  from public, anon, authenticated;

create or replace function public.get_complete_power_outage_company_page_v11(
  p_mode text default 'current', p_limit integer default 60,
  p_cursor_at timestamptz default null, p_cursor_id uuid default null,
  p_cursor_score integer default null, p_cursor_client_priority boolean default null,
  p_clients_only boolean default false, p_query text default '',
  p_owner_filter text default 'all', p_source text default 'all',
  p_entity_kind text default 'all', p_communication_status text default 'all',
  p_commercial_filter text default 'all', p_sort text default 'date'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(100, greatest(1, coalesce(p_limit, 60)));
  result jsonb;
begin
  if p_sort not in ('date', 'score') then raise exception 'Neplatne razeni obchodniho vyberu.'; end if;
  if p_cursor_at is not null and (p_cursor_id is null or p_cursor_client_priority is null) then raise exception 'Neuplny kurzor strankovani.'; end if;
  if p_cursor_at is not null and p_sort = 'score' and p_cursor_score is null then raise exception 'Kurzor neobsahuje skore.'; end if;

  with page_rows as materialized (
    select scope.*
    from public.get_cpo_communication_filtered_scope_v1(
      p_mode, p_clients_only, p_query, p_owner_filter, p_source,
      p_entity_kind, p_communication_status, p_commercial_filter
    ) scope
    where p_cursor_at is null or p_cursor_id is null or p_cursor_client_priority is null
      or scope.is_client_priority < p_cursor_client_priority
      or scope.is_client_priority = p_cursor_client_priority and (
        p_sort = 'date' and (p_mode = 'current' and (scope.sort_at, scope.candidate_id) > (p_cursor_at, p_cursor_id)
          or p_mode = 'archive' and (scope.sort_at, scope.candidate_id) < (p_cursor_at, p_cursor_id))
        or p_sort = 'score' and p_cursor_score is not null and (
          scope.sort_score < p_cursor_score
          or scope.sort_score = p_cursor_score and p_mode = 'current' and (scope.sort_at, scope.candidate_id) > (p_cursor_at, p_cursor_id)
          or scope.sort_score = p_cursor_score and p_mode = 'archive' and (scope.sort_at, scope.candidate_id) < (p_cursor_at, p_cursor_id)
        )
      )
    order by scope.is_client_priority desc,
      case when p_sort = 'score' then scope.sort_score end desc,
      case when p_mode = 'current' then scope.sort_at end asc,
      case when p_mode = 'archive' then scope.sort_at end desc,
      case when p_mode = 'current' then scope.candidate_id end asc,
      case when p_mode = 'archive' then scope.candidate_id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select * from page_rows
    order by is_client_priority desc,
      case when p_sort = 'score' then sort_score end desc,
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select row_number() over (order by visible.is_client_priority desc,
        case when p_sort = 'score' then visible.sort_score end desc,
        case when p_mode = 'current' then visible.sort_at end asc,
        case when p_mode = 'archive' then visible.sort_at end desc,
        case when p_mode = 'current' then visible.candidate_id end asc,
        case when p_mode = 'archive' then visible.candidate_id end desc) as position,
      visible.sort_at, visible.sort_score, visible.is_client_priority, visible.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id, 'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status, 'notes', assignment.notes,
        'claimed_at', assignment.claimed_at, 'assignment_updated_at', assignment.updated_at,
        'communication_workflow_status', communication.communication_status,
        'commercial_score', score_row.score, 'commercial_grade', score_row.grade,
        'commercial_selection_eligible', coalesce(top_row.top_eligible, false),
        'commercial_score_status', score_row.score_status,
        'has_linked_job', coalesce(job_link.match_count, 0) > 0,
        'linked_job_count', coalesce(job_link.match_count, 0),
        'is_accessible_client', visible.client_match_count > 0,
        'accessible_client_match_count', visible.client_match_count,
        'accessible_client_match_method', visible.client_match_method,
        'notification_email_status', notification.notification_email_status,
        'notification_email_sent_at', notification.notification_email_sent_at,
        'notification_email_delivered_at', notification.notification_email_delivered_at
      ) as item
    from visible_rows visible
    join public.complete_power_outage_company_overview overview on overview.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = visible.candidate_id
    left join public.complete_power_outage_communication_states communication on communication.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = visible.candidate_id
    left join lateral (select count(*)::integer as match_count from public.complete_power_outage_job_links link where link.candidate_id = visible.candidate_id) job_link on true
    left join lateral public.get_complete_power_outage_notification_email_badge_v1(visible.candidate_id) notification on true
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by position) from serialized), '[]'::jsonb),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (select jsonb_build_object('at', sort_at, 'id', candidate_id, 'score', sort_score, 'clientPriority', is_client_priority) from serialized order by position desc limit 1)
  ) into result;
  return result;
end;
$$;

create or replace function public.count_complete_power_outage_companies_v6(
  p_mode text default 'current', p_query text default '', p_owner_filter text default 'all',
  p_source text default 'all', p_entity_kind text default 'all',
  p_communication_status text default 'all', p_commercial_filter text default 'all',
  p_clients_only boolean default false
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
  from public.get_cpo_communication_filtered_scope_v1(
    p_mode, p_clients_only, p_query, p_owner_filter, p_source,
    p_entity_kind, p_communication_status, p_commercial_filter
  );
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
    select candidate_id, is_client_priority
    from public.get_cpo_communication_filtered_scope_v1(
      p_mode, p_clients_only, p_query, p_owner_filter, p_source,
      p_entity_kind, p_communication_status, 'all'
    )
  )
  select jsonb_build_object(
    'all', count(*),
    'top', count(*) filter (where (not p_clients_only and scope.is_client_priority) or coalesce(top_row.top_eligible, false)),
    'largeCompanies', count(*) filter (where (not p_clients_only and scope.is_client_priority) or company.candidate_status = 'confirmed' and public.complete_power_outage_is_large_company_v1(company.ico)),
    'gradeA', count(*) filter (where (not p_clients_only and scope.is_client_priority) or score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'),
    'gradeB', count(*) filter (where (not p_clients_only and scope.is_client_priority) or score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B')
  )
  from scope
  join public.complete_power_outage_companies company on company.id = scope.candidate_id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = scope.candidate_id
  left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = scope.candidate_id;
$$;

revoke all on function public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean) from public, anon;
revoke all on function public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.count_complete_power_outage_companies_v6(text,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.get_complete_power_outage_commercial_selection_counts_v5(text,text,text,text,text,text,boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
