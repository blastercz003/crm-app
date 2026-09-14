with checks(check_type, object_name, is_correct) as (
  values
    (
      'FUNCTION'::text,
      'client name and ICO index normalization functions exist'::text,
      to_regprocedure(
        'public.complete_power_outage_normalize_client_name(text)'
      ) is not null
      and to_regprocedure(
        'public.complete_power_outage_normalize_client_ico(text)'
      ) is not null
    ),
    (
      'INDEX',
      'clients functional normalization indexes exist',
      to_regclass('public.clients_complete_normalized_name_idx') is not null
      and to_regclass('public.clients_complete_normalized_ico_idx') is not null
    ),
    (
      'GRANT',
      'authenticated can maintain clients functional indexes',
      has_function_privilege(
        'authenticated',
        'public.complete_power_outage_normalize_client_name(text)',
        'EXECUTE'
      )
      and has_function_privilege(
        'authenticated',
        'public.complete_power_outage_normalize_client_ico(text)',
        'EXECUTE'
      )
    ),
    (
      'GRANT',
      'anonymous users cannot execute client normalization functions',
      not has_function_privilege(
        'anon',
        'public.complete_power_outage_normalize_client_name(text)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'public.complete_power_outage_normalize_client_ico(text)',
        'EXECUTE'
      )
    ),
    (
      'LOGIC',
      'client normalization functions remain deterministic',
      public.complete_power_outage_normalize_client_name('Firma, s.r.o.') = 'firma'
      and public.complete_power_outage_normalize_client_ico('CZ 01234567') = '01234567'
    ),
    (
      'SAFETY',
      'client INSERT policy still requires the authenticated owner',
      exists (
        select 1
        from pg_policies policy_row
        where policy_row.schemaname = 'public'
          and policy_row.tablename = 'clients'
          and policy_row.cmd = 'INSERT'
          and lower(coalesce(policy_row.with_check, '')) like '%created_by%auth.uid%'
      )
    )
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
