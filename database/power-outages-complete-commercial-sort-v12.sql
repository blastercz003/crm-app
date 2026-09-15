begin;

-- Explicitní řazení AI SELECT bez skryté priority existujícího klienta.
-- Pořadí kurzoru je záměrně totožné s ORDER BY, aby nevznikaly mezery
-- ani duplicity při postupném načítání dalších stránek.
do $$
begin
  if to_regprocedure(
    'public.get_complete_power_outage_company_page_v11(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)'
  ) is null
     or to_regprocedure(
       'public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'
     ) is null
  then
    raise exception 'Chybí závislosti pro přesné řazení AI SELECT v12.';
  end if;
end
$$;

create or replace function public.get_complete_power_outage_company_page_v12(
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
  if p_sort not in ('date', 'score') then
    raise exception 'Neplatné řazení obchodního výběru.';
  end if;
  if p_cursor_at is not null and p_cursor_id is null then
    raise exception 'Neúplný kurzor stránkování.';
  end if;
  if p_cursor_at is not null and p_sort = 'score' and p_cursor_score is null then
    raise exception 'Kurzor neobsahuje skóre.';
  end if;

  with page_rows as materialized (
    select scope.*
    from public.get_cpo_communication_filtered_scope_v1(
      p_mode, p_clients_only, p_query, p_owner_filter, p_source,
      p_entity_kind, p_communication_status, p_commercial_filter
    ) scope
    where p_cursor_at is null
      or p_cursor_id is null
      or (
        p_sort = 'date'
        and (
          p_mode = 'current'
            and (scope.sort_at, scope.candidate_id) > (p_cursor_at, p_cursor_id)
          or p_mode = 'archive'
            and (scope.sort_at, scope.candidate_id) < (p_cursor_at, p_cursor_id)
        )
      )
      or (
        p_sort = 'score'
        and p_cursor_score is not null
        and (
          scope.sort_score < p_cursor_score
          or scope.sort_score = p_cursor_score
            and p_mode = 'current'
            and (scope.sort_at, scope.candidate_id) > (p_cursor_at, p_cursor_id)
          or scope.sort_score = p_cursor_score
            and p_mode = 'archive'
            and (scope.sort_at, scope.candidate_id) < (p_cursor_at, p_cursor_id)
        )
      )
    order by
      case when p_sort = 'score' then scope.sort_score end desc,
      case when p_mode = 'current' then scope.sort_at end asc,
      case when p_mode = 'archive' then scope.sort_at end desc,
      case when p_mode = 'current' then scope.candidate_id end asc,
      case when p_mode = 'archive' then scope.candidate_id end desc
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
    select row_number() over (order by
        case when p_sort = 'score' then visible.sort_score end desc,
        case when p_mode = 'current' then visible.sort_at end asc,
        case when p_mode = 'archive' then visible.sort_at end desc,
        case when p_mode = 'current' then visible.candidate_id end asc,
        case when p_mode = 'archive' then visible.candidate_id end desc
      ) as position,
      visible.sort_at, visible.sort_score,
      visible.is_client_priority, visible.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id,
        'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status,
        'notes', assignment.notes,
        'claimed_at', assignment.claimed_at,
        'assignment_updated_at', assignment.updated_at,
        'communication_workflow_status', communication.communication_status,
        'commercial_score', score_row.score,
        'commercial_grade', score_row.grade,
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
    join public.complete_power_outage_company_overview overview
      on overview.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = visible.candidate_id
    left join public.complete_power_outage_communication_states communication
      on communication.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_scores score_row
      on score_row.candidate_id = visible.candidate_id
    left join public.complete_power_outage_company_top_selections top_row
      on top_row.candidate_id = visible.candidate_id
    left join lateral (
      select count(*)::integer as match_count
      from public.complete_power_outage_job_links link
      where link.candidate_id = visible.candidate_id
    ) job_link on true
    left join lateral public.get_complete_power_outage_notification_email_badge_v1(
      visible.candidate_id
    ) notification on true
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(item order by position) from serialized
    ), '[]'::jsonb),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (
      select jsonb_build_object(
        'at', sort_at,
        'id', candidate_id,
        'score', sort_score,
        'clientPriority', is_client_priority
      )
      from serialized
      order by position desc
      limit 1
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v12(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v12(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) to authenticated;

notify pgrst, 'reload schema';
commit;
