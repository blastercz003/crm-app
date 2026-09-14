begin;

-- Rychla produkcni projekce clenstvi PROVOZNE CITLIVE v3.
-- Klasifikator se prepocita na pozadi; stranka, pocty, kontakty i upozorneni
-- nad nim uz provadeji pouze levny indexovany lookup.
do $$
begin
  if to_regprocedure('public.classify_complete_power_outage_operational_sensitivity_v3(uuid)') is null
     or to_regprocedure('public.complete_power_outage_is_operationally_sensitive_v3(uuid)') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_current') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_shadow_results') is null
     or to_regclass('public.complete_power_outage_operational_sensitivity_state') is null
     or to_regnamespace('cron') is null
  then
    raise exception 'Chybi zavislosti pro rychlou projekci PROVOZNE CITLIVE v3.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_operational_sensitivity_membership_v3 (
  candidate_id uuid primary key
    references public.complete_power_outage_companies(id) on delete cascade,
  outage_id uuid not null
    references public.complete_power_outages(id) on delete cascade,
  ico text,
  category text not null,
  refresh_token uuid not null,
  evaluated_at timestamptz not null default now(),
  constraint cpo_operational_membership_v3_ico_check check (
    ico is null or ico ~ '^[0-9]{8}$'
  )
);

create index if not exists cpo_operational_membership_v3_ico_idx
  on public.complete_power_outage_operational_sensitivity_membership_v3(ico)
  where ico is not null;

alter table public.complete_power_outage_operational_sensitivity_membership_v3
  enable row level security;
revoke all on table public.complete_power_outage_operational_sensitivity_membership_v3
  from public, anon, authenticated;
grant all on table public.complete_power_outage_operational_sensitivity_membership_v3
  to service_role;

-- Prvni publikace pouzije jiz schvaleny finalni SHADOW v3, proto je okamzita.
with current_state as (
  select latest_shadow_run_id
  from public.complete_power_outage_operational_sensitivity_state
  where singleton and rules_version = 3 and selector_enabled
), published as (
  select result.candidate_id, result.outage_id, result.ico, result.category
  from current_state state
  join public.complete_power_outage_operational_sensitivity_shadow_results result
    on result.run_id = state.latest_shadow_run_id
  where result.is_eligible
    and result.category is not null
), marker as (
  select gen_random_uuid() as refresh_token
)
insert into public.complete_power_outage_operational_sensitivity_membership_v3 (
  candidate_id, outage_id, ico, category, refresh_token, evaluated_at
)
select published.candidate_id, published.outage_id, published.ico,
  published.category, marker.refresh_token, now()
from published
cross join marker
on conflict (candidate_id) do update
set outage_id = excluded.outage_id,
    ico = excluded.ico,
    category = excluded.category,
    refresh_token = excluded.refresh_token,
    evaluated_at = excluded.evaluated_at;

create or replace function public.refresh_complete_power_outage_operational_sensitivity_membership_v3()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_refresh_token uuid := gen_random_uuid();
  eligible_count integer;
begin
  if not pg_try_advisory_xact_lock(hashtextextended(
    'refresh_complete_power_outage_operational_sensitivity_membership_v3', 0
  )) then
    select count(*)::integer into eligible_count
    from public.complete_power_outage_operational_sensitivity_membership_v3;
    return eligible_count;
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_operational_sensitivity_state state
    where state.singleton
      and state.rules_version = 3
      and state.rules_prepared
      and state.selector_enabled
      and state.ui_enabled
  ) then
    raise exception 'Produkci rezim PROVOZNE CITLIVE v3 neni aktivni.';
  end if;

  insert into public.complete_power_outage_operational_sensitivity_membership_v3 (
    candidate_id, outage_id, ico, category, refresh_token, evaluated_at
  )
  select current_result.candidate_id, current_result.outage_id,
    current_result.ico, current_result.category, new_refresh_token, now()
  from public.complete_power_outage_operational_sensitivity_shadow_current current_result
  where current_result.is_eligible
    and current_result.category is not null
  on conflict (candidate_id) do update
  set outage_id = excluded.outage_id,
      ico = excluded.ico,
      category = excluded.category,
      refresh_token = excluded.refresh_token,
      evaluated_at = excluded.evaluated_at;

  delete from public.complete_power_outage_operational_sensitivity_membership_v3 membership
  where membership.refresh_token <> new_refresh_token;

  select count(*)::integer into eligible_count
  from public.complete_power_outage_operational_sensitivity_membership_v3;

  update public.complete_power_outage_operational_sensitivity_state
  set metadata = metadata || jsonb_build_object(
        'productionProjection', 'complete_power_outage_operational_sensitivity_membership_v3',
        'productionProjectionCount', eligible_count,
        'productionProjectionRefreshedAt', now(),
        'productionProjectionIntervalMinutes', 5,
        'externalRequestMade', false
      ),
      updated_at = now()
  where singleton;

  return eligible_count;
end;
$$;

revoke all on function public.refresh_complete_power_outage_operational_sensitivity_membership_v3()
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_operational_sensitivity_membership_v3()
  to service_role;

create or replace function public.complete_power_outage_is_operationally_sensitive_v3(
  requested_candidate_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.complete_power_outage_operational_sensitivity_membership_v3 membership
    join public.complete_power_outage_companies company
      on company.id = membership.candidate_id
     and company.candidate_status = 'confirmed'
     and company.business_relevance_status = 'eligible'
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
     and outage.ends_at >= now()
     and outage.source_status in ('scheduled', 'active')
    where membership.candidate_id = requested_candidate_id
  );
$$;

revoke all on function public.complete_power_outage_is_operationally_sensitive_v3(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_is_operationally_sensitive_v3(uuid)
  to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'complete-operational-sensitivity-membership-v3-refresh'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete-operational-sensitivity-membership-v3-refresh',
    '*/5 * * * *',
    $cron$select public.refresh_complete_power_outage_operational_sensitivity_membership_v3();$cron$
  );
end
$$;

update public.complete_power_outage_operational_sensitivity_state
set metadata = metadata || jsonb_build_object(
      'productionProjection', 'complete_power_outage_operational_sensitivity_membership_v3',
      'productionProjectionInstalledAt', now(),
      'productionProjectionIntervalMinutes', 5,
      'countsUseDynamicClassifier', false,
      'externalRequestMade', false,
      'emailRuntimeChanged', false
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;
