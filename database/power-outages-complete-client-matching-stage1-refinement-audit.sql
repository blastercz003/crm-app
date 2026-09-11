-- Technická kontrola závěrečné korekce etapy 1.
select 'DATA' as check_type,
       'Czech Post is represented by exact normalized name matches' as object_name,
       exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where normalized_company_name = 'ceska posta'
           and normalized_client_name = 'ceska posta'
           and match_method = 'name_exact'
           and automatic_match_recommended
       ) as is_correct
union all
select 'FUNCTION',
       'state enterprise suffix variants normalize equally',
       public.complete_power_outage_normalize_client_name('Česká pošta')
         = public.complete_power_outage_normalize_client_name('Česká pošta, s.p.')
       and public.complete_power_outage_normalize_client_name('Česká pošta')
         = public.complete_power_outage_normalize_client_name('Česká pošta, státní podnik')
union all
select 'GRANT',
       'authenticated still cannot access private client matching audit',
       not has_table_privilege(
         'authenticated',
         'public.complete_power_outage_client_match_audit',
         'SELECT'
       )
       and not has_function_privilege(
         'authenticated',
         'public.refresh_complete_power_outage_client_match_audit(numeric,numeric)',
         'EXECUTE'
       )
union all
select 'LOGIC',
       'fuzzy production recommendation remains disabled',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where match_method = 'name_fuzzy'
           and automatic_match_recommended
       )
union all
select 'LOGIC',
       'different nonempty ICO still prevents automatic name match',
       not exists (
         select 1
         from public.complete_power_outage_client_match_audit
         where normalized_company_ico is not null
           and normalized_client_ico is not null
           and normalized_company_ico <> normalized_client_ico
           and automatic_match_recommended
       )
union all
select 'SAFETY',
       'AI SELECT page query remains unchanged',
       to_regprocedure(
         'public.get_complete_power_outage_company_page_v6(text,integer,timestamptz,uuid,integer,text,text,text,text,text,text,text)'
       ) is not null
       and to_regprocedure(
         'public.get_complete_power_outage_company_page_v7(text,integer,timestamptz,uuid,integer,boolean,text,text,text,text,text,text,text)'
       ) is null
order by check_type, object_name;

-- Výsledkový souhrn po korekci. Očekáváme přesun České pošty z fuzzy review
-- mezi automaticky doporučené přesné názvové shody.
select
  match_method,
  evaluation_status,
  automatic_match_recommended,
  count(*) as pair_count,
  count(distinct candidate_id) as candidate_count,
  count(distinct client_id) as client_count
from public.complete_power_outage_client_match_audit
group by match_method, evaluation_status, automatic_match_recommended
order by automatic_match_recommended desc, match_method, evaluation_status;

-- Všechny zbývající případy ke kontrole po opravě právní formy s.p.
select distinct
  record_mode,
  company_name,
  company_ico,
  client_name,
  client_ico,
  match_method,
  name_similarity,
  reason_codes
from public.complete_power_outage_client_match_audit
where not automatic_match_recommended
order by name_similarity desc, company_name, client_name;
