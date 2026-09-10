begin;

do $$
begin
  if to_regprocedure('public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)') is null
     or to_regclass('public.complete_power_outage_job_links') is null
  then
    raise exception 'Chybi aktivni TOP VYBER v1 nebo evidence vazeb na zakazky.';
  end if;
end
$$;

-- v6 zachovava publikovany TOP filtr z v5 a nad hotovou strankou pouze
-- doplni informacni data pro zelenou fajfku. Logiku vazeb ani zdrojove
-- zaznamy nemeni a funguje stejne pro TOP, A, B i VSECHNY.
create or replace function public.get_complete_power_outage_company_page_v6(
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
  result jsonb;
  enriched_items jsonb;
begin
  result := public.get_complete_power_outage_company_page_v5(
    p_mode, p_limit, p_cursor_at, p_cursor_id, p_cursor_score, p_query,
    p_owner_filter, p_source, p_entity_kind, p_candidate_status,
    p_commercial_filter, p_sort
  );

  select coalesce(jsonb_agg(
    item.value || case
      when linked.match_count = 0 then jsonb_build_object(
        'has_linked_job', false,
        'linked_job_count', 0
      )
      else jsonb_build_object(
        'has_linked_job', true,
        'linked_job_count', linked.match_count
      )
    end
    order by item.ordinality
  ), '[]'::jsonb)
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'items', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join lateral (
    select count(*)::integer as match_count
    from public.complete_power_outage_job_links link
    where link.candidate_id = (item.value ->> 'candidate_id')::uuid
  ) linked on true;

  return jsonb_set(result, '{items}', enriched_items, true);
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v6(
  text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v6(
  text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text
) to authenticated;

notify pgrst, 'reload schema';

commit;
