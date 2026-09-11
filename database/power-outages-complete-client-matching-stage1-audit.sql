-- ETAPA 1: technická a bezpečnostní kontrola.
select 'DATA' as check_type,
       'client match audit contains evaluated pairs' as object_name,
       exists (
         select 1 from public.complete_power_outage_client_match_audit
       ) as is_correct
union all
select 'FUNCTION',
       'client ICO normalization preserves eight digits',
       public.complete_power_outage_normalize_client_ico('CZ 01234567') = '01234567'
       and public.complete_power_outage_normalize_client_ico('123') is null
union all
select 'FUNCTION',
       'legal suffix variants normalize to the same name',
       public.complete_power_outage_normalize_client_name('KOBIT - THZ CZ s.r.o.')
         = public.complete_power_outage_normalize_client_name('KOBIT THZ CZ, spol. s r.o.')
       and public.complete_power_outage_normalize_client_name('Firma s.r.o.') = 'firma'
union all
select 'FUNCTION',
       'private client matching audit refresh exists',
       to_regprocedure(
         'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'
       ) is not null
union all
select 'GRANT',
       'authenticated cannot access private client matching audit',
       not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_match_audit',
         'SELECT'
       )
       and not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_match_audit_overview',
         'SELECT'
       )
       and not has_function_privilege(
         'authenticated',
         'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)',
         'EXECUTE'
       )
union all
select 'ISOLATION',
       'client matching audit stays in COMPLETE scope',
       position(
         'power_outage_store_' in lower(
           pg_get_functiondef(
             'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'::regprocedure
           )
         )
       ) = 0
       and position(
         'market' in lower(
           pg_get_functiondef(
             'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'::regprocedure
           )
         )
       ) = 0
union all
select 'LOGIC',
       'different nonempty ICO prevents automatic name match',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where normalized_company_ico is not null
           and normalized_client_ico is not null
           and normalized_company_ico <> normalized_client_ico
           and automatic_match_recommended
       )
union all
select 'LOGIC',
       'exact ICO is recommended automatically',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where match_method = 'ico_exact'
           and not automatic_match_recommended
       )
union all
select 'LOGIC',
       'fuzzy name matches remain outside production',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where match_method = 'name_fuzzy'
           and automatic_match_recommended
       )
union all
select 'SAFETY',
       'AI SELECT page query remains version six',
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'
       ) is not null
       and to_regprocedure(
         'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
       ) is null
union all
select 'SAFETY',
       'client audit does not change scores or TOP selection',
       position(
         'company_scores' in lower(
           pg_get_functiondef(
             'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'::regprocedure
           )
         )
       ) = 0
       and position(
         'top_selection' in lower(
           pg_get_functiondef(
             'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)'::regprocedure
           )
         )
       ) = 0
union all
select 'SAFETY',
       'client matching UI remains inactive',
       not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'complete_power_outage_commercial_selection_state'
           and column_name = 'client_priority_ui_enabled'
       )
union all
select 'TABLE',
       'private client matching audit table exists',
       to_regclass('public.complete_power_outage_client_match_audit') is not null
union all
select 'VIEW',
       'private client matching audit overview exists',
       to_regclass('public.complete_power_outage_client_match_audit_overview') is not null
order by check_type, object_name;

-- VÝSLEDEK 1: celkové rozdělení podle metody a jistoty.
select *
from public.complete_power_outage_client_match_audit_overview
order by record_mode, automatic_match_recommended desc,
  evaluation_status, match_method;

-- VÝSLEDEK 2: pokrytí klientů a záznamů tabulky KOMPLETNÍ.
with client_totals as (
  select
    count(*)::bigint as client_count,
    count(*) filter (
      where public.complete_power_outage_normalize_client_ico(ico) is not null
    )::bigint as client_with_ico_count
  from public.clients
), match_totals as (
  select
    count(distinct client_id)::bigint as matched_client_count,
    count(distinct client_id) filter (
      where automatic_match_recommended
    )::bigint as automatically_matched_client_count,
    count(distinct candidate_id)::bigint as candidate_count,
    count(distinct candidate_id) filter (
      where automatic_match_recommended
    )::bigint as automatically_matched_candidate_count,
    count(*) filter (
      where evaluation_status = 'needs_review'
    )::bigint as review_pair_count
  from public.complete_power_outage_client_match_audit
)
select *
from client_totals
cross join match_totals;

-- VÝSLEDEK 3: jisté shody, které lze navrhnout pro produkční etapu 2.
select distinct
  record_mode,
  company_name,
  company_ico,
  client_name,
  client_ico,
  match_method,
  name_similarity,
  client_owner_id,
  reason_codes
from public.complete_power_outage_client_match_audit
where automatic_match_recommended
order by record_mode, match_method, company_name, client_name;

-- VÝSLEDEK 4: názvové shody blokované rozdílným vyplněným IČO.
select distinct
  record_mode,
  company_name,
  company_ico,
  client_name,
  client_ico,
  match_method,
  name_similarity,
  client_owner_id,
  reason_codes
from public.complete_power_outage_client_match_audit
where 'conflicting_nonempty_ico' = any(reason_codes)
order by name_similarity desc, company_name, client_name;

-- VÝSLEDEK 5: přibližné shody pro nastavení benevolentní hranice.
select distinct
  case
    when name_similarity >= 0.92 then '0.92–1.00'
    when name_similarity >= 0.86 then '0.86–0.9199'
    when name_similarity >= 0.80 then '0.80–0.8599'
    when name_similarity >= 0.74 then '0.74–0.7999'
    else '0.68–0.7399'
  end as similarity_band,
  evaluation_status,
  count(*) as pair_count,
  count(distinct candidate_id) as candidate_count,
  count(distinct client_id) as client_count
from public.complete_power_outage_client_match_audit
where match_method = 'name_fuzzy'
group by similarity_band, evaluation_status
order by similarity_band desc, evaluation_status;

-- VÝSLEDEK 6: konkrétní přibližné shody od nejvyšší podobnosti.
select distinct
  record_mode,
  company_name,
  company_ico,
  client_name,
  client_ico,
  name_similarity,
  evaluation_status,
  candidate_name_match_count,
  client_owner_id,
  reason_codes
from public.complete_power_outage_client_match_audit
where match_method = 'name_fuzzy'
order by name_similarity desc, company_name, client_name
limit 300;

-- VÝSLEDEK 7: kandidáti s více možnými názvovými shodami.
select
  candidate_id,
  company_name,
  company_ico,
  count(*) as possible_client_count,
  array_agg(distinct client_name order by client_name) as possible_clients,
  array_agg(distinct match_method order by match_method) as match_methods,
  max(name_similarity) as best_name_similarity
from public.complete_power_outage_client_match_audit
where candidate_name_match_count > 1
group by candidate_id, company_name, company_ico
order by possible_client_count desc, company_name;
