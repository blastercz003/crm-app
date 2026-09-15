-- 1. Souhrn posledniho lokalniho SHADOW prepocitu.
select
  run.id as run_id,
  run.status,
  run.target_count,
  run.verified_count,
  run.needs_review_count,
  run.conflict_count,
  run.change_count,
  count(*) filter (
    where item.original_candidate_status = 'confirmed'
      and item.proposed_candidate_status = 'confirmed'
  )::bigint as confirmed_preserved_count,
  count(*) filter (
    where item.original_candidate_status = 'confirmed'
      and item.proposed_candidate_status = 'needs_review'
  )::bigint as confirmed_to_review_count,
  count(*) filter (
    where item.original_candidate_status = 'confirmed'
      and item.proposed_candidate_status = 'stale'
  )::bigint as confirmed_to_stale_count,
  count(*) filter (where item.postal_conflict)::bigint as postal_conflict_count,
  run.created_at
from public.complete_power_outage_egd_v5_gap_shadow_runs run
left join public.complete_power_outage_egd_v5_gap_shadow_items item
  on item.run_id = run.id
where run.id = (
  select latest.id
  from public.complete_power_outage_egd_v5_gap_shadow_runs latest
  order by latest.created_at desc, latest.id desc
  limit 1
)
group by run.id;

-- 2. Rozpad navrhovanych zmen podle duvodu a vysledku.
select
  item.scope_reason,
  item.original_candidate_status,
  item.final_disposition,
  item.proposed_candidate_status,
  item.postal_conflict,
  item.requires_change,
  count(*)::bigint as candidate_count,
  count(distinct item.outage_id)::bigint as outage_count
from public.complete_power_outage_egd_v5_gap_shadow_items item
where item.run_id = (
  select latest.id
  from public.complete_power_outage_egd_v5_gap_shadow_runs latest
  order by latest.created_at desc, latest.id desc
  limit 1
)
group by
  item.scope_reason,
  item.original_candidate_status,
  item.final_disposition,
  item.proposed_candidate_status,
  item.postal_conflict,
  item.requires_change
order by item.scope_reason, item.final_disposition, item.postal_conflict desc;

-- 3. Bezpecnostni audit SHADOW zachyceni.
with latest_run as (
  select run.*
  from public.complete_power_outage_egd_v5_gap_shadow_runs run
  order by run.created_at desc, run.id desc
  limit 1
), items as (
  select item.*
  from public.complete_power_outage_egd_v5_gap_shadow_items item
  join latest_run run on run.id = item.run_id
), checks as (
  select 'DATA'::text as check_type,
    'SHADOW run counters account for every candidate'::text as object_name,
    (
      select target_count = verified_count + needs_review_count + conflict_count
        and target_count = (select count(*) from items)
        and change_count = (select count(*) from items where requires_change)
      from latest_run
    ) as is_correct
  union all
  select 'DATA', 'SHADOW results contain no duplicate candidate',
    not exists (
      select company_id from items group by company_id having count(*) > 1
    )
  union all
  select 'ISOLATION', 'SHADOW results contain only current COMPLETE EGD records',
    not exists (
      select 1
      from items item
      join public.complete_power_outages outage on outage.id = item.outage_id
      where outage.source <> 'egd'
        or outage.source_status not in ('scheduled', 'active')
        or outage.missing_since is not null
        or outage.ends_at < now()
    )
  union all
  select 'LOGIC', 'verified is the only proposed confirmed disposition',
    not exists (
      select 1 from items
      where (final_disposition = 'verified') <> (proposed_candidate_status = 'confirmed')
    )
  union all
  select 'LOGIC', 'postal conflicts can never remain confirmed',
    not exists (
      select 1 from items
      where postal_conflict and proposed_candidate_status = 'confirmed'
    )
  union all
  select 'LOGIC', 'every SHADOW candidate has stored evidence',
    not exists (select 1 from items where evidence_count = 0)
  union all
  select 'SAFETY', 'SHADOW capture has not changed production candidate status',
    not exists (
      select 1
      from items item
      join public.complete_power_outage_companies company on company.id = item.company_id
      where company.candidate_status <> item.original_candidate_status
    )
  union all
  select 'SAFETY', 'SHADOW capture declares no external request or production mutation',
    coalesce((select
      metadata ->> 'externalRequestMade' = 'false'
      and metadata ->> 'productionMutationMade' = 'false'
      from latest_run), false)
  union all
  select 'SAFETY', 'SHADOW capture function contains no HTTP or net invocation',
    pg_get_functiondef(
      'public.capture_complete_power_outage_egd_v5_gap_shadow_v1()'::regprocedure
    ) !~* '(http|net\\.|fetch)'
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;
