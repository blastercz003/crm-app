begin;

-- ETAPA 2: produkční vazby mezi KOMPLETNÍMI kandidáty a Klienty,
-- uživatelsky izolovaná priorita a nové bezpečné stránkování.
-- Aplikace nadále používá v6; vizuální aktivace patří až do etapy 3.
create extension if not exists pg_cron;
create extension if not exists pg_trgm;

do $$
begin
  if to_regclass('public.complete_power_outage_client_match_audit') is null
     or to_regclass('public.complete_power_outage_job_links') is null
     or to_regclass('public.complete_power_outage_company_top_selections') is null
     or to_regprocedure('public.complete_power_outage_normalize_client_ico(text)') is null
     or to_regprocedure('public.complete_power_outage_normalize_client_name(text)') is null
     or to_regprocedure('public.current_user_can_view_client(uuid)') is null
     or to_regprocedure(
       'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'
     ) is null
  then
    raise exception 'Chybí dokončená etapa 1 nebo aktivní stránkování KOMPLETNÍ v6.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_client_match_audit
    where match_method = 'name_fuzzy'
      and automatic_match_recommended
  ) then
    raise exception 'Etapa 1 obsahuje nepovolenou automatickou fuzzy vazbu.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_client_priority_state (
  singleton boolean primary key default true check (singleton),
  matching_enabled boolean not null default true,
  priority_query_enabled boolean not null default true,
  ui_enabled boolean not null default false,
  rules_version integer not null default 1 check (rules_version > 0),
  fuzzy_similarity_threshold numeric(5,4) not null default 0.9200
    check (fuzzy_similarity_threshold between 0.9 and 1),
  last_status text not null default 'idle'
    check (last_status in ('idle', 'running', 'succeeded', 'failed')),
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_success_at timestamptz,
  last_processed_count integer not null default 0 check (last_processed_count >= 0),
  last_inserted_count integer not null default 0 check (last_inserted_count >= 0),
  last_removed_count integer not null default 0 check (last_removed_count >= 0),
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.complete_power_outage_client_priority_state (
  singleton,
  matching_enabled,
  priority_query_enabled,
  ui_enabled,
  rules_version,
  fuzzy_similarity_threshold,
  metadata
)
values (
  true,
  true,
  true,
  false,
  1,
  0.9200,
  jsonb_build_object(
    'contract', 'complete-client-priority-v1',
    'matchRule', 'exact_ico_or_normalized_name_or_guarded_fuzzy_name',
    'differentNonemptyIcoBlocksNameMatch', true,
    'clientVisibility', 'current_user_can_view_client',
    'clientRowsOverrideCommercialSelection', true,
    'uiActivationStage', 3
  )
)
on conflict (singleton) do update
set matching_enabled = true,
    priority_query_enabled = true,
    ui_enabled = public.complete_power_outage_client_priority_state.ui_enabled,
    rules_version = 1,
    fuzzy_similarity_threshold = 0.9200,
    metadata = excluded.metadata,
    updated_at = now();

create table if not exists public.complete_power_outage_client_links (
  candidate_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  match_method text not null,
  name_similarity numeric(5,4) not null,
  rules_version integer not null default 1 check (rules_version > 0),
  first_linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (candidate_id, client_id),
  constraint cpo_client_links_method_check
    check (match_method in ('ico_exact', 'name_exact', 'name_fuzzy')),
  constraint cpo_client_links_similarity_check
    check (name_similarity between 0 and 1)
);

create index if not exists cpo_client_links_client_idx
  on public.complete_power_outage_client_links (client_id, candidate_id);
create index if not exists cpo_client_links_candidate_method_idx
  on public.complete_power_outage_client_links (
    candidate_id, match_method, client_id
  );

-- Přesné párování využije indexy; fuzzy větev pracuje jen nad aktuálními
-- záznamy a malou tabulkou Klientů.
create index if not exists clients_complete_normalized_ico_idx
  on public.clients (
    public.complete_power_outage_normalize_client_ico(ico)
  )
  where ico is not null;
create index if not exists clients_complete_normalized_name_idx
  on public.clients (
    public.complete_power_outage_normalize_client_name(name)
  );
create index if not exists cpo_companies_complete_normalized_ico_idx
  on public.complete_power_outage_companies (
    public.complete_power_outage_normalize_client_ico(ico)
  )
  where ico is not null;
create index if not exists cpo_companies_complete_normalized_name_idx
  on public.complete_power_outage_companies (
    public.complete_power_outage_normalize_client_name(company_name)
  );

alter table public.complete_power_outage_client_priority_state enable row level security;
alter table public.complete_power_outage_client_links enable row level security;

revoke all on table public.complete_power_outage_client_priority_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_client_links
  from public, anon, authenticated;
grant all on table public.complete_power_outage_client_priority_state to service_role;
grant all on table public.complete_power_outage_client_links to service_role;

-- Výchozí backfill používá pouze jisté shody schválené etapou 1.
insert into public.complete_power_outage_client_links (
  candidate_id,
  client_id,
  match_method,
  name_similarity,
  rules_version,
  last_verified_at,
  metadata
)
select
  audit.candidate_id,
  audit.client_id,
  audit.match_method,
  audit.name_similarity,
  1,
  now(),
  jsonb_build_object(
    'contract', 'complete-client-priority-v1',
    'source', 'approved-stage1-audit'
  )
from public.complete_power_outage_client_match_audit audit
where audit.automatic_match_recommended
on conflict (candidate_id, client_id) do update
set match_method = excluded.match_method,
    name_similarity = excluded.name_similarity,
    rules_version = excluded.rules_version,
    last_verified_at = excluded.last_verified_at,
    metadata = excluded.metadata;

create or replace function public.reconcile_complete_power_outage_client_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '180s'
as $$
declare
  current_threshold numeric(5,4);
  processed_count integer := 0;
  inserted_count integer := 0;
  removed_count integer := 0;
begin
  select fuzzy_similarity_threshold
  into current_threshold
  from public.complete_power_outage_client_priority_state
  where singleton and matching_enabled;

  if current_threshold is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'matching_disabled',
      'finishedAt', now()
    );
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_power_outage_client_links', 0)
  ) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_running',
      'finishedAt', now()
    );
  end if;

  update public.complete_power_outage_client_priority_state
  set last_status = 'running',
      last_started_at = now(),
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where singleton;

  create temporary table if not exists pg_temp.cpo_desired_client_links (
    candidate_id uuid not null,
    client_id uuid not null,
    match_method text not null,
    name_similarity numeric(5,4) not null,
    primary key (candidate_id, client_id)
  ) on commit drop;
  truncate table pg_temp.cpo_desired_client_links;

  with companies as materialized (
    select
      company.id as candidate_id,
      public.complete_power_outage_normalize_client_ico(company.ico)
        as normalized_company_ico,
      public.complete_power_outage_normalize_client_name(company.company_name)
        as normalized_company_name
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address_row
      on address_row.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address_row.outage_id
    where company.candidate_status in ('confirmed', 'needs_review')
      and company.business_relevance_status = 'eligible'
      and outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
  ), clients as materialized (
    select
      client.id as client_id,
      public.complete_power_outage_normalize_client_ico(client.ico)
        as normalized_client_ico,
      public.complete_power_outage_normalize_client_name(client.name)
        as normalized_client_name
    from public.clients client
    where public.complete_power_outage_normalize_client_name(client.name) is not null
  ), exact_ico_pairs as materialized (
    select
      company.candidate_id,
      client.client_id,
      'ico_exact'::text as match_method,
      coalesce(round(public.similarity(
        company.normalized_company_name,
        client.normalized_client_name
      )::numeric, 4), 0::numeric) as name_similarity
    from companies company
    join clients client
      on client.normalized_client_ico is not null
     and company.normalized_company_ico is not null
     and client.normalized_client_ico = company.normalized_company_ico
  ), exact_name_pairs as materialized (
    select
      company.candidate_id,
      client.client_id,
      'name_exact'::text as match_method,
      1.0000::numeric as name_similarity
    from companies company
    join clients client
      on client.normalized_client_name = company.normalized_company_name
    where not (
      company.normalized_company_ico is not null
      and client.normalized_client_ico is not null
      and company.normalized_company_ico <> client.normalized_client_ico
    )
  ), definitive_pairs as materialized (
    select distinct on (candidate_id, client_id)
      candidate_id, client_id, match_method, name_similarity
    from (
      select * from exact_ico_pairs
      union all
      select * from exact_name_pairs
    ) exact_pairs
    order by candidate_id, client_id,
      case match_method when 'ico_exact' then 0 else 1 end
  ), fuzzy_raw as materialized (
    select
      company.candidate_id,
      client.client_id,
      round(public.similarity(
        company.normalized_company_name,
        client.normalized_client_name
      )::numeric, 4) as name_similarity
    from companies company
    cross join clients client
    where length(company.normalized_company_name) >= 7
      and length(client.normalized_client_name) >= 7
      and company.normalized_company_name <> client.normalized_client_name
      and not (
        company.normalized_company_ico is not null
        and client.normalized_client_ico is not null
        and company.normalized_company_ico <> client.normalized_client_ico
      )
      and public.similarity(
        company.normalized_company_name,
        client.normalized_client_name
      ) >= current_threshold
      and not exists (
        select 1
        from definitive_pairs definitive
        where definitive.candidate_id = company.candidate_id
      )
  ), unique_fuzzy_pairs as materialized (
    select candidate_id, client_id, 'name_fuzzy'::text as match_method,
      name_similarity
    from (
      select fuzzy_raw.*,
        count(*) over (partition by candidate_id) as possible_client_count
      from fuzzy_raw
    ) ranked
    where possible_client_count = 1
  ), desired as (
    select * from definitive_pairs
    union all
    select * from unique_fuzzy_pairs
  )
  insert into pg_temp.cpo_desired_client_links (
    candidate_id, client_id, match_method, name_similarity
  )
  select candidate_id, client_id, match_method, name_similarity
  from desired;

  select count(*) into processed_count
  from pg_temp.cpo_desired_client_links;

  delete from public.complete_power_outage_client_links existing
  where exists (
    select 1
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address_row
      on address_row.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address_row.outage_id
    where company.id = existing.candidate_id
      and outage.ends_at >= now()
  )
  and not exists (
    select 1
    from pg_temp.cpo_desired_client_links desired
    where desired.candidate_id = existing.candidate_id
      and desired.client_id = existing.client_id
  );
  get diagnostics removed_count = row_count;

  with reconciled as (
    insert into public.complete_power_outage_client_links (
      candidate_id,
      client_id,
      match_method,
      name_similarity,
      rules_version,
      last_verified_at,
      metadata
    )
    select
      desired.candidate_id,
      desired.client_id,
      desired.match_method,
      desired.name_similarity,
      1,
      now(),
      jsonb_build_object(
        'contract', 'complete-client-priority-v1',
        'source', 'automatic-reconciliation',
        'fuzzyThreshold', current_threshold
      )
    from pg_temp.cpo_desired_client_links desired
    on conflict (candidate_id, client_id) do update
    set match_method = excluded.match_method,
        name_similarity = excluded.name_similarity,
        rules_version = excluded.rules_version,
        last_verified_at = excluded.last_verified_at,
        metadata = excluded.metadata
    returning (xmax = 0) as was_inserted
  )
  select count(*) filter (where was_inserted)
  into inserted_count
  from reconciled;

  update public.complete_power_outage_client_priority_state
  set last_status = 'succeeded',
      last_finished_at = now(),
      last_success_at = now(),
      last_processed_count = processed_count,
      last_inserted_count = inserted_count,
      last_removed_count = removed_count,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'status', 'succeeded',
    'processedCount', processed_count,
    'insertedCount', inserted_count,
    'removedCount', removed_count,
    'fuzzyThreshold', current_threshold,
    'finishedAt', now()
  );
exception when others then
  update public.complete_power_outage_client_priority_state
  set last_status = 'failed',
      last_finished_at = now(),
      last_error_code = sqlstate,
      last_error_message = left(sqlerrm, 1000),
      updated_at = now()
  where singleton;
  return jsonb_build_object(
    'status', 'failed',
    'errorCode', sqlstate,
    'errorMessage', left(sqlerrm, 1000),
    'finishedAt', now()
  );
end;
$$;

revoke all on function public.reconcile_complete_power_outage_client_links()
  from public, anon, authenticated;
grant execute on function public.reconcile_complete_power_outage_client_links()
  to service_role;

-- v7 je nová, zatím UI nepoužívaná stránkovací smlouva. Klientské záznamy
-- dostupné právě přihlášenému uživateli stojí před běžnými výsledky a jsou
-- zahrnuty do každé volby AI SELECT. Ostatní filtry zůstávají závazné.
create or replace function public.get_complete_power_outage_company_page_v7(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
  p_cursor_client_priority boolean default null,
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
  if not exists (
    select 1
    from public.complete_power_outage_client_priority_state
    where singleton and priority_query_enabled
  ) then
    raise exception 'Prioritní řazení klientů není aktivní.';
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
  if p_cursor_at is not null
     and (p_cursor_id is null or p_cursor_client_priority is null)
  then
    raise exception 'Neúplný kurzor prioritního stránkování.';
  end if;
  if p_cursor_at is not null and p_sort = 'score' and p_cursor_score is null then
    raise exception 'Kurzor řazení podle skóre neobsahuje skóre.';
  end if;

  with page_rows as materialized (
    select
      company.id as candidate_id,
      case when p_mode = 'current' then outage.starts_at else outage.ends_at end as sort_at,
      coalesce(score_row.score, -1) as sort_score,
      coalesce(client_match.is_client_priority, false) as is_client_priority,
      coalesce(client_match.match_count, 0) as client_match_count,
      client_match.match_method as client_match_method
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = company.id
    left join public.complete_power_outage_company_scores score_row
      on score_row.candidate_id = company.id
    left join public.complete_power_outage_company_top_selections top_row
      on top_row.candidate_id = company.id
    left join lateral (
      select
        true as is_client_priority,
        count(*)::integer as match_count,
        (array_agg(link.match_method order by
          case link.match_method
            when 'ico_exact' then 0
            when 'name_exact' then 1
            else 2
          end
        ))[1] as match_method
      from public.complete_power_outage_client_links link
      where link.candidate_id = company.id
        and public.current_user_can_view_client(link.client_id)
      having count(*) > 0
    ) client_match on true
    where company.candidate_status in ('confirmed', 'needs_review', 'dismissed')
      and company.business_relevance_status = 'eligible'
      and (
        (p_mode = 'current' and outage.ends_at >= now()
          and outage.source_status in ('scheduled', 'active'))
        or (p_mode = 'archive' and outage.ends_at < now())
      )
      and (
        p_candidate_status = 'visible'
          and company.candidate_status in ('confirmed', 'needs_review')
        or p_candidate_status <> 'visible'
          and company.candidate_status = p_candidate_status
      )
      and (p_source = 'all' or outage.source::text = p_source)
      and (p_entity_kind = 'all' or company.entity_kind = p_entity_kind)
      and (
        coalesce(client_match.is_client_priority, false)
        or p_commercial_filter = 'all'
        or (
          p_commercial_filter = 'top' and coalesce(top_row.top_eligible, false)
          or p_commercial_filter = 'grade_a'
            and score_row.score_status in ('complete', 'preliminary')
            and score_row.grade = 'A'
          or p_commercial_filter = 'grade_b'
            and score_row.score_status in ('complete', 'preliminary')
            and score_row.grade = 'B'
        )
      )
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
      and (
        p_cursor_at is null
        or p_cursor_id is null
        or p_cursor_client_priority is null
        or coalesce(client_match.is_client_priority, false) < p_cursor_client_priority
        or (
          coalesce(client_match.is_client_priority, false) = p_cursor_client_priority
          and (
            p_sort = 'date' and (
              p_mode = 'current'
                and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
              or p_mode = 'archive'
                and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id)
            )
            or p_sort = 'score' and p_cursor_score is not null and (
              coalesce(score_row.score, -1) < p_cursor_score
              or coalesce(score_row.score, -1) = p_cursor_score
                and p_mode = 'current'
                and (outage.starts_at, company.id) > (p_cursor_at, p_cursor_id)
              or coalesce(score_row.score, -1) = p_cursor_score
                and p_mode = 'archive'
                and (outage.ends_at, company.id) < (p_cursor_at, p_cursor_id)
            )
          )
        )
      )
    order by
      coalesce(client_match.is_client_priority, false) desc,
      case when p_sort = 'score' then coalesce(score_row.score, -1) end desc,
      case when p_mode = 'current' then outage.starts_at end asc,
      case when p_mode = 'archive' then outage.ends_at end desc,
      case when p_mode = 'current' then company.id end asc,
      case when p_mode = 'archive' then company.id end desc
    limit safe_limit + 1
  ), visible_rows as materialized (
    select *
    from page_rows
    order by
      is_client_priority desc,
      case when p_sort = 'score' then sort_score end desc,
      case when p_mode = 'current' then sort_at end asc,
      case when p_mode = 'archive' then sort_at end desc,
      case when p_mode = 'current' then candidate_id end asc,
      case when p_mode = 'archive' then candidate_id end desc
    limit safe_limit
  ), serialized as (
    select row_number() over (order by
        visible_rows.is_client_priority desc,
        case when p_sort = 'score' then visible_rows.sort_score end desc,
        case when p_mode = 'current' then visible_rows.sort_at end asc,
        case when p_mode = 'archive' then visible_rows.sort_at end desc,
        case when p_mode = 'current' then visible_rows.candidate_id end asc,
        case when p_mode = 'archive' then visible_rows.candidate_id end desc
      ) as position,
      visible_rows.sort_at,
      visible_rows.sort_score,
      visible_rows.is_client_priority,
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
        'commercial_score_status', score_row.score_status,
        'has_linked_job', coalesce(job_link.match_count, 0) > 0,
        'linked_job_count', coalesce(job_link.match_count, 0),
        'is_accessible_client', visible_rows.is_client_priority,
        'accessible_client_match_count', visible_rows.client_match_count,
        'accessible_client_match_method', visible_rows.client_match_method
      ) as item
    from visible_rows
    join public.complete_power_outage_company_overview overview
      on overview.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_assignments assignment
      on assignment.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_scores score_row
      on score_row.candidate_id = visible_rows.candidate_id
    left join public.complete_power_outage_company_top_selections top_row
      on top_row.candidate_id = visible_rows.candidate_id
    left join lateral (
      select count(*)::integer as match_count
      from public.complete_power_outage_job_links job_link_row
      where job_link_row.candidate_id = visible_rows.candidate_id
    ) job_link on true
  )
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(item order by position) from serialized),
      '[]'::jsonb
    ),
    'totalCount', null,
    'hasMore', (select count(*) from page_rows) > safe_limit,
    'nextCursor', (
      select jsonb_build_object(
        'at', sort_at,
        'id', candidate_id,
        'score', sort_score,
        'clientPriority', is_client_priority
      )
      from serialized
      order by position desc
      limit 1
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v7(
  text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.get_complete_power_outage_company_page_v7(
  text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text
) to authenticated;

-- První živý přepočet proběhne před aktivací pravidelného běhu.
select public.reconcile_complete_power_outage_client_links();

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'complete-power-outage-client-links'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete-power-outage-client-links',
    '*/5 * * * *',
    'select public.reconcile_complete_power_outage_client_links();'
  );
end
$$;

notify pgrst, 'reload schema';

commit;
