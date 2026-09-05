begin;

-- Ruční přeskočení je dovoleno pouze pro aktuální chyby needs_review u ARES
-- a Mapy.com. Řádky nemažeme: původní chyba i počet pokusů zůstávají pro audit.
create or replace function public.skip_complete_power_outage_provider_review_errors(
  requested_provider text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  safe_provider text := pg_catalog.lower(pg_catalog.btrim(coalesce(requested_provider, '')));
begin
  if safe_provider not in ('ares', 'mapy') then
    raise exception 'Přeskočení není pro poskytovatele % povoleno.', requested_provider;
  end if;

  update public.complete_power_outage_target_lookups lookup
  set lookup_status = 'skipped',
      next_attempt_at = null,
      finished_at = now(),
      metadata = coalesce(lookup.metadata, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'manualSkipRequestedAt', now(),
          'manualSkipPreviousErrorCode', lookup.last_error_code,
          'manualSkipPreviousErrorMessage', lookup.last_error_message,
          'manualSkipAttemptCount', lookup.attempt_count
        )
  from public.complete_power_outage_address_targets target,
       public.complete_power_outage_addresses address,
       public.complete_power_outages outage
  where lookup.target_id = target.id
    and target.outage_address_id = address.id
    and address.outage_id = outage.id
    and lookup.provider = safe_provider
    and lookup.lookup_status = 'needs_review'
    and outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and (
      (safe_provider = 'ares' and target.target_kind = 'exact_number')
      or (safe_provider = 'mapy' and target.target_kind in ('exact_number', 'street'))
    );

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.skip_complete_power_outage_provider_review_errors(text)
  from public, anon, authenticated;
grant execute on function public.skip_complete_power_outage_provider_review_errors(text)
  to service_role;

commit;

select 'FUNCTION' as check_type,
       'skip complete provider review errors' as object_name,
       to_regprocedure('public.skip_complete_power_outage_provider_review_errors(text)') is not null as is_correct
union all
select 'GRANT',
       'authenticated cannot skip provider errors',
       not has_function_privilege('authenticated', 'public.skip_complete_power_outage_provider_review_errors(text)', 'EXECUTE')
union all
select 'SAFETY',
       'skip changes only needs_review rows',
       pg_get_functiondef('public.skip_complete_power_outage_provider_review_errors(text)'::regprocedure)
         like '%lookup.lookup_status = ''needs_review''%'
union all
select 'SAFETY',
       'skip preserves original error columns',
       pg_get_functiondef('public.skip_complete_power_outage_provider_review_errors(text)'::regprocedure)
         not like '%last_error_code =%'
union all
select 'ISOLATION',
       'skip does not reference MARKET tables',
       pg_get_functiondef('public.skip_complete_power_outage_provider_review_errors(text)'::regprocedure)
         not ilike '%market_power_outage%'
order by check_type, object_name;
