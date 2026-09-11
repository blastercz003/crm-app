begin;

-- Neveřejný podklad pro audit budoucího filtru VELKÉ FIRMY.
-- Nemění TOP VÝBĚR, skóre A/B/C, candidate_status ani uživatelské rozhraní.
do $$
begin
  if to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_company_enrichment_queue') is null
     or to_regprocedure('public.current_user_can_view_power_outages()') is null
  then
    raise exception 'Chybí závislosti pro neveřejný audit VELKÉ FIRMY.';
  end if;
end
$$;

alter table public.complete_power_outage_company_profiles
  add column if not exists primary_nace_2025_code text,
  add column if not exists nace_2025_codes text[] not null default '{}'::text[],
  add column if not exists primary_nace_2008_code text,
  add column if not exists nace_2008_codes text[] not null default '{}'::text[],
  add column if not exists employee_category_code text;

alter table public.complete_power_outage_company_profiles
  drop constraint if exists cpo_company_profiles_primary_nace_2025_check,
  add constraint cpo_company_profiles_primary_nace_2025_check check (
    primary_nace_2025_code is null or primary_nace_2025_code ~ '^[0-9]{2,6}$'
  ),
  drop constraint if exists cpo_company_profiles_nace_2025_check,
  add constraint cpo_company_profiles_nace_2025_check check (
    cardinality(nace_2025_codes) = 0
    or (
      array_position(nace_2025_codes, null) is null
      and array_to_string(nace_2025_codes, ',') ~ '^[0-9]{2,6}(,[0-9]{2,6})*$'
    )
  ),
  drop constraint if exists cpo_company_profiles_primary_nace_2008_check,
  add constraint cpo_company_profiles_primary_nace_2008_check check (
    primary_nace_2008_code is null or primary_nace_2008_code ~ '^[0-9]{2,6}$'
  ),
  drop constraint if exists cpo_company_profiles_nace_2008_check,
  add constraint cpo_company_profiles_nace_2008_check check (
    cardinality(nace_2008_codes) = 0
    or (
      array_position(nace_2008_codes, null) is null
      and array_to_string(nace_2008_codes, ',') ~ '^[0-9]{2,6}(,[0-9]{2,6})*$'
    )
  ),
  drop constraint if exists cpo_company_profiles_employee_category_check,
  add constraint cpo_company_profiles_employee_category_check check (
    employee_category_code is null or employee_category_code ~ '^[0-9]{3}$'
  );

create index if not exists cpo_company_profiles_employee_category_idx
  on public.complete_power_outage_company_profiles (employee_category_code, ico);
create index if not exists cpo_company_profiles_primary_nace_2025_idx
  on public.complete_power_outage_company_profiles (primary_nace_2025_code, ico);

create or replace function public.complete_power_outage_employee_category_min(
  requested_code text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case requested_code
    when '110' then 0
    when '120' then 1
    when '130' then 6
    when '210' then 10
    when '220' then 20
    when '230' then 25
    when '240' then 50
    when '310' then 100
    when '320' then 200
    when '330' then 250
    when '340' then 500
    when '410' then 1000
    when '420' then 1500
    when '430' then 2000
    when '440' then 2500
    when '450' then 3000
    when '460' then 4000
    when '470' then 5000
    when '510' then 10000
    else null
  end;
$$;

create or replace function public.complete_power_outage_employee_category_max(
  requested_code text
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case requested_code
    when '110' then 0
    when '120' then 5
    when '130' then 9
    when '210' then 19
    when '220' then 24
    when '230' then 49
    when '240' then 99
    when '310' then 199
    when '320' then 249
    when '330' then 499
    when '340' then 999
    when '410' then 1499
    when '420' then 1999
    when '430' then 2499
    when '440' then 2999
    when '450' then 3999
    when '460' then 4999
    when '470' then 9999
    when '510' then null
    else null
  end;
$$;

create or replace function public.complete_power_outage_nace_section(
  requested_code text
)
returns text
language sql
immutable
set search_path = ''
as $$
  with normalized as (
    select nullif(regexp_replace(coalesce(requested_code, ''), '[^0-9]', '', 'g'), '') as code
  ), division_value as (
    select case when length(code) >= 2 then left(code, 2)::integer end as division
    from normalized
  )
  select case
    when division between 1 and 3 then 'A'
    when division between 5 and 9 then 'B'
    when division between 10 and 33 then 'C'
    when division = 35 then 'D'
    when division between 36 and 39 then 'E'
    when division between 41 and 43 then 'F'
    when division between 46 and 47 then 'G'
    when division between 49 and 53 then 'H'
    when division between 55 and 56 then 'I'
    when division between 58 and 60 then 'J'
    when division between 61 and 63 then 'K'
    when division between 64 and 66 then 'L'
    when division = 68 then 'M'
    when division between 69 and 75 then 'N'
    when division between 77 and 82 then 'O'
    when division = 84 then 'P'
    when division = 85 then 'Q'
    when division between 86 and 88 then 'R'
    when division between 90 and 93 then 'S'
    when division between 94 and 96 then 'T'
    when division between 97 and 98 then 'U'
    when division = 99 then 'V'
    else null
  end
  from division_value;
$$;

-- Jeden řádek odpovídá jednomu aktuálnímu POTVRZENÉMU záznamu tabulky.
-- Audit není postaven nad TOP VÝBĚREM ani nad běžnou známkou A/B/C.
create or replace view public.complete_power_outage_large_company_audit_inputs
with (security_invoker = true)
as
select
  company.id as candidate_id,
  company.ico,
  company.company_name,
  outage.source,
  outage.starts_at,
  outage.ends_at,
  profile.id as company_profile_id,
  profile.official_name,
  profile.legal_form,
  profile.subject_status,
  profile.is_in_liquidation,
  profile.is_terminated,
  coalesce(profile.primary_nace_2025_code, profile.primary_nace_code) as primary_nace_code,
  case
    when profile.primary_nace_2025_code is not null then 'cz-nace-2025'
    when profile.primary_nace_code is not null then 'legacy-or-unspecified'
    else null
  end as nace_version,
  public.complete_power_outage_nace_section(
    coalesce(profile.primary_nace_2025_code, profile.primary_nace_code)
  ) as nace_section,
  profile.employee_category_code,
  public.complete_power_outage_employee_category_min(profile.employee_category_code)
    as employee_count_min,
  public.complete_power_outage_employee_category_max(profile.employee_category_code)
    as employee_count_max,
  profile.id is not null as res_profile_available,
  profile.metadata ->> 'contract' as profile_contract,
  profile.metadata ->> 'primaryNace2025Source' as primary_nace_2025_source,
  coalesce(profile.metadata ->> 'contract' = 'complete-company-ares-res-v2', false)
    as audit_profile_current,
  profile.employee_category_code is not null
    and profile.employee_category_code <> '000'
    and public.complete_power_outage_employee_category_min(profile.employee_category_code) is not null
    as employee_size_known,
  coalesce(profile.is_in_liquidation, false) = false
    and coalesce(profile.is_terminated, false) = false as active_subject_gate,
  profile.fetched_at as profile_fetched_at
from public.complete_power_outage_companies company
join public.complete_power_outage_addresses address_row
  on address_row.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address_row.outage_id
left join public.complete_power_outage_company_profiles profile
  on profile.ico = company.ico
where company.candidate_status = 'confirmed'
  and outage.ends_at >= now()
  and outage.source_status in ('scheduled', 'active');

-- Čtyři srovnatelné varianty. Jde o velikostní audit všech POTVRZENÝCH
-- záznamů; výběr konkrétních NACE bude až další schválený krok.
create or replace view public.complete_power_outage_large_company_size_variants
with (security_invoker = true)
as
with thresholds(employee_threshold) as (
  values (25), (50), (100), (250)
), totals as (
  select count(*)::bigint as confirmed_record_count,
    count(distinct ico) filter (where ico is not null)::bigint as confirmed_ico_count
  from public.complete_power_outage_large_company_audit_inputs
)
select
  threshold.employee_threshold,
  total.confirmed_record_count,
  total.confirmed_ico_count,
  count(*) filter (where input.res_profile_available)::bigint as profile_record_count,
  count(distinct input.ico) filter (where input.res_profile_available)::bigint as profile_ico_count,
  count(*) filter (where input.employee_size_known)::bigint as known_size_record_count,
  count(distinct input.ico) filter (where input.employee_size_known)::bigint as known_size_ico_count,
  count(*) filter (
    where input.active_subject_gate
      and input.employee_count_min >= threshold.employee_threshold
  )::bigint as matching_record_count,
  count(distinct input.ico) filter (
    where input.active_subject_gate
      and input.employee_count_min >= threshold.employee_threshold
  )::bigint as matching_ico_count,
  round(100.0 * count(*) filter (
    where input.active_subject_gate
      and input.employee_count_min >= threshold.employee_threshold
  ) / nullif(total.confirmed_record_count, 0), 2) as share_of_confirmed_percent,
  round(100.0 * count(*) filter (
    where input.active_subject_gate
      and input.employee_count_min >= threshold.employee_threshold
  ) / nullif(count(*) filter (where input.employee_size_known), 0), 2)
    as share_of_known_size_percent
from thresholds threshold
cross join totals total
cross join public.complete_power_outage_large_company_audit_inputs input
group by threshold.employee_threshold, total.confirmed_record_count, total.confirmed_ico_count
order by threshold.employee_threshold;

-- Po nasazení aplikačního workeru v2 tuto funkci jednorázově spustí správce.
-- Existující profily se znovu načtou jen tehdy, pokud ještě nevznikly novým
-- auditním kontraktem. Aktivně zpracovávané položky se nepřepisují.
create or replace function public.enqueue_complete_power_outage_large_company_audit_enrichment()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer;
begin
  if not coalesce((
    select state_row.res_enrichment_enabled
    from public.complete_power_outage_commercial_selection_state state_row
    where state_row.singleton
  ), false) then
    raise exception 'ARES/RES enrichment není aktivní.';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('complete_large_company_audit_enrichment')) then
    return 0;
  end if;

  insert into public.complete_power_outage_company_enrichment_queue (
    ico, queue_status, priority, requested_sources, next_attempt_at, metadata
  )
  select distinct
    input.ico,
    'pending',
    90,
    array['res']::text[],
    now(),
    jsonb_build_object(
      'queueReason', 'large_company_private_audit',
      'requestedAt', now(),
      'requiredContract', 'complete-company-ares-res-v2'
    )
  from public.complete_power_outage_large_company_audit_inputs input
  where input.ico ~ '^[0-9]{8}$'
    and not input.audit_profile_current
  on conflict (ico) do update
  set queue_status = 'pending',
      priority = greatest(public.complete_power_outage_company_enrichment_queue.priority, 90),
      requested_sources = array['res']::text[],
      company_profile_id = null,
      attempt_count = 0,
      next_attempt_at = now(),
      processing_token = null,
      processing_expires_at = null,
      started_at = null,
      finished_at = null,
      last_error_code = null,
      last_error_message = null,
      metadata = public.complete_power_outage_company_enrichment_queue.metadata
        || jsonb_build_object(
          'refreshReason', 'large_company_private_audit',
          'requeuedAt', now(),
          'requiredContract', 'complete-company-ares-res-v2'
        )
  where public.complete_power_outage_company_enrichment_queue.queue_status <> 'processing';

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.complete_power_outage_employee_category_min(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_employee_category_max(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_nace_section(text)
  from public, anon, authenticated;
revoke all on function public.enqueue_complete_power_outage_large_company_audit_enrichment()
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_employee_category_min(text) to service_role;
grant execute on function public.complete_power_outage_employee_category_max(text) to service_role;
grant execute on function public.complete_power_outage_nace_section(text) to service_role;
grant execute on function public.enqueue_complete_power_outage_large_company_audit_enrichment() to service_role;

revoke all on table public.complete_power_outage_large_company_audit_inputs
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_large_company_size_variants
  from public, anon, authenticated;
grant select on table public.complete_power_outage_large_company_audit_inputs to service_role;
grant select on table public.complete_power_outage_large_company_size_variants to service_role;

notify pgrst, 'reload schema';

commit;
