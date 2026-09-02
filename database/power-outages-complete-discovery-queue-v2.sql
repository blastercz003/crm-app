begin;

-- Providerová fronta režimu KOMPLETNÍ. Funkce vybírá skutečně nezpracované
-- cíle, střídá distributory po jednom a upřednostňuje obchodně využitelné
-- odstávky. Tabulky a matching režimu MARKETY nijak nemění.
create or replace function public.get_complete_power_outage_discovery_targets(
  requested_provider text,
  requested_limit integer default 1000
)
returns table (
  id uuid,
  outage_address_id uuid,
  target_kind text,
  municipality text,
  town_part text,
  street text,
  number_token text,
  query_text text,
  latitude double precision,
  longitude double precision
)
language sql
security definer
set search_path = ''
stable
as $$
  with eligible as (
    select
      target.id,
      target.outage_address_id,
      target.target_kind,
      target.municipality,
      target.town_part,
      target.street,
      target.number_token,
      target.query_text,
      target.latitude,
      target.longitude,
      outage.source,
      case when lookup.lookup_status = 'error' then 0 else 1 end as retry_priority,
      case
        when outage.starts_at >= now() + interval '7 days'
         and outage.starts_at <= now() + interval '30 days' then 0
        when outage.starts_at >= now() + interval '2 days'
         and outage.starts_at < now() + interval '7 days' then 1
        when outage.starts_at < now() + interval '2 days' then 2
        else 3
      end as business_priority,
      case target.target_kind
        when 'exact_number' then 0
        when 'street' then 1
        else 2
      end as precision_priority,
      outage.starts_at,
      target.lookup_priority,
      target.created_at
    from public.complete_power_outage_address_targets target
    join public.complete_power_outage_addresses address
      on address.id = target.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    left join public.complete_power_outage_target_lookups lookup
      on lookup.target_id = target.id
     and lookup.provider = lower(btrim(requested_provider))
    where lower(btrim(requested_provider)) in ('ares', 'mapy', 'google')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and (
        (lower(btrim(requested_provider)) = 'ares' and target.target_kind = 'exact_number')
        or (lower(btrim(requested_provider)) in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
      )
      and (
        lookup.id is null
        or (
          lookup.lookup_status = 'error'
          and (lookup.next_attempt_at is null or lookup.next_attempt_at <= now())
        )
      )
  ), ranked as (
    select eligible.*,
      row_number() over (
        partition by eligible.source
        order by
          eligible.retry_priority,
          eligible.business_priority,
          eligible.precision_priority,
          eligible.lookup_priority,
          eligible.starts_at,
          eligible.created_at,
          eligible.id
      ) as source_position
    from eligible
  )
  select
    ranked.id,
    ranked.outage_address_id,
    ranked.target_kind,
    ranked.municipality,
    ranked.town_part,
    ranked.street,
    ranked.number_token,
    ranked.query_text,
    ranked.latitude,
    ranked.longitude
  from ranked
  order by
    ranked.source_position,
    case ranked.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    ranked.business_priority,
    ranked.precision_priority,
    ranked.starts_at,
    ranked.created_at,
    ranked.id
  limit least(5000, greatest(1, coalesce(requested_limit, 1000)));
$$;

revoke all on function public.get_complete_power_outage_discovery_targets(text, integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_discovery_targets(text, integer)
  to service_role;

-- Skutečný postup dohledávání firem pro každého distributora. Celkové počty
-- zahrnují obchodně prioritní horizont 30 dní. Přesný cíl vyžaduje ARES,
-- široký uliční cíl Mapy.com; Google je doplňkový zdroj a neblokuje dokončení.
create or replace view public.complete_power_outage_source_discovery_overview
with (security_invoker = true)
as
with eligible as (
  select
    outage.source,
    target.id as target_id,
    target.target_kind,
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
  count(*) filter (where lookup_status = 'error')::bigint as error_target_count,
  count(*) filter (where target_kind = 'exact_number')::bigint as exact_target_count,
  count(*) filter (where target_kind = 'street')::bigint as street_target_count,
  max(coalesce(finished_at, last_attempt_at)) as last_progress_at
from progress
group by source;

revoke all on table public.complete_power_outage_source_discovery_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_discovery_overview
  to authenticated, service_role;

create or replace view public.complete_power_outage_source_provider_overview
with (security_invoker = true)
as
with providers(provider) as (
  values ('ares'::text), ('mapy'::text), ('google'::text)
), eligible as (
  select
    outage.source,
    providers.provider,
    target.id as target_id
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address
    on address.id = target.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address.outage_id
  cross join providers
  where outage.source_status in ('scheduled', 'active')
    and outage.ends_at >= now()
    and outage.starts_at <= now() + interval '30 days'
    and (
      (providers.provider = 'ares' and target.target_kind = 'exact_number')
      or (providers.provider in ('mapy', 'google') and target.target_kind in ('exact_number', 'street'))
    )
)
select
  eligible.source,
  eligible.provider,
  count(*)::bigint as total_target_count,
  count(*) filter (where lookup.lookup_status in ('ready', 'not_found', 'skipped'))::bigint as completed_target_count,
  count(*) filter (where lookup.id is null or lookup.lookup_status = 'pending')::bigint as pending_target_count,
  count(*) filter (where lookup.lookup_status = 'ready')::bigint as found_target_count,
  count(*) filter (where lookup.lookup_status = 'not_found')::bigint as not_found_target_count,
  count(*) filter (where lookup.lookup_status = 'error')::bigint as error_target_count,
  max(coalesce(lookup.finished_at, lookup.last_attempt_at)) as last_progress_at
from eligible
left join public.complete_power_outage_target_lookups lookup
  on lookup.target_id = eligible.target_id
 and lookup.provider = eligible.provider
group by eligible.source, eligible.provider;

revoke all on table public.complete_power_outage_source_provider_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_source_provider_overview
  to authenticated, service_role;

-- Ruční diagnostický spouštěč respektuje stejné maximum jako API. Automatický
-- pipeline používá vlastní bezpečné velikosti dávek.
create or replace function public.request_complete_power_outage_company_discovery(
  requested_provider text,
  requested_limit integer default 5
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_provider text := lower(btrim(coalesce(requested_provider, '')));
  safe_limit integer := least(100, greatest(1, coalesce(requested_limit, 5)));
  request_id bigint;
begin
  if safe_provider not in ('ares', 'mapy', 'google') then
    raise exception 'Poskytovatel musí být ares, mapy nebo google.';
  end if;
  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url není platný.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí.';
  end if;
  select net.http_get(
    url := app_url || '/api/power-outages/complete/discover?provider=' || safe_provider
      || '&limit=' || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Outages-Discovery/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.request_complete_power_outage_company_discovery(text, integer)
  from public, anon, authenticated;
grant execute on function public.request_complete_power_outage_company_discovery(text, integer)
  to service_role;

-- Pipeline poběží častěji, ale stahování ČEZ, EG.D ani PRE se tím nemění.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'power_outages_complete_pipeline_every_fifteen_minutes',
      'power_outages_complete_pipeline_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_complete_pipeline_every_five_minutes',
    '4-59/5 * * * *',
    $job$select public.request_complete_power_outage_runtime_pipeline();$job$
  );
end
$$;

commit;

select 'CRON' as check_type,
  'complete pipeline every five minutes' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_pipeline_every_five_minutes'
      and schedule = '4-59/5 * * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'fair complete discovery target queue',
  to_regprocedure('public.get_complete_power_outage_discovery_targets(text,integer)') is not null
union all
select 'GRANT', 'authenticated discovery overview read-only',
  has_table_privilege('authenticated', 'public.complete_power_outage_source_discovery_overview', 'SELECT')
  and not has_table_privilege('authenticated', 'public.complete_power_outage_address_targets', 'INSERT')
union all
select 'VIEW', 'complete source discovery overview',
  to_regclass('public.complete_power_outage_source_discovery_overview') is not null
union all
select 'VIEW', 'complete source provider overview',
  to_regclass('public.complete_power_outage_source_provider_overview') is not null
order by check_type, object_name;
