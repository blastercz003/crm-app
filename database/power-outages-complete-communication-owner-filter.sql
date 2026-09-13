begin;

do $$
begin
  if to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)') is null
     or to_regclass('public.profiles') is null
  then
    raise exception 'Chybi zavislosti pro filtr vlastniku komunikace KOMPLETNI.';
  end if;
end
$$;

create or replace function public.get_complete_power_outage_owner_filter_options_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Filtr ostatnich vlastniku je dostupny pouze administratorovi.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', desired.id, 'name', desired.display_name)
    order by desired.position), '[]'::jsonb)
  into result
  from (values
    (1, '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid, 'Michal'::text),
    (2, '735d158c-667a-42c0-8af0-6ee12a9c1f11'::uuid, 'Lída'::text)
  ) desired(position, id, display_name)
  join public.profiles profile on profile.id = desired.id;

  return result;
end;
$$;

revoke all on function public.get_complete_power_outage_owner_filter_options_v1()
  from public, anon;
grant execute on function public.get_complete_power_outage_owner_filter_options_v1()
  to authenticated;

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

notify pgrst, 'reload schema';
commit;
