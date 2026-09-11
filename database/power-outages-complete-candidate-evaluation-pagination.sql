begin;

-- Vyhodnocovací worker musí limitovat skutečné kandidátní záznamy, nikoli
-- adresy. Jedna hromadná adresa může obsahovat tisíce firem a PostgREST vrací
-- nejvýše 1 000 řádků; adresní dávka proto mohla opakovaně zpracovávat stejný
-- začátek výsledku. Tento kontrakt vrací nejvýše requested_limit kandidátů.
create or replace function public.get_complete_power_outage_company_evaluation_candidate_queue(
  requested_limit integer default 250
)
returns table (
  candidate_id uuid,
  outage_address_id uuid,
  registered_office_count bigint
)
language sql
security definer
set search_path = ''
stable
as $$
  with parameters as (
    select least(1000, greatest(1, coalesce(requested_limit, 250)))::integer as batch_limit
  ), quotas as (
    select
      batch_limit,
      ((batch_limit * 60 + 99) / 100)::integer as cez_limit,
      ((batch_limit * 35) / 100)::integer as egd_limit,
      (batch_limit - ((batch_limit * 60 + 99) / 100)
        - ((batch_limit * 35) / 100))::integer as pre_limit
    from parameters
  ), eligible as materialized (
    select
      company.id as candidate_id,
      company.outage_address_id,
      outage.source,
      company.updated_at as waiting_since
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    where (company.evaluation_version < 3
        or company.business_relevance_status = 'pending')
      and company.candidate_status in ('new', 'confirmed', 'needs_review')
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and outage.starts_at <= now() + interval '30 days'
  ), ranked as (
    select eligible.*,
      row_number() over (
        partition by eligible.source
        order by eligible.waiting_since, eligible.candidate_id
      ) as source_position
    from eligible
  ), reserved as materialized (
    select ranked.*
    from ranked cross join quotas
    where ranked.source_position <= case ranked.source
      when 'cez' then quotas.cez_limit
      when 'egd' then quotas.egd_limit
      when 'pre' then quotas.pre_limit
      else 0
    end
  ), spill as materialized (
    select ranked.*
    from ranked cross join quotas
    where not exists (
      select 1 from reserved
      where reserved.candidate_id = ranked.candidate_id
    )
    order by ranked.waiting_since, ranked.candidate_id
    limit greatest(0,
      (select batch_limit from quotas) - (select count(*) from reserved))
  ), selected as materialized (
    select 0 as selection_order, reserved.* from reserved
    union all
    select 1 as selection_order, spill.* from spill
  ), selected_addresses as materialized (
    select distinct selected.outage_address_id from selected
  ), registered_offices as materialized (
    select
      company.outage_address_id,
      count(distinct company.id)::bigint as registered_office_count
    from public.complete_power_outage_companies company
    join selected_addresses selected_address
      on selected_address.outage_address_id = company.outage_address_id
    join public.complete_power_outage_company_evidence evidence
      on evidence.company_id = company.id
    where evidence.provider in ('ares', 'res')
      and evidence.evidence_kind = 'registered_office'
      and evidence.match_level in ('exact_address', 'same_building')
      and company.candidate_status <> 'stale'
    group by company.outage_address_id
  )
  select
    selected.candidate_id,
    selected.outage_address_id,
    coalesce(registered_offices.registered_office_count, 0)::bigint
  from selected
  left join registered_offices
    on registered_offices.outage_address_id = selected.outage_address_id
  order by
    selected.selection_order,
    case selected.source when 'cez' then 0 when 'egd' then 1 else 2 end,
    selected.waiting_since,
    selected.candidate_id;
$$;

revoke all on function public.get_complete_power_outage_company_evaluation_candidate_queue(integer)
  from public, anon, authenticated;
grant execute on function public.get_complete_power_outage_company_evaluation_candidate_queue(integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
