begin;

-- Aktivace je povolena jen nad kompletne zpracovanou a proverovanou stinovou v2.
do $$
begin
  if to_regclass('public.complete_power_outage_top_selection_state') is null
     or to_regclass('public.complete_power_outage_company_top_selections') is null
     or to_regclass('public.complete_power_outage_top_selection_overview') is null
     or to_regprocedure('public.complete_power_outage_top_primary_nace_is_precise(text)') is null
     or to_regprocedure('public.complete_power_outage_top_primary_nace_allowed(text)') is null
  then
    raise exception 'Chybi nasazeny TOP VYBER shadow v2.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_top_selection_state
    where singleton
      and shadow_enabled
      and not ui_enabled
      and rules_version = 2
      and last_error_code is null
      and metadata ->> 'contract' = 'complete-top-selection-shadow-v2'
  ) then
    raise exception 'TOP VYBER shadow v2 neni v auditovatelnem stavu pro aktivaci.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_top_selection_overview
    where represented_count = current_grade_a_count
      and error_count = 0
  ) then
    raise exception 'TOP VYBER shadow v2 nema zpracovane vsechny aktualni firmy A.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_company_top_selections
    where top_eligible
      and (
        evaluation_status <> 'eligible'
        or cardinality(exclusion_codes) > 0
        or not public.complete_power_outage_top_primary_nace_is_precise(primary_nace_code)
      )
  ) then
    raise exception 'TOP VYBER shadow v2 obsahuje zaznam, ktery nesplnuje tvrde podminky.';
  end if;

  if not public.complete_power_outage_top_primary_nace_allowed('46850')
     or public.complete_power_outage_top_primary_nace_allowed('43320')
  then
    raise exception 'Klicove kontrolni podminky TOP VYBERU v2 neodpovidaji schvalene verzi.';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'complete-power-outage-top-selection-shadow-v2'
      and active
      and schedule = '* * * * *'
      and command = 'select public.refresh_complete_power_outage_top_selection_shadow(1000);'
  ) then
    raise exception 'Pravidelny minutovy prepocet TOP VYBERU v2 neni aktivni.';
  end if;
end
$$;

-- Manifesty pravidel jsou nemenne obchodni verze. Interni shadow v2 se nyni
-- publikuje jako prvni uzivatelska verze TOP VYBERU.
create table if not exists public.complete_power_outage_top_selection_versions (
  version_key text primary key,
  display_name text not null,
  display_version text not null,
  rules_date date not null,
  internal_rules_version integer not null check (internal_rules_version > 0),
  candidate_grade text not null default 'A' check (candidate_grade = 'A'),
  lifecycle_status text not null check (lifecycle_status in ('draft', 'active', 'archived')),
  rules_contract jsonb not null check (jsonb_typeof(rules_contract) = 'object'),
  activated_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cpo_top_selection_version_activation_check check (
    lifecycle_status <> 'active' or activated_at is not null
  )
);

create unique index if not exists cpo_top_selection_one_active_version_idx
  on public.complete_power_outage_top_selection_versions ((lifecycle_status))
  where lifecycle_status = 'active';

-- Snapshot uchovava presny vysledek v okamziku publikace. Zive vysledky
-- zustavaji v complete_power_outage_company_top_selections a dale se meni
-- pouze podle nemenneho kontraktu aktivni verze.
create table if not exists public.complete_power_outage_top_selection_version_snapshot (
  version_key text not null
    references public.complete_power_outage_top_selection_versions(version_key) on delete restrict,
  -- Historicky identifikator zamerne nema FK do ziveho katalogu. Auditni
  -- snapshot tak nikdy neblokuje bezne odstraneni zanikleho kandidata.
  candidate_id uuid not null,
  evaluation_status text not null,
  top_eligible boolean not null,
  primary_nace_code text,
  reason_codes text[] not null,
  exclusion_codes text[] not null,
  evidence jsonb not null,
  calculation_input_hash text not null,
  evaluated_at timestamptz,
  captured_at timestamptz not null default now(),
  primary key (version_key, candidate_id),
  constraint cpo_top_version_snapshot_status_check check (
    evaluation_status in ('eligible', 'excluded', 'needs_review')
  ),
  constraint cpo_top_version_snapshot_eligibility_check check (
    top_eligible = (evaluation_status = 'eligible')
  )
);

-- Uklid pripadne drive vytvorene varianty migrace. Auditni historie nesmi
-- tvorit referencni zamek nad zivymi kandidaty.
alter table public.complete_power_outage_top_selection_version_snapshot
  drop constraint if exists complete_power_outage_top_selection_version_snapshot_candidate_id_fkey;

alter table public.complete_power_outage_top_selection_versions enable row level security;
alter table public.complete_power_outage_top_selection_version_snapshot enable row level security;

drop policy if exists cpo_top_selection_versions_authorized_read
  on public.complete_power_outage_top_selection_versions;
create policy cpo_top_selection_versions_authorized_read
  on public.complete_power_outage_top_selection_versions
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_top_selection_version_snapshot_authorized_read
  on public.complete_power_outage_top_selection_version_snapshot;
create policy cpo_top_selection_version_snapshot_authorized_read
  on public.complete_power_outage_top_selection_version_snapshot
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_top_selection_versions
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_top_selection_version_snapshot
  from public, anon, authenticated;
grant select on table public.complete_power_outage_top_selection_versions to authenticated;
grant select on table public.complete_power_outage_top_selection_version_snapshot to authenticated;
grant all on table public.complete_power_outage_top_selection_versions to service_role;
grant all on table public.complete_power_outage_top_selection_version_snapshot to service_role;

insert into public.complete_power_outage_top_selection_versions (
  version_key,
  display_name,
  display_version,
  rules_date,
  internal_rules_version,
  candidate_grade,
  lifecycle_status,
  rules_contract,
  activated_at
)
values (
  'top-v1-2026-09-11',
  'TOP VÝBĚR',
  'v1 – 11. 9. 26',
  date '2026-09-11',
  2,
  'A',
  'active',
  jsonb_build_object(
    'contract', 'complete-top-selection-v1-2026-09-11',
    'sourceShadowContract', 'complete-top-selection-shadow-v2',
    'candidateUniverse', 'current-visible-grade-a',
    'minimumPrimaryNaceDigits', 4,
    'minimumOutageHours', 3,
    'primaryNaceOnly', true,
    'allowedGroups', jsonb_build_array(
      '10', '11', '13', '14', '15', '16', '17', '18',
      '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32',
      '36', '37', '38', '4211', '4675', '4685', '5210',
      '6110', '6120', '6130', '6190', '6311', '8610'
    ),
    'excludedBroadBuildingGroups', jsonb_build_array('41', '43'),
    'hardExclusions', jsonb_build_array(
      'company_in_liquidation',
      'terminated_company',
      'natural_person_registered_office_only',
      'noncommercial_association_firefighter_or_hunting_entity',
      'low_fit_business_name',
      'true_mass_or_virtual_office',
      'outage_shorter_than_three_hours'
    ),
    'insufficientNaceStatus', 'needs_review',
    'enrichmentCompletenessAffectsSelection', false,
    'liveEvaluation', true,
    'evaluationIntervalMinutes', 1,
    'activationSnapshotCount', (
      select count(*)
      from public.complete_power_outage_company_top_selections
      where rules_version = 2
        and evaluation_status in ('eligible', 'excluded', 'needs_review')
    )
  ),
  now()
)
on conflict (version_key) do update
set lifecycle_status = 'active',
    activated_at = coalesce(
      public.complete_power_outage_top_selection_versions.activated_at,
      excluded.activated_at
    )
where public.complete_power_outage_top_selection_versions.internal_rules_version = 2
  and public.complete_power_outage_top_selection_versions.rules_contract ->> 'contract'
    = 'complete-top-selection-v1-2026-09-11';

insert into public.complete_power_outage_top_selection_version_snapshot (
  version_key,
  candidate_id,
  evaluation_status,
  top_eligible,
  primary_nace_code,
  reason_codes,
  exclusion_codes,
  evidence,
  calculation_input_hash,
  evaluated_at
)
select
  'top-v1-2026-09-11',
  candidate_id,
  evaluation_status,
  top_eligible,
  primary_nace_code,
  reason_codes,
  exclusion_codes,
  evidence,
  calculation_input_hash,
  evaluated_at
from public.complete_power_outage_company_top_selections
where rules_version = 2
  and evaluation_status in ('eligible', 'excluded', 'needs_review')
  and not exists (
    select 1
    from public.complete_power_outage_top_selection_version_snapshot existing_snapshot
    where existing_snapshot.version_key = 'top-v1-2026-09-11'
  )
on conflict (version_key, candidate_id) do nothing;

create index if not exists cpo_top_selection_live_filter_idx
  on public.complete_power_outage_company_top_selections (candidate_id)
  where top_eligible;

-- Nova strankovaci funkce pouziva pro volbu `top` vyhradne publikovany
-- TOP VYBER. A/B a vsechny ostatni filtry zustavaji beze zmeny.
create or replace function public.get_complete_power_outage_company_page_v5(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all',
  p_sort text default 'date'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  safe_limit integer := least(100, greatest(1, coalesce(p_limit, 60)));
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result jsonb;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_sort not in ('date', 'score') then raise exception 'Neplatné řazení obchodního výběru.'; end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_commercial_filter not in ('all', 'top', 'grade_a', 'grade_b') then raise exception 'Neplatný obchodní výběr.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  with page_rows as materialized (
    select company.id as candidate_id,
      case when p_mode = 'current' then outage.starts_at else outage.ends_at end as sort_at,
      coalesce(score_row.score, -1) as sort_score
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
    left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
    left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = company.id
    where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
      and company.business_relevance_status = 'eligible'
      and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
        or (p_mode = 'archive' and outage.ends_at < now()))
      and (p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review')
        or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status)
      and (p_source = 'all' or outage.source::text = p_source)
      and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
      and (p_commercial_filter = 'all' or (
        p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
        or p_commercial_filter = 'grade_a' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
        or p_commercial_filter = 'grade_b' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'))
      and (p_owner_filter = 'all'
        or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
        or p_owner_filter = 'unassigned' and assignment.owner_id is null
        or selected_owner is not null and assignment.owner_id = selected_owner)
      and (clean_query = ''
        or company.company_name ilike '%' || clean_query || '%'
        or coalesce(company.ico, '') ilike '%' || clean_query || '%'
        or address.municipality ilike '%' || clean_query || '%'
        or address.street ilike '%' || clean_query || '%'
        or address.raw_address ilike '%' || clean_query || '%'
        or coalesce(company.display_address, '') ilike '%' || clean_query || '%')
      and (p_cursor_at is null or p_cursor_id is null or (
        p_sort = 'date' and (
          p_mode = 'current' and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
          or p_mode = 'archive' and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id))
        or p_sort = 'score' and p_cursor_score is not null and (
          coalesce(score_row.score, -1) < p_cursor_score
          or coalesce(score_row.score, -1) = p_cursor_score and p_mode = 'current'
            and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
          or coalesce(score_row.score, -1) = p_cursor_score and p_mode = 'archive'
            and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id))))
    order by
      case when p_sort = 'score' then coalesce(score_row.score, -1) end desc,
      case when p_mode = 'current' then outage.starts_at end asc,
      case when p_mode = 'archive' then outage.ends_at end desc,
      case when p_mode = 'current' then company.id end asc,
      case when p_mode = 'archive' then company.id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select * from page_rows
    order by
      case when p_sort = 'score' then sort_score end desc,
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select row_number() over (order by
        case when p_sort = 'score' then visible_rows.sort_score end desc,
        case when p_mode = 'current' then visible_rows.sort_at end asc,
        case when p_mode = 'archive' then visible_rows.sort_at end desc,
        case when p_mode = 'current' then visible_rows.candidate_id end asc,
        case when p_mode = 'archive' then visible_rows.candidate_id end desc) as position,
      visible_rows.sort_at,
      visible_rows.sort_score,
      visible_rows.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id,
        'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status,
        'notes', assignment.notes,
        'claimed_at', assignment.claimed_at,
        'assignment_updated_at', assignment.updated_at,
        'commercial_score', score_row.score,
        'commercial_grade', score_row.grade,
        'commercial_selection_eligible', coalesce(top_row.top_eligible, false),
        'commercial_score_status', score_row.score_status
      ) as item
    from visible_rows
    join public.complete_power_outage_company_overview overview on overview.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = visible_rows.candidate_id
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by position) from serialized), '[]'::jsonb),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (
      select jsonb_build_object('at', sort_at, 'id', candidate_id, 'score', sort_score)
      from serialized order by position desc limit 1
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.count_complete_power_outage_companies_v3(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all'
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result bigint;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_commercial_filter not in ('all', 'top', 'grade_a', 'grade_b') then raise exception 'Neplatný obchodní výběr.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  select count(*) into result
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = company.id
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
      or (p_mode = 'archive' and outage.ends_at < now()))
    and (p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review')
      or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status)
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (p_commercial_filter = 'all' or (
      p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
      or p_commercial_filter = 'grade_a' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'
      or p_commercial_filter = 'grade_b' and score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B'))
    and (p_owner_filter = 'all'
      or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
      or p_owner_filter = 'unassigned' and assignment.owner_id is null
      or selected_owner is not null and assignment.owner_id = selected_owner)
    and (clean_query = ''
      or company.company_name ilike '%' || clean_query || '%'
      or coalesce(company.ico, '') ilike '%' || clean_query || '%'
      or address.municipality ilike '%' || clean_query || '%'
      or address.street ilike '%' || clean_query || '%'
      or address.raw_address ilike '%' || clean_query || '%'
      or coalesce(company.display_address, '') ilike '%' || clean_query || '%');
  return result;
end;
$$;

create or replace function public.get_complete_power_outage_commercial_selection_counts_v2(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  clean_query text := btrim(coalesce(p_query, ''));
  selected_owner uuid := null;
  result jsonb;
begin
  if current_user_id is null or not public.current_user_can_view_power_outages() then
    raise exception 'Nemáte oprávnění zobrazit kompletní odstávky.' using errcode = '42501';
  end if;
  if p_mode not in ('current', 'archive') then raise exception 'Neplatný režim výpisu.'; end if;
  if p_source not in ('all', 'cez', 'egd', 'pre') then raise exception 'Neplatný distributor.'; end if;
  if p_entity_kind not in ('all', 'registered_office', 'establishment', 'mixed') then raise exception 'Neplatný typ firmy.'; end if;
  if p_candidate_status not in ('visible', 'confirmed', 'needs_review', 'dismissed') then raise exception 'Neplatný stav výsledku.'; end if;
  if p_owner_filter not in ('all', 'mine', 'unassigned') then
    if p_owner_filter !~ '^user:[0-9a-fA-F-]{36}$' then raise exception 'Neplatný filtr vlastníka.'; end if;
    selected_owner := substring(p_owner_filter from 6)::uuid;
  end if;

  select jsonb_build_object(
    'all', count(*),
    'top', count(*) filter (where coalesce(top_row.top_eligible, false)),
    'gradeA', count(*) filter (where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'A'),
    'gradeB', count(*) filter (where score_row.score_status in ('complete', 'preliminary') and score_row.grade = 'B')
  ) into result
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  left join public.complete_power_outage_company_assignments assignment on assignment.candidate_id = company.id
  left join public.complete_power_outage_company_scores score_row on score_row.candidate_id = company.id
  left join public.complete_power_outage_company_top_selections top_row on top_row.candidate_id = company.id
  where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
    and company.business_relevance_status = 'eligible'
    and ((p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
      or (p_mode = 'archive' and outage.ends_at < now()))
    and (p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review')
      or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status)
    and (p_source = 'all' or outage.source::text = p_source)
    and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
    and (p_owner_filter = 'all'
      or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
      or p_owner_filter = 'unassigned' and assignment.owner_id is null
      or selected_owner is not null and assignment.owner_id = selected_owner)
    and (clean_query = ''
      or company.company_name ilike '%' || clean_query || '%'
      or coalesce(company.ico, '') ilike '%' || clean_query || '%'
      or address.municipality ilike '%' || clean_query || '%'
      or address.street ilike '%' || clean_query || '%'
      or address.raw_address ilike '%' || clean_query || '%'
      or coalesce(company.display_address, '') ilike '%' || clean_query || '%');
  return result;
end;
$$;

-- Zpetne kompatibilni verejny nazev chrani klienta pri postupnem nasazeni.
-- Po aktivaci vraci stejna publikovana TOP data jako v2.
create or replace function public.get_complete_power_outage_commercial_selection_counts(
  p_mode text default 'current',
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.get_complete_power_outage_commercial_selection_counts_v2(
    p_mode,
    p_query,
    p_owner_filter,
    p_source,
    p_entity_kind,
    p_candidate_status
  );
$$;

revoke all on function public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)
  from public, anon;
revoke all on function public.count_complete_power_outage_companies_v3(text,text,text,text,text,text,text)
  from public, anon;
revoke all on function public.get_complete_power_outage_commercial_selection_counts_v2(text,text,text,text,text,text)
  from public, anon;
revoke all on function public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)
  from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v5(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.count_complete_power_outage_companies_v3(text,text,text,text,text,text,text)
  to authenticated;
grant execute on function public.get_complete_power_outage_commercial_selection_counts_v2(text,text,text,text,text,text)
  to authenticated;
grant execute on function public.get_complete_power_outage_commercial_selection_counts(text,text,text,text,text,text)
  to authenticated;

update public.complete_power_outage_top_selection_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'publishedContract', 'complete-top-selection-v1-2026-09-11',
      'publishedVersionKey', 'top-v1-2026-09-11',
      'publishedVersionLabel', 'v1 – 11. 9. 26',
      'publishedAt', (
        select activated_at
        from public.complete_power_outage_top_selection_versions
        where version_key = 'top-v1-2026-09-11'
      ),
      'defaultFilter', 'top'
    )
where singleton and shadow_enabled and rules_version = 2;

update public.complete_power_outage_commercial_selection_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'uiContract', 'complete-commercial-selection-ui-v3',
      'defaultFilter', 'top',
      'topSelectionName', 'TOP VÝBĚR',
      'topSelectionVersionLabel', 'v1 – 11. 9. 26',
      'topSelectionVersionKey', 'top-v1-2026-09-11',
      'topSelectionActivatedAt', (
        select activated_at
        from public.complete_power_outage_top_selection_versions
        where version_key = 'top-v1-2026-09-11'
      )
    )
where singleton and scoring_enabled;

do $$
begin
  if not exists (
    select 1
    from public.complete_power_outage_top_selection_state
    where singleton and shadow_enabled and ui_enabled and rules_version = 2
  ) or not exists (
    select 1
    from public.complete_power_outage_commercial_selection_state
    where singleton
      and scoring_enabled
      and ui_enabled
      and metadata ->> 'uiContract' = 'complete-commercial-selection-ui-v3'
      and metadata ->> 'defaultFilter' = 'top'
  ) then
    raise exception 'TOP VYBER v1 se nepodarilo aktivovat.';
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
