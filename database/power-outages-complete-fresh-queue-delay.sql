begin;

do $$
begin
  if to_regprocedure('public.refresh_complete_power_outage_global_progress_snapshot()') is null
    or to_regprocedure('public.refresh_complete_power_outage_commercial_selection_progress_snapshot()') is null
    or to_regclass('public.complete_power_outage_companies') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outage_address_targets') is null
    or to_regclass('public.complete_power_outage_target_lookups') is null
    or to_regclass('public.complete_power_outage_company_enrichment_queue') is null
    or to_regclass('public.complete_power_outage_company_scores') is null
  then
    raise exception 'Chybi zavislosti pro opravu detekce stari pracovnich front.';
  end if;
end
$$;

-- Vrací okamžik, kdy do právě čekající fronty vstoupila její nejstarší
-- položka. Historická aktivita workeru tak nemůže novou frontu označit jako
-- zpožděnou dříve, než uplyne její vlastní bezpečnostní interval.
create or replace function public.complete_power_outage_pending_queue_since(
  requested_lane text
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case lower(btrim(coalesce(requested_lane, '')))
    when 'normalization' then (
      select min(address.updated_at)
      from public.complete_power_outage_addresses address
      join public.complete_power_outages outage on outage.id = address.outage_id
      where outage.source_status in ('scheduled', 'active')
        and outage.ends_at >= now()
        and address.normalization_version < 2
    )
    when 'mapy' then (
      select min(coalesce(lookup.updated_at, target.created_at))
      from public.complete_power_outage_address_targets target
      join public.complete_power_outage_addresses address
        on address.id = target.outage_address_id
      join public.complete_power_outages outage on outage.id = address.outage_id
      left join public.complete_power_outage_target_lookups lookup
        on lookup.target_id = target.id and lookup.provider = 'mapy'
      where outage.source_status in ('scheduled', 'active')
        and outage.ends_at >= now()
        and outage.starts_at <= now() + interval '30 days'
        and target.target_kind in ('exact_number', 'street')
        and (lookup.id is null or lookup.lookup_status = 'pending')
    )
    when 'evaluation' then (
      select min(company.updated_at)
      from public.complete_power_outage_companies company
      join public.complete_power_outage_addresses address
        on address.id = company.outage_address_id
      join public.complete_power_outages outage on outage.id = address.outage_id
      where company.candidate_status in ('new', 'confirmed', 'needs_review')
        and (company.evaluation_version < 2
          or company.business_relevance_status = 'pending')
        and outage.source_status in ('scheduled', 'active')
        and outage.ends_at >= now()
        and outage.starts_at <= now() + interval '30 days'
    )
    when 'enrichment' then (
      select min(queue.updated_at)
      from public.complete_power_outage_company_enrichment_queue queue
      where queue.queue_status in ('pending', 'processing')
    )
    when 'scoring' then (
      select min(coalesce(score.updated_at, company.updated_at))
      from public.complete_power_outage_companies company
      join public.complete_power_outage_addresses address
        on address.id = company.outage_address_id
      join public.complete_power_outages outage on outage.id = address.outage_id
      left join public.complete_power_outage_company_scores score
        on score.candidate_id = company.id
      where company.candidate_status in ('new', 'confirmed', 'needs_review')
        and outage.source_status in ('scheduled', 'active')
        and outage.ends_at >= now()
        and (score.candidate_id is null
          or score.score_status in ('pending', 'stale', 'error'))
    )
    else null
  end;
$$;

revoke all on function public.complete_power_outage_pending_queue_since(text)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_pending_queue_since(text)
  to service_role;

do $$
declare
  definition text;
  original_definition text;
begin
  definition := pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure
  );
  original_definition := definition;

  definition := replace(definition,
    'coalesce(evaluation.last_progress_at, ''-infinity''::timestamptz) < now() - interval ''15 minutes''',
    'coalesce(greatest(evaluation.last_progress_at, public.complete_power_outage_pending_queue_since(''evaluation'')), ''-infinity''::timestamptz) < now() - interval ''15 minutes'''
  );
  definition := replace(definition,
    E'coalesce(enrichment.last_enrichment_activity_at, enrichment.last_success_at, ''-infinity''::timestamptz)\n          < now() - interval ''10 minutes''',
    E'coalesce(greatest(enrichment.last_enrichment_activity_at, enrichment.last_success_at, public.complete_power_outage_pending_queue_since(''enrichment'')), ''-infinity''::timestamptz)\n          < now() - interval ''10 minutes'''
  );
  definition := replace(definition,
    E'coalesce(scoring.last_scoring_activity_at, scoring.scoring_last_success_at, ''-infinity''::timestamptz)\n          < now() - interval ''5 minutes''',
    E'coalesce(greatest(scoring.last_scoring_activity_at, scoring.scoring_last_success_at, public.complete_power_outage_pending_queue_since(''scoring'')), ''-infinity''::timestamptz)\n          < now() - interval ''5 minutes'''
  );

  if position('complete_power_outage_pending_queue_since(''evaluation'')' in definition) = 0
    or position('complete_power_outage_pending_queue_since(''enrichment'')' in definition) = 0
    or position('complete_power_outage_pending_queue_since(''scoring'')' in definition) = 0
  then
    raise exception 'Funkce stavu AI SELECT ma neocekavanou podobu; oprava nebyla aplikovana.';
  end if;
  if definition <> original_definition then
    execute definition;
  end if;
end
$$;

do $$
declare
  definition text;
  original_definition text;
begin
  definition := pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure
  );
  original_definition := definition;

  definition := replace(definition,
    E'coalesce(exact_last_progress_at, exact_oldest_pending_at)\n            < now() - interval ''45 minutes''',
    E'coalesce(greatest(exact_last_progress_at, exact_oldest_pending_at), ''-infinity''::timestamptz)\n            < now() - interval ''45 minutes'''
  );
  definition := replace(definition,
    E'coalesce(last_finished_at, last_success_at, last_started_at)\n            < now() - interval ''15 minutes''',
    E'coalesce(greatest(last_finished_at, last_success_at, last_started_at, public.complete_power_outage_pending_queue_since(''normalization'')), ''-infinity''::timestamptz)\n            < now() - interval ''15 minutes'''
  );
  definition := replace(definition,
    'and mapy.last_progress_at < now() - interval ''45 minutes'' then 1 else 0 end',
    'and coalesce(greatest(mapy.last_progress_at, public.complete_power_outage_pending_queue_since(''mapy'')), ''-infinity''::timestamptz) < now() - interval ''45 minutes'' then 1 else 0 end'
  );
  definition := replace(definition,
    'and last_evaluated_at < now() - interval ''45 minutes''',
    'and coalesce(greatest(last_evaluated_at, public.complete_power_outage_pending_queue_since(''evaluation'')), ''-infinity''::timestamptz) < now() - interval ''45 minutes'''
  );

  if position('greatest(exact_last_progress_at, exact_oldest_pending_at)' in definition) = 0
    or position('complete_power_outage_pending_queue_since(''normalization'')' in definition) = 0
    or position('complete_power_outage_pending_queue_since(''mapy'')' in definition) = 0
    or position('complete_power_outage_pending_queue_since(''evaluation'')' in definition) = 0
  then
    raise exception 'Funkce celkoveho progressu ma neocekavanou podobu; oprava nebyla aplikovana.';
  end if;
  if definition <> original_definition then
    execute definition;
  end if;
end
$$;

revoke all on function public.refresh_complete_power_outage_commercial_selection_progress_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_commercial_selection_progress_snapshot()
  to service_role;
revoke all on function public.refresh_complete_power_outage_global_progress_snapshot()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_global_progress_snapshot()
  to service_role;

select public.refresh_complete_power_outage_commercial_selection_progress_snapshot();
select public.refresh_complete_power_outage_global_progress_snapshot();

commit;

select 'FUNCTION' as check_type, 'pending queue age helper' as object_name,
  to_regprocedure('public.complete_power_outage_pending_queue_since(text)') is not null as is_correct
union all
select 'FUNCTION', 'AI SELECT uses current queue age',
  position('complete_power_outage_pending_queue_since' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) > 0
union all
select 'FUNCTION', 'global progress uses current queue age',
  position('complete_power_outage_pending_queue_since' in pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure)) > 0
union all
select 'LOGIC', 'ARES delay uses pending target age',
  position('greatest(exact_last_progress_at, exact_oldest_pending_at)' in pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure)) > 0
union all
select 'LOGIC', 'fresh queue grace keeps lane thresholds',
  position('interval ''15 minutes''' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) > 0
  and position('interval ''10 minutes''' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) > 0
  and position('interval ''5 minutes''' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) > 0
  and position('interval ''45 minutes''' in pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure)) > 0
union all
select 'SAFETY', 'old pending work can still report delay',
  position('''-infinity''::timestamptz' in pg_get_functiondef(
    'public.refresh_complete_power_outage_commercial_selection_progress_snapshot()'::regprocedure)) > 0
  and position('''-infinity''::timestamptz' in pg_get_functiondef(
    'public.refresh_complete_power_outage_global_progress_snapshot()'::regprocedure)) > 0
union all
select 'GRANT', 'authenticated cannot inspect queue age helper',
  not has_function_privilege('authenticated',
    'public.complete_power_outage_pending_queue_since(text)', 'EXECUTE')
union all
select 'ISOLATION', 'queue freshness remains in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef(
    'public.complete_power_outage_pending_queue_since(text)'::regprocedure)) = 0
union all
select 'SAFETY', 'queue freshness repair does not mutate source records',
  position(' update ' in lower(pg_get_functiondef(
    'public.complete_power_outage_pending_queue_since(text)'::regprocedure))) = 0
order by check_type, object_name;
