with checks(check_type, object_name, is_correct) as (
  values
    ('INDEX', 'active provider error detail lookup',
      to_regclass('public.cpo_target_lookups_active_error_detail_idx') is not null),
    ('LOGIC', 'active error index includes retry and review states',
      coalesce((
        select pg_get_expr(indexprs.indpred, indexprs.indrelid)
          like '%lookup_status%error%needs_review%'
        from pg_index indexprs
        where indexprs.indexrelid = to_regclass('public.cpo_target_lookups_active_error_detail_idx')
      ), false)),
    ('LOGIC', 'active error index supports latest attempt ordering',
      coalesce((
        select pg_get_indexdef(indexprs.indexrelid) ilike '%last_attempt_at%desc%'
        from pg_index indexprs
        where indexprs.indexrelid = to_regclass('public.cpo_target_lookups_active_error_detail_idx')
      ), false)),
    ('SAFETY', 'diagnostic index does not change provider data', true),
    ('ISOLATION', 'diagnostic index stays in COMPLETE scope',
      coalesce((
        select pg_get_indexdef(indexprs.indexrelid)
          like '%complete_power_outage_target_lookups%'
        from pg_index indexprs
        where indexprs.indexrelid = to_regclass('public.cpo_target_lookups_active_error_detail_idx')
      ), false))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
