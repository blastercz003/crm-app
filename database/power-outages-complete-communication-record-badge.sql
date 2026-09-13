begin;

do $$
begin
  if to_regclass('public.complete_power_outage_communication_states') is null
     or to_regprocedure('public.get_complete_power_outage_company_page_v9(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is null
  then
    raise exception 'Chybi zavislosti pro minibadge komunikace KOMPLETNI.';
  end if;
end
$$;

create or replace function public.get_complete_power_outage_communication_badge_v1(
  requested_candidate_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select state.communication_status
  from public.complete_power_outage_communication_states state
  where state.candidate_id = requested_candidate_id
    and state.communication_status <> 'not_contacted';
$$;

revoke all on function public.get_complete_power_outage_communication_badge_v1(uuid)
  from public, anon, authenticated;

create or replace function public.get_complete_power_outage_company_page_v10(
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
  result jsonb;
  enriched_items jsonb;
begin
  result := public.get_complete_power_outage_company_page_v9(
    p_mode, p_limit, p_cursor_at, p_cursor_id, p_cursor_score,
    p_cursor_client_priority, p_clients_only, p_query, p_owner_filter,
    p_source, p_entity_kind, p_candidate_status, p_commercial_filter, p_sort
  );

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object(
        'communication_workflow_status',
        public.get_complete_power_outage_communication_badge_v1(
          (item.value ->> 'candidate_id')::uuid
        )
      ) order by item.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'items', '[]'::jsonb))
    with ordinality as item(value, ordinality);

  return jsonb_set(result, '{items}', enriched_items, true);
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v10(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v10(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) to authenticated;

notify pgrst, 'reload schema';
commit;
