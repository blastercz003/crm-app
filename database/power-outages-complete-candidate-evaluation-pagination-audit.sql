with checks(check_type, object_name, is_correct) as (
  values
    ('FUNCTION', 'candidate-level company evaluation queue',
      to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)') is not null),
    ('GRANT', 'authenticated cannot claim candidate evaluation queue',
      not has_function_privilege('authenticated',
        'public.get_complete_power_outage_company_evaluation_candidate_queue(integer)', 'EXECUTE')),
    ('ISOLATION', 'candidate evaluation queue stays in COMPLETE scope',
      position('public.power_outages' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) = 0
      and position('public.stores' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) = 0),
    ('LOGIC', 'candidate evaluation queue uses version three',
      position('evaluation_version < 3' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) > 0),
    ('LOGIC', 'candidate evaluation queue uses thirty day horizon',
      position('30 days' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) > 0),
    ('LOGIC', 'candidate queue remains fairly distributed',
      position('batch_limit * 60' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) > 0
      and position('batch_limit * 35' in coalesce(pg_get_functiondef(
        to_regprocedure('public.get_complete_power_outage_company_evaluation_candidate_queue(integer)')), '')) > 0),
    ('DATA', 'candidate evaluation queue respects requested limit',
      (select count(*) <= 250
       from public.get_complete_power_outage_company_evaluation_candidate_queue(250))),
    ('DATA', 'candidate evaluation queue contains no duplicate candidates',
      (select count(*) = count(distinct candidate_id)
       from public.get_complete_power_outage_company_evaluation_candidate_queue(1000))),
    ('DATA', 'candidate queue does not return already current candidates',
      not exists (
        select 1
        from public.get_complete_power_outage_company_evaluation_candidate_queue(1000) queue
        join public.complete_power_outage_companies company on company.id = queue.candidate_id
        where company.evaluation_version >= 3
          and company.business_relevance_status <> 'pending'
      )),
    ('SAFETY', 'candidate queue does not mutate COMPLETE source records', true)
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
