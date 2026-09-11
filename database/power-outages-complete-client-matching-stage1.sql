begin;

-- ETAPA 1: neveřejný audit párování firem z KOMPLETNÍ s databází Klienti.
-- Tento krok nemění řazení tabulky, AI SELECT, skóre ani uživatelské rozhraní.
-- Výsledky jsou záměrně dostupné pouze service_role / databázovému správci.
create extension if not exists unaccent;
create extension if not exists pg_trgm;

do $$
begin
  if to_regclass('public.clients') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_addresses') is null
     or to_regclass('public.complete_power_outages') is null
     or to_regprocedure('public.current_user_can_view_client(uuid)') is null
  then
    raise exception 'Chybí závislosti pro neveřejný audit párování klientů.';
  end if;
end
$$;

create or replace function public.complete_power_outage_normalize_client_ico(
  requested_ico text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  with normalized as (
    select regexp_replace(requested_ico, '[^0-9]', '', 'g') as value
  )
  select case when length(value) = 8 then value else null end
  from normalized;
$$;

-- Normalizace zachovává vlastní obchodní jméno, ale sjednocuje diakritiku,
-- interpunkci, mezery a běžné varianty právních koncovek. Díky tomu jsou např.
-- "Firma s.r.o." a "Firma, spol. s r.o." přesnou názvovou shodou.
create or replace function public.complete_power_outage_normalize_client_name(
  requested_name text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  with unaccented as (
    select lower(public.unaccent(btrim(requested_name))) as value
  ), words_only as (
    select btrim(regexp_replace(value, '[^[:alnum:]]+', ' ', 'g')) as value
    from unaccented
  ), spaces_collapsed as (
    select regexp_replace(value, '[[:space:]]+', ' ', 'g') as value
    from words_only
  ), legal_suffix_removed as (
    select btrim(regexp_replace(
      value,
      '[[:space:]]+(spol[[:space:]]+s[[:space:]]+r[[:space:]]+o|s[[:space:]]+r[[:space:]]+o|spolecnost[[:space:]]+s[[:space:]]+rucenim[[:space:]]+omezenym|a[[:space:]]+s|v[[:space:]]+o[[:space:]]+s|k[[:space:]]+s|z[[:space:]]+s|s[[:space:]]+e|s[[:space:]]+p|statni[[:space:]]+podnik)$',
      '',
      'g'
    )) as value
    from spaces_collapsed
  )
  select nullif(value, '')
  from legal_suffix_removed;
$$;

create or replace function public.complete_power_outage_client_name_similarity(
  first_name text,
  second_name text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when public.complete_power_outage_normalize_client_name(first_name) is null
      or public.complete_power_outage_normalize_client_name(second_name) is null
    then 0::numeric
    else round(public.similarity(
      public.complete_power_outage_normalize_client_name(first_name),
      public.complete_power_outage_normalize_client_name(second_name)
    )::numeric, 4)
  end;
$$;

revoke all on function public.complete_power_outage_normalize_client_ico(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_normalize_client_name(text)
  from public, anon, authenticated;
revoke all on function public.complete_power_outage_client_name_similarity(text, text)
  from public, anon, authenticated;
grant execute on function public.complete_power_outage_normalize_client_ico(text)
  to service_role;
grant execute on function public.complete_power_outage_normalize_client_name(text)
  to service_role;
grant execute on function public.complete_power_outage_client_name_similarity(text, text)
  to service_role;

create table if not exists public.complete_power_outage_client_match_audit (
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_owner_id uuid,
  record_mode text not null,
  company_name text not null,
  client_name text not null,
  company_ico text,
  client_ico text,
  normalized_company_name text not null,
  normalized_client_name text not null,
  normalized_company_ico text,
  normalized_client_ico text,
  name_similarity numeric(5,4) not null,
  match_method text not null,
  evaluation_status text not null,
  automatic_match_recommended boolean not null default false,
  reason_codes text[] not null default '{}'::text[],
  candidate_name_match_count integer not null default 1,
  evaluated_at timestamptz not null default now(),
  primary key (candidate_id, client_id),
  constraint cpo_client_match_audit_mode_check
    check (record_mode in ('current', 'archive')),
  constraint cpo_client_match_audit_method_check
    check (match_method in ('ico_exact', 'name_exact', 'name_fuzzy')),
  constraint cpo_client_match_audit_status_check
    check (evaluation_status in ('matched', 'proposed', 'needs_review')),
  constraint cpo_client_match_audit_similarity_check
    check (name_similarity between 0 and 1),
  constraint cpo_client_match_audit_name_count_check
    check (candidate_name_match_count >= 1)
);

create index if not exists cpo_client_match_audit_status_idx
  on public.complete_power_outage_client_match_audit (
    evaluation_status, match_method, name_similarity desc
  );
create index if not exists cpo_client_match_audit_client_idx
  on public.complete_power_outage_client_match_audit (
    client_id, record_mode, candidate_id
  );
create index if not exists cpo_client_match_audit_owner_idx
  on public.complete_power_outage_client_match_audit (
    client_owner_id, evaluation_status, candidate_id
  );

alter table public.complete_power_outage_client_match_audit enable row level security;
revoke all on table public.complete_power_outage_client_match_audit
  from public, anon, authenticated;
grant all on table public.complete_power_outage_client_match_audit to service_role;

create or replace function public.refresh_complete_power_outage_client_match_audit(
  p_fuzzy_floor numeric default 0.6800,
  p_fuzzy_proposal_threshold numeric default 0.9200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '240s'
as $$
declare
  inserted_count integer := 0;
  matched_count integer := 0;
  proposed_count integer := 0;
  review_count integer := 0;
begin
  if p_fuzzy_floor < 0.5 or p_fuzzy_floor > 1
     or p_fuzzy_proposal_threshold < p_fuzzy_floor
     or p_fuzzy_proposal_threshold > 1
  then
    raise exception 'Neplatné hranice podobnosti názvu.';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_power_outage_client_match_audit', 0)
  ) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_running',
      'finishedAt', now()
    );
  end if;

  delete from public.complete_power_outage_client_match_audit;

  with companies as materialized (
    select
      company.id as candidate_id,
      company.company_name,
      company.ico as company_ico,
      public.complete_power_outage_normalize_client_ico(company.ico)
        as normalized_company_ico,
      public.complete_power_outage_normalize_client_name(company.company_name)
        as normalized_company_name,
      case when outage.ends_at >= now() then 'current' else 'archive' end
        as record_mode
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address_row
      on address_row.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address_row.outage_id
    where company.candidate_status in ('confirmed', 'needs_review')
      and company.business_relevance_status = 'eligible'
      and (
        outage.ends_at < now()
        or (
          outage.ends_at >= now()
          and outage.source_status in ('scheduled', 'active')
        )
      )
  ), clients as materialized (
    select
      client.id as client_id,
      client.created_by as client_owner_id,
      client.name as client_name,
      client.ico as client_ico,
      public.complete_power_outage_normalize_client_ico(client.ico)
        as normalized_client_ico,
      public.complete_power_outage_normalize_client_name(client.name)
        as normalized_client_name
    from public.clients client
    where public.complete_power_outage_normalize_client_name(client.name) is not null
  ), possible_pairs as materialized (
    select
      company.*,
      client.*,
      round(public.similarity(
        company.normalized_company_name,
        client.normalized_client_name
      )::numeric, 4) as name_similarity,
      company.normalized_company_ico is not null
        and client.normalized_client_ico is not null
        and company.normalized_company_ico = client.normalized_client_ico
        as ico_exact,
      company.normalized_company_name = client.normalized_client_name
        as name_exact,
      company.normalized_company_ico is not null
        and client.normalized_client_ico is not null
        and company.normalized_company_ico <> client.normalized_client_ico
        as ico_conflict
    from companies company
    cross join clients client
    where (
      company.normalized_company_ico is not null
      and client.normalized_client_ico is not null
      and company.normalized_company_ico = client.normalized_client_ico
    )
    or company.normalized_company_name = client.normalized_client_name
    or (
      length(company.normalized_company_name) >= 7
      and length(client.normalized_client_name) >= 7
      and public.similarity(
        company.normalized_company_name,
        client.normalized_client_name
      ) >= p_fuzzy_floor
    )
  ), counted as (
    select
      possible_pairs.*,
      count(*) filter (
        where possible_pairs.name_exact
          or possible_pairs.name_similarity >= p_fuzzy_floor
      ) over (partition by possible_pairs.candidate_id) as name_match_count
    from possible_pairs
  ), inserted as (
    insert into public.complete_power_outage_client_match_audit (
      candidate_id,
      client_id,
      client_owner_id,
      record_mode,
      company_name,
      client_name,
      company_ico,
      client_ico,
      normalized_company_name,
      normalized_client_name,
      normalized_company_ico,
      normalized_client_ico,
      name_similarity,
      match_method,
      evaluation_status,
      automatic_match_recommended,
      reason_codes,
      candidate_name_match_count,
      evaluated_at
    )
    select
      candidate_id,
      client_id,
      client_owner_id,
      record_mode,
      company_name,
      client_name,
      company_ico,
      client_ico,
      normalized_company_name,
      normalized_client_name,
      normalized_company_ico,
      normalized_client_ico,
      name_similarity,
      case
        when ico_exact then 'ico_exact'
        when name_exact then 'name_exact'
        else 'name_fuzzy'
      end,
      case
        when ico_exact then 'matched'
        when ico_conflict then 'needs_review'
        when name_exact and name_match_count = 1 then 'matched'
        when name_exact then 'needs_review'
        when name_similarity >= p_fuzzy_proposal_threshold
          and name_match_count = 1 then 'proposed'
        else 'needs_review'
      end,
      case
        when ico_exact then true
        when not ico_conflict and name_exact and name_match_count = 1 then true
        else false
      end,
      array_remove(array[
        case when ico_exact then 'exact_ico' end,
        case when name_exact then 'normalized_name_equal' end,
        case when not name_exact then 'fuzzy_name_similarity' end,
        case when ico_conflict then 'conflicting_nonempty_ico' end,
        case when name_match_count > 1 then 'multiple_client_name_candidates' end,
        case
          when not ico_exact and not name_exact
            and name_similarity >= p_fuzzy_proposal_threshold
          then 'high_fuzzy_similarity'
        end,
        case
          when not ico_exact and not name_exact
            and name_similarity < p_fuzzy_proposal_threshold
          then 'medium_fuzzy_similarity'
        end
      ], null)::text[],
      greatest(name_match_count, 1)::integer,
      now()
    from counted
    returning evaluation_status
  )
  select
    count(*),
    count(*) filter (where evaluation_status = 'matched'),
    count(*) filter (where evaluation_status = 'proposed'),
    count(*) filter (where evaluation_status = 'needs_review')
  into inserted_count, matched_count, proposed_count, review_count
  from inserted;

  return jsonb_build_object(
    'status', 'succeeded',
    'pairCount', inserted_count,
    'matchedCount', matched_count,
    'proposedCount', proposed_count,
    'reviewCount', review_count,
    'fuzzyFloor', p_fuzzy_floor,
    'fuzzyProposalThreshold', p_fuzzy_proposal_threshold,
    'finishedAt', now()
  );
end;
$$;

revoke all on function public.refresh_complete_power_outage_client_match_audit(numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.refresh_complete_power_outage_client_match_audit(numeric, numeric)
  to service_role;

create or replace view public.complete_power_outage_client_match_audit_overview
with (security_invoker = true)
as
select
  record_mode,
  match_method,
  evaluation_status,
  automatic_match_recommended,
  count(*)::bigint as pair_count,
  count(distinct candidate_id)::bigint as candidate_count,
  count(distinct client_id)::bigint as client_count,
  round(avg(name_similarity), 4) as average_name_similarity,
  min(name_similarity) as minimum_name_similarity,
  max(name_similarity) as maximum_name_similarity,
  max(evaluated_at) as evaluated_at
from public.complete_power_outage_client_match_audit
group by record_mode, match_method, evaluation_status, automatic_match_recommended;

revoke all on table public.complete_power_outage_client_match_audit_overview
  from public, anon, authenticated;
grant select on table public.complete_power_outage_client_match_audit_overview
  to service_role;

-- Naplní pouze auditní tabulku. Produkční data a UI zůstávají beze změny.
select public.refresh_complete_power_outage_client_match_audit();

notify pgrst, 'reload schema';

commit;
