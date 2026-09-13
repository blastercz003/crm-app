begin;

do $$
begin
  if to_regclass('public.complete_power_outage_company_assignments') is null
     or to_regclass('public.complete_power_outage_communication_states') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_addresses') is null
     or to_regclass('public.complete_power_outages') is null
  then
    raise exception 'Chybi zavislosti pro panel pridelenych odstavek na strance Aktivita.';
  end if;
end
$$;

create or replace function public.get_activity_complete_power_outage_assignments_v1(
  requested_owner_id uuid,
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_role text;
  safe_limit integer := least(200, greatest(1, coalesce(requested_limit, 100)));
  result jsonb;
begin
  if current_user_id is null
     or not public.current_user_can_view_activities()
     or not public.current_user_can_view_power_outages()
  then
    raise exception 'Pro zobrazeni pridelenych odstavek nemate opravneni.' using errcode = '42501';
  end if;

  select profile.role
  into current_role
  from public.profiles profile
  where profile.id = current_user_id;

  if requested_owner_id is null then
    raise exception 'Vyberte platneho uzivatele.' using errcode = '22023';
  end if;
  if requested_owner_id <> current_user_id and current_role <> 'admin' then
    raise exception 'Zaznamy jineho uzivatele muze zobrazit pouze administrator.' using errcode = '42501';
  end if;

  with eligible as (
    select
      company.id as candidate_id,
      company.company_name,
      address.municipality,
      company.display_address,
      address.street,
      address.house_number,
      address.orientation_number,
      address.town_part,
      address.raw_address,
      outage.starts_at,
      outage.ends_at,
      outage.source::text as source,
      coalesce(
        communication.communication_status,
        case assignment.communication_status
          when 'contacted' then 'contacted'
          when 'follow_up' then 'contacted'
          else 'not_contacted'
        end
      ) as communication_status
    from public.complete_power_outage_company_assignments assignment
    join public.complete_power_outage_companies company
      on company.id = assignment.candidate_id
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    left join public.complete_power_outage_communication_states communication
      on communication.candidate_id = company.id
    where assignment.owner_id = requested_owner_id
      and company.candidate_status in ('confirmed', 'needs_review')
      and company.business_relevance_status = 'eligible'
      and outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
      and coalesce(
        communication.communication_status,
        case assignment.communication_status
          when 'contacted' then 'contacted'
          when 'follow_up' then 'contacted'
          when 'closed' then 'closed_no_job'
          else 'not_contacted'
        end
      ) not in ('job_won', 'closed_no_job')
  ), counted as (
    select eligible.*, count(*) over ()::integer as total_count
    from eligible
  ), selected as (
    select *
    from counted
    order by starts_at asc, company_name asc, candidate_id asc
    limit safe_limit
  )
  select jsonb_build_object(
    'totalCount', coalesce(max(selected.total_count), 0),
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'candidateId', selected.candidate_id,
          'companyName', selected.company_name,
          'municipality', selected.municipality,
          'displayAddress', selected.display_address,
          'street', selected.street,
          'houseNumber', selected.house_number,
          'orientationNumber', selected.orientation_number,
          'townPart', selected.town_part,
          'rawAddress', selected.raw_address,
          'startsAt', selected.starts_at,
          'endsAt', selected.ends_at,
          'source', selected.source,
          'communicationStatus', selected.communication_status
        ) order by selected.starts_at, selected.company_name, selected.candidate_id
      ),
      '[]'::jsonb
    )
  )
  into result
  from selected;

  return coalesce(result, jsonb_build_object('totalCount', 0, 'items', '[]'::jsonb));
end;
$$;

revoke all on function public.get_activity_complete_power_outage_assignments_v1(uuid,integer)
  from public, anon;
grant execute on function public.get_activity_complete_power_outage_assignments_v1(uuid,integer)
  to authenticated;

commit;
