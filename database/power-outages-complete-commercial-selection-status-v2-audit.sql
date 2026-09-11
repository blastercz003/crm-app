with snapshot as (
  select *
  from public.complete_power_outage_commercial_selection_progress_snapshot
  where singleton
)
select 'DATA' as check_type, 'AI SELECT queue total is internally consistent' as object_name,
  exists (
    select 1 from snapshot
    where remaining_count = evaluation_pending_count
      + enrichment_pending_count + scoring_pending_count
  ) as is_correct
union all
select 'FUNCTION', 'AI SELECT status distinguishes updated candidates and enrichment',
  position('nových a aktualizovaných kandidátů' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure
  )) > 0
  and position('doplňování profilů ARES/RES' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure
  )) > 0
union all
select 'LOGIC', 'AI SELECT dominant stage follows the largest active queue',
  exists (
    select 1 from snapshot
    where status <> 'processing'
       or stage = case
         when enrichment_pending_count >= evaluation_pending_count
           and enrichment_pending_count >= scoring_pending_count
           and enrichment_pending_count > 0 then 'enrichment'
         when evaluation_pending_count >= scoring_pending_count
           and evaluation_pending_count > 0 then 'evaluation'
         when scoring_pending_count > 0 then 'scoring'
         else 'current'
       end
  )
union all
select 'LOGIC', 'AI SELECT no longer labels aggregate work as new companies',
  not exists (
    select 1 from snapshot
    where status_message = 'Probíhá vyhodnocení nově nalezených firem.'
  )
union all
select 'GRANT', 'authenticated cannot refresh AI SELECT status',
  not has_function_privilege(
    'authenticated',
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()',
    'EXECUTE'
  )
union all
select 'SAFETY', 'AI SELECT status update does not mutate source records',
  position('update public.complete_power_outage_companies' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure
  ))) = 0
  and position('update public.complete_power_outages' in lower(pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure
  ))) = 0
order by check_type, object_name;
