with checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'admin COMPLETE owner filter options exist',
      to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()') is not null),
    ('GRANT', 'owner filter options are available only through administrator guard',
      coalesce(position('current_user_is_admin' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()'))) > 0, false)
      and not has_function_privilege('anon', 'public.get_complete_power_outage_owner_filter_options_v1()', 'EXECUTE')),
    ('GRANT', 'non admin cannot filter another owner by crafted request',
      coalesce(position('Filtr ostatnich vlastniku je dostupny pouze administratorovi' in pg_get_functiondef(to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'))) > 0, false)),
    ('LOGIC', 'admin owner filter contains only Michal and Lida',
      coalesce(position('46c40df2-04d7-41e9-ad6d-51cc2ee76019' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()'))) > 0, false)
      and coalesce(position('735d158c-667a-42c0-8af0-6ee12a9c1f11' in pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()'))) > 0, false)),
    ('LOGIC', 'crafted owner filter is restricted to approved users',
      coalesce(position('Tento vlastnik neni pro filtr KOMPLETNI povolen' in pg_get_functiondef(to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'))) > 0, false)),
    ('DATA', 'Michal and Lida profiles exist',
      (select count(*) = 2 from public.profiles where id in (
        '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid,
        '735d158c-667a-42c0-8af0-6ee12a9c1f11'::uuid
      ))),
    ('ISOLATION', 'owner filter stays in COMPLETE scope',
      coalesce(position('complete_power_outage_company_assignments' in pg_get_functiondef(to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'))) > 0, false)),
    ('SAFETY', 'owner filter is read only',
      coalesce(position('UPDATE ' in upper(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()')))) = 0, false)
      and coalesce(position('INSERT ' in upper(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()')))) = 0, false)
      and coalesce(position('DELETE ' in upper(pg_get_functiondef(to_regprocedure('public.get_complete_power_outage_owner_filter_options_v1()')))) = 0, false)),
    ('SAFETY', 'communication owner filter does not change email sending',
      coalesce(position('notification_email' in pg_get_functiondef(to_regprocedure('public.get_cpo_communication_filtered_scope_v1(text,boolean,text,text,text,text,text,text)'))) = 0, false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
