select
  selector.selector_key,
  selector.display_name,
  count(target.ico)::bigint as unique_ico_count,
  count(target.ico) filter (where target.has_company_profile)::bigint
    as profile_ready_count,
  count(target.ico) filter (where not target.has_company_profile)::bigint
    as profile_missing_count,
  coalesce(sum(target.candidate_count), 0)::bigint as candidate_count,
  coalesce(sum(target.outage_count), 0)::bigint as outage_count
from public.complete_power_outage_contact_discovery_selectors selector
left join public.complete_power_outage_contact_discovery_selector_targets target
  on target.selector_key = selector.selector_key
where selector.lifecycle_status = 'active'
group by selector.selector_key, selector.display_name
order by case selector.selector_key
  when 'top_v1' then 1
  when 'grade_a' then 2
  when 'grade_b' then 3
  when 'all_confirmed' then 4
  else 5
end, selector.selector_key;
