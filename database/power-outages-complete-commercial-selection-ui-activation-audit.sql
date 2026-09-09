select * from (values
  ('FUNCTION', 'AI SELECT paged company query',
    to_regprocedure('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)') is not null),
  ('FUNCTION', 'AI SELECT filtered company count',
    to_regprocedure('public.count_complete_power_outage_companies_v2(text,text,text,text,text,text,text)') is not null),
  ('GRANT', 'authenticated reads AI SELECT results only',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.count_complete_power_outage_companies_v2(text,text,text,text,text,text,text)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_company_scores', 'UPDATE')),
  ('ISOLATION', 'AI SELECT query stays in COMPLETE scope',
    position('power_outage_store_' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)'::regprocedure))) = 0
    and position('market' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)'::regprocedure))) = 0),
  ('LOGIC', 'AI SELECT supports four approved choices',
    position('p_commercial_filter not in (''all'', ''top'', ''grade_a'', ''grade_b'')' in pg_get_functiondef('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)'::regprocedure)) > 0),
  ('LOGIC', 'default AI SELECT choice keeps all records',
    lower(pg_get_function_arguments('public.get_complete_power_outage_company_page_v3(text,integer,timestamptz,uuid,text,text,text,text,text,text)'::regprocedure)) like '%p_commercial_filter text default ''all''::text%'),
  ('SAFETY', 'AI SELECT activation does not mutate source records',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('get_complete_power_outage_company_page_v3', 'count_complete_power_outage_companies_v2')
        and (lower(pg_get_functiondef(p.oid)) like '%update public.complete_power_outages%'
          or lower(pg_get_functiondef(p.oid)) like '%update public.complete_power_outage_addresses%'
          or lower(pg_get_functiondef(p.oid)) like '%update public.complete_power_outage_companies%'))),
  ('STATE', 'AI SELECT UI is active with scoring',
    exists (select 1 from public.complete_power_outage_commercial_selection_state where singleton and scoring_enabled and ui_enabled)),
  ('STATE', 'AI SELECT default is all records',
    exists (select 1 from public.complete_power_outage_commercial_selection_state where singleton and metadata ->> 'defaultFilter' = 'all'))
) as audit(check_type, object_name, is_correct)
order by check_type, object_name;
