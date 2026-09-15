begin;

-- Lehký snapshot počtů pro ovládací prvky AI SELECT. Bez této projekce
-- get_cpo_multi_selector_options_v1 při každém otevření stránky opakovaně
-- procházel dynamický selector view a mohl překročit svůj timeout.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null
     or to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is null
     or to_regclass('public.complete_power_outage_ai_selector_set_v1') is null
     or to_regnamespace('cron') is null
  then
    raise exception 'Chybí závislosti pro odolné načítání administrátorských panelů KOMPLETNÍ.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_selector_count_cache_v1 (
  selector_key text primary key
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on update cascade on delete cascade,
  company_count bigint not null default 0 check (company_count >= 0),
  refreshed_at timestamptz not null default now()
);

alter table public.complete_power_outage_selector_count_cache_v1 enable row level security;
revoke all on table public.complete_power_outage_selector_count_cache_v1
  from public, anon, authenticated;
grant all on table public.complete_power_outage_selector_count_cache_v1 to service_role;

create or replace function public.refresh_complete_power_outage_selector_count_cache_v1()
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare refreshed_count integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended(
    'refresh_complete_power_outage_selector_count_cache_v1', 0
  )) then
    select count(*)::integer into refreshed_count
    from public.complete_power_outage_selector_count_cache_v1;
    return refreshed_count;
  end if;

  with counts as materialized (
    select target.selector_key, count(*)::bigint as company_count
    from public.complete_power_outage_contact_discovery_selector_targets target
    where target.selector_key <> 'multi_select_v1'
    group by target.selector_key
  )
  insert into public.complete_power_outage_selector_count_cache_v1 (
    selector_key, company_count, refreshed_at
  )
  select selector.selector_key, coalesce(counts.company_count, 0), now()
  from public.complete_power_outage_contact_discovery_selectors selector
  left join counts on counts.selector_key = selector.selector_key
  where selector.lifecycle_status = 'active'
    and selector.selector_key <> 'multi_select_v1'
  on conflict (selector_key) do update
  set company_count = excluded.company_count,
      refreshed_at = excluded.refreshed_at;

  delete from public.complete_power_outage_selector_count_cache_v1 cache
  where not exists (
    select 1
    from public.complete_power_outage_contact_discovery_selectors selector
    where selector.selector_key = cache.selector_key
      and selector.lifecycle_status = 'active'
      and selector.selector_key <> 'multi_select_v1'
  );

  select count(*)::integer into refreshed_count
  from public.complete_power_outage_selector_count_cache_v1;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_selector_count_cache_v1()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_selector_count_cache_v1()
  to service_role;

select public.refresh_complete_power_outage_selector_count_cache_v1();

create or replace function public.get_cpo_multi_selector_options_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Výběry AI SELECT jsou dostupné pouze administrátorům.';
  end if;

  select jsonb_build_object(
    'activeSelectorKeys', to_jsonb(selected.selector_keys),
    'activeSelectorNames', coalesce((
      select jsonb_agg(selector.display_name order by array_position(
        selected.selector_keys, selector.selector_key
      ))
      from public.complete_power_outage_contact_discovery_selectors selector
      where selector.selector_key = any(selected.selector_keys)
    ), '[]'::jsonb),
    'selectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', selector.selector_key,
        'name', selector.display_name,
        'companyCount', coalesce(cache.company_count, 0)
      ) order by case selector.selector_key
        when 'top_v1' then 1
        when 'large_companies_v1' then 2
        when 'operationally_sensitive_v3' then 3
        when 'grade_a' then 4
        when 'grade_b' then 5
        else 6 end)
      from public.complete_power_outage_contact_discovery_selectors selector
      left join public.complete_power_outage_selector_count_cache_v1 cache
        on cache.selector_key = selector.selector_key
      where selector.lifecycle_status = 'active'
        and selector.selector_key <> 'multi_select_v1'
    ), '[]'::jsonb),
    'countsRefreshedAt', (
      select min(cache.refreshed_at)
      from public.complete_power_outage_selector_count_cache_v1 cache
    )
  ) into result
  from public.complete_power_outage_ai_selector_set_v1 selected
  where selected.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_cpo_multi_selector_options_v1()
  from public, anon;
grant execute on function public.get_cpo_multi_selector_options_v1()
  to authenticated, service_role;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete-selector-count-cache-v1-refresh'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete-selector-count-cache-v1-refresh',
    '*/5 * * * *',
    $cron$select public.refresh_complete_power_outage_selector_count_cache_v1();$cron$
  );
end
$$;

notify pgrst, 'reload schema';
commit;

