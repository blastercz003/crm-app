-- 1. Rozdeleni nalezenych kontaktu podle typu, role a potreby kontroly.
select
  result_row.contact_type,
  result_row.contact_role,
  result_row.is_personal,
  count(*)::bigint as contact_count,
  count(distinct result_row.ico)::bigint as company_count,
  round(avg(result_row.confidence), 4) as average_confidence
from public.complete_power_outage_contact_extraction_shadow_results result_row
group by result_row.contact_type, result_row.contact_role, result_row.is_personal
order by result_row.contact_type, result_row.is_personal, contact_count desc;

-- 2. Souhrn po firmach. Umoznuje odhalit firmy s neobvykle vysokym poctem kontaktu.
select
  profile.official_name as company_name,
  queue_row.ico,
  queue_row.normalized_domain,
  count(result_row.id) filter (where result_row.contact_type = 'email')::bigint as email_count,
  count(result_row.id) filter (where result_row.contact_type = 'phone')::bigint as phone_count,
  count(result_row.id) filter (where result_row.is_personal)::bigint as personal_contact_count,
  count(result_row.id)::bigint as total_contact_count
from public.complete_power_outage_contact_extraction_shadow_queue queue_row
join public.complete_power_outage_company_profiles profile
  on profile.id = queue_row.company_profile_id
 and profile.ico = queue_row.ico
left join public.complete_power_outage_contact_extraction_shadow_results result_row
  on result_row.ico = queue_row.ico
group by profile.official_name, queue_row.ico, queue_row.normalized_domain
order by total_contact_count desc, profile.official_name;

-- 3. Stejny kontakt nalezeny u vice firem. Tyto vysledky nesmi byt automaticky publikovany.
select
  result_row.contact_type,
  result_row.normalized_value,
  count(distinct result_row.ico)::bigint as company_count,
  array_agg(distinct profile.official_name order by profile.official_name) as company_names
from public.complete_power_outage_contact_extraction_shadow_results result_row
join public.complete_power_outage_company_profiles profile
  on profile.id = result_row.company_profile_id
 and profile.ico = result_row.ico
group by result_row.contact_type, result_row.normalized_value
having count(distinct result_row.ico) > 1
order by company_count desc, result_row.contact_type, result_row.normalized_value;

-- 4. Detail kontaktu oznacenych jako mozna osobnich. Spustit s vypnutym limitem radku.
select
  profile.official_name as company_name,
  result_row.ico,
  result_row.normalized_domain,
  result_row.normalized_value,
  result_row.contact_role,
  result_row.confidence,
  result_row.source_url,
  result_row.extraction_methods,
  result_row.review_flags
from public.complete_power_outage_contact_extraction_shadow_results result_row
join public.complete_power_outage_company_profiles profile
  on profile.id = result_row.company_profile_id
 and profile.ico = result_row.ico
where result_row.is_personal
order by profile.official_name, result_row.normalized_value;
