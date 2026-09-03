begin;

alter table public.complete_power_outage_companies
  add column if not exists business_relevance_status text not null default 'pending',
  add column if not exists business_relevance_version integer not null default 0,
  add column if not exists business_relevance_reasons text[] not null default '{}'::text[],
  add column if not exists business_relevance_evaluated_at timestamptz,
  add column if not exists business_relevance_override boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.complete_power_outage_companies'::regclass
      and conname = 'cpo_companies_business_relevance_check'
  ) then
    alter table public.complete_power_outage_companies
      add constraint cpo_companies_business_relevance_check check (
        business_relevance_status in ('pending', 'eligible', 'excluded_natural_person', 'needs_review')
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.complete_power_outage_companies'::regclass
      and conname = 'cpo_companies_business_relevance_version_check'
  ) then
    alter table public.complete_power_outage_companies
      add constraint cpo_companies_business_relevance_version_check check (
        business_relevance_version >= 0
      );
  end if;
end;
$$;

create index if not exists cpo_companies_business_relevance_idx
  on public.complete_power_outage_companies (
    business_relevance_status,
    candidate_status,
    last_seen_at desc
  );

-- Jednorázové vratné zatřídění existujících kandidátů. Nic se nemaže.
-- Přesně potvrzená veřejná provozovna má přednost před právní formou vlastníka.
update public.complete_power_outage_companies company
set
  business_relevance_status = case
    when exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('mapy', 'google')
        and evidence.evidence_kind = 'establishment'
        and evidence.match_level in ('exact_address', 'same_building')
    ) then 'eligible'
    when btrim(coalesce(company.legal_form, '')) in (
      '100', '101', '102', '103', '104', '105', '106', '107', '108', '424', '425'
    ) and exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('ares', 'res')
        and evidence.evidence_kind = 'registered_office'
    ) then 'excluded_natural_person'
    when btrim(coalesce(company.legal_form, '')) <> ''
      and btrim(company.legal_form) not in (
        '000', '100', '101', '102', '103', '104', '105', '106', '107', '108', '424', '425'
      ) then 'eligible'
    when exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('mapy', 'google')
        and evidence.evidence_kind = 'establishment'
    ) then 'eligible'
    else 'needs_review'
  end,
  business_relevance_version = 2,
  business_relevance_reasons = case
    when exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('mapy', 'google')
        and evidence.evidence_kind = 'establishment'
        and evidence.match_level in ('exact_address', 'same_building')
    ) then array['public_establishment_exact']::text[]
    when btrim(coalesce(company.legal_form, '')) in (
      '100', '101', '102', '103', '104', '105', '106', '107', '108', '424', '425'
    ) and exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('ares', 'res')
        and evidence.evidence_kind = 'registered_office'
    ) then array['ares_natural_person_registered_office_only']::text[]
    when btrim(coalesce(company.legal_form, '')) not in ('', '000') then array['ares_legal_entity']::text[]
    when exists (
      select 1
      from public.complete_power_outage_company_evidence evidence
      where evidence.company_id = company.id
        and evidence.provider in ('mapy', 'google')
        and evidence.evidence_kind = 'establishment'
    ) then array['public_establishment']::text[]
    else array['business_relevance_uncertain']::text[]
  end,
  business_relevance_evaluated_at = now()
where not company.business_relevance_override;

create or replace view public.complete_power_outage_company_overview
with (security_invoker = true)
as
select
  company.id as candidate_id,
  company.outage_address_id,
  address.outage_id,
  outage.source,
  outage.external_id,
  outage.source_status,
  outage.title,
  outage.description,
  outage.starts_at,
  outage.ends_at,
  outage.archive_at,
  outage.source_url,
  outage.announcement_url,
  outage.first_seen_at,
  outage.last_seen_at,
  address.address_scope,
  address.municipality,
  address.town_part,
  address.street,
  address.house_number,
  address.orientation_number,
  address.postal_code,
  address.raw_address,
  address.latitude as address_latitude,
  address.longitude as address_longitude,
  company.company_name,
  company.ico,
  company.legal_form,
  company.nace_codes,
  company.employee_category,
  company.entity_kind,
  company.display_address,
  company.latitude,
  company.longitude,
  company.confidence,
  company.candidate_status,
  company.source_count,
  company.evaluation_version,
  company.evaluation_reasons,
  company.evaluated_at,
  company.resolved_at,
  company.metadata,
  coalesce((
    select array_agg(distinct evidence.provider order by evidence.provider)
    from public.complete_power_outage_company_evidence evidence
    where evidence.company_id = company.id
  ), '{}'::text[]) as evidence_providers,
  (select count(*)::integer
   from public.complete_power_outage_company_evidence evidence
   where evidence.company_id = company.id) as evidence_count,
  company.business_relevance_status,
  company.business_relevance_version,
  company.business_relevance_reasons,
  company.business_relevance_evaluated_at
from public.complete_power_outage_companies company
join public.complete_power_outage_addresses address
  on address.id = company.outage_address_id
join public.complete_power_outages outage
  on outage.id = address.outage_id;

revoke all on table public.complete_power_outage_company_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_overview to authenticated;

create or replace function public.get_complete_power_outage_company_page(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
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
  safe_limit integer := least(100, greatest(1, coalesce(p_limit, 60)));
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

  with filtered as materialized (
    select
      company.id as candidate_id,
      case when p_mode = 'current' then outage.starts_at else outage.ends_at end as sort_at
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = company.id
    where
      company.business_relevance_status = 'eligible'
      and company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
      and (
        (p_mode = 'current' and outage.ends_at >= now() and outage.source_status in ('scheduled', 'active'))
        or (p_mode = 'archive' and outage.ends_at < now())
      )
      and (
        p_candidate_status = 'visible' and company.candidate_status in ('confirmed', 'needs_review')
        or p_candidate_status <> 'visible' and company.candidate_status = p_candidate_status
      )
      and (p_source = 'all' or outage.source::text = p_source)
      and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
      and (
        p_owner_filter = 'all'
        or p_owner_filter = 'mine' and assignment.owner_id = current_user_id
        or p_owner_filter = 'unassigned' and assignment.owner_id is null
        or selected_owner is not null and assignment.owner_id = selected_owner
      )
      and (
        clean_query = ''
        or company.company_name ilike '%' || clean_query || '%'
        or coalesce(company.ico, '') ilike '%' || clean_query || '%'
        or address.municipality ilike '%' || clean_query || '%'
        or address.street ilike '%' || clean_query || '%'
        or address.raw_address ilike '%' || clean_query || '%'
        or coalesce(company.display_address, '') ilike '%' || clean_query || '%'
      )
  ), page_rows as materialized (
    select * from filtered
    where p_cursor_at is null or p_cursor_id is null or (
      p_mode = 'current' and (sort_at, candidate_id) > (p_cursor_at, p_cursor_id)
      or p_mode = 'archive' and (sort_at, candidate_id) < (p_cursor_at, p_cursor_id)
    )
    order by
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select * from page_rows
    order by
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select
      row_number() over (order by
        case when p_mode = 'current' then visible_rows.sort_at end asc,
        case when p_mode = 'archive' then visible_rows.sort_at end desc,
        case when p_mode = 'current' then visible_rows.candidate_id end asc,
        case when p_mode = 'archive' then visible_rows.candidate_id end desc
      ) as position,
      visible_rows.sort_at,
      visible_rows.candidate_id,
      to_jsonb(overview) || jsonb_build_object(
        'owner_id', assignment.owner_id,
        'owner_name', assignment.owner_name,
        'communication_status', assignment.communication_status,
        'notes', assignment.notes,
        'claimed_at', assignment.claimed_at,
        'assignment_updated_at', assignment.updated_at
      ) as item
    from visible_rows
    join public.complete_power_outage_company_overview overview
      on overview.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = visible_rows.candidate_id
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(item order by position) from serialized), '[]'::jsonb),
    'totalCount', (select count(*) from filtered),
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (
      select jsonb_build_object('at', sort_at, 'id', candidate_id)
      from serialized order by position desc limit 1
    )
  ) into result;

  return result;
end;
$$;

comment on function public.get_complete_power_outage_company_page(text, integer, timestamptz, uuid, text, text, text, text, text) is
  'Stránkovaný výpis vyhodnocených a obchodně relevantních firem režimu KOMPLETNÍ.';

revoke all on function public.get_complete_power_outage_company_page(text, integer, timestamptz, uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.get_complete_power_outage_company_page(text, integer, timestamptz, uuid, text, text, text, text, text)
  to authenticated;

select 'COLUMN' as check_type, 'business relevance classification' as object_name,
       count(*) = 5 as is_correct
from information_schema.columns
where table_schema = 'public'
  and table_name = 'complete_power_outage_companies'
  and column_name in (
    'business_relevance_status', 'business_relevance_version',
    'business_relevance_reasons', 'business_relevance_evaluated_at',
    'business_relevance_override'
  )
union all
select 'DATA', 'evaluated candidates classified', not exists (
  select 1 from public.complete_power_outage_companies
  where candidate_status in ('confirmed', 'needs_review')
    and business_relevance_status = 'pending'
)
union all
select 'FUNCTION', 'business relevance applied to paginated UI',
       pg_get_functiondef('public.get_complete_power_outage_company_page(text,integer,timestamptz,uuid,text,text,text,text,text)'::regprocedure)
         like '%business_relevance_status = ''eligible''%';

select business_relevance_status, count(*) as candidate_count
from public.complete_power_outage_companies
group by business_relevance_status
order by business_relevance_status;

commit;
