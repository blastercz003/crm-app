begin;

-- Povinný průběh je vždy počítán jen z aktuálních odstávek v horizontu
-- 30 dnů. ARES odpovídá přesným adresám, Mapy.com uličním cílům.
create or replace view public.complete_power_outage_source_discovery_overview
with (security_invoker = true)
as
with eligible as (
  select
    outage.source,
    target.id as target_id,
    target.target_kind,
    target.created_at as target_created_at,
    case when target.target_kind = 'exact_number' then 'ares' else 'mapy' end as required_provider
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and target.target_kind in ('exact_number', 'street')
), progress as (
  select
    eligible.source,
    eligible.target_id,
    eligible.target_kind,
    eligible.target_created_at,
    lookup.lookup_status,
    lookup.finished_at,
    lookup.last_attempt_at
  from eligible
  left join public.complete_power_outage_target_lookups lookup
    on lookup.target_id = eligible.target_id
   and lookup.provider = eligible.required_provider
)
select
  source,
  count(*)::bigint as total_target_count,
  count(*) filter (where lookup_status in ('ready', 'not_found', 'skipped'))::bigint as completed_target_count,
  count(*) filter (where lookup_status is null or lookup_status = 'pending')::bigint as pending_target_count,
  count(*) filter (where lookup_status in ('error', 'needs_review'))::bigint as error_target_count,
  count(*) filter (where target_kind = 'exact_number')::bigint as exact_target_count,
  count(*) filter (where target_kind = 'street')::bigint as street_target_count,
  max(coalesce(finished_at, last_attempt_at)) as last_progress_at,
  count(*) filter (where target_kind = 'exact_number' and (lookup_status is null or lookup_status = 'pending'))::bigint as exact_pending_target_count,
  count(*) filter (where target_kind = 'street' and (lookup_status is null or lookup_status = 'pending'))::bigint as street_pending_target_count,
  max(coalesce(finished_at, last_attempt_at)) filter (where target_kind = 'exact_number') as exact_last_progress_at,
  max(coalesce(finished_at, last_attempt_at)) filter (where target_kind = 'street') as street_last_progress_at,
  min(target_created_at) filter (where target_kind = 'exact_number' and (lookup_status is null or lookup_status = 'pending')) as exact_oldest_pending_at,
  min(target_created_at) filter (where target_kind = 'street' and (lookup_status is null or lookup_status = 'pending')) as street_oldest_pending_at,
  count(*) filter (where target_kind = 'exact_number' and lookup_status in ('error', 'needs_review'))::bigint as exact_error_target_count,
  count(*) filter (where target_kind = 'street' and lookup_status in ('error', 'needs_review'))::bigint as street_error_target_count
from progress
group by source;

revoke all on table public.complete_power_outage_source_discovery_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_overview
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

select 'VIEW' as check_type, 'required provider errors are split by target kind' as object_name,
  pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
    like '%exact_error_target_count%'
    and pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
      like '%street_error_target_count%' as is_correct
union all
select 'SCOPE', 'required progress includes only active 30 day targets',
  pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
    like '%30 days%'
union all
select 'ISOLATION', 'required progress does not reference MARKET outage tables',
  pg_get_viewdef('public.complete_power_outage_source_discovery_overview'::regclass, true)
    not like '%market_power_outage%';
