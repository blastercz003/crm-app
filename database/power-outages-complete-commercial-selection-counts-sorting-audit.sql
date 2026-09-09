select * from (values
  ('FUNCTION', 'AI SELECT counts respect current table filters',
    to_regprocedure('public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)') is not null),
  ('FUNCTION', 'AI SELECT score ordered keyset page',
    to_regprocedure('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)') is not null),
  ('GRANT', 'authenticated reads AI SELECT counts and pages only',
    has_function_privilege('authenticated', 'public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.complete_power_outage_company_scores', 'UPDATE')),
  ('ISOLATION', 'AI SELECT counts and sorting stay in COMPLETE scope',
    position('market' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) = 0
    and position('market' in lower(pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)'::regprocedure))) = 0),
  ('LOGIC', 'all count includes unscored visible records',
    position('''all'', count(*)' in lower(pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)'::regprocedure))) > 0),
  ('LOGIC', 'AI SELECT default sorting remains date',
    lower(pg_get_function_arguments('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure)) like '%p_sort text default ''date''::text%'),
  ('LOGIC', 'unscored records sort after scored records',
    position('coalesce(score_row.score, -1)' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) > 0),
  ('LOGIC', 'score cursor prevents duplicate pagination rows',
    position('p_cursor_score' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) > 0
    and position('sort_score' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) > 0),
  ('SAFETY', 'counts and sorting do not mutate source records',
    position('update public.complete_power_outages' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) = 0
    and position('update public.complete_power_outage_companies' in lower(pg_get_functiondef('public.get_complete_power_outage_company_page_v4(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'::regprocedure))) = 0
    and position('update public.complete_power_outage_addresses' in lower(pg_get_functiondef('public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)'::regprocedure))) = 0),
  ('STATE', 'AI SELECT counts and sorting UI is active',
    exists (select 1 from public.complete_power_outage_commercial_selection_state where singleton and scoring_enabled and ui_enabled and metadata ->> 'uiContract' = 'complete-commercial-selection-ui-v2')),
  ('STATE', 'AI SELECT defaults remain all and nearest date',
    exists (select 1 from public.complete_power_outage_commercial_selection_state where singleton and metadata ->> 'defaultFilter' = 'all' and metadata ->> 'defaultSort' = 'date'))
) as audit(check_type, object_name, is_correct)
order by check_type, object_name;
