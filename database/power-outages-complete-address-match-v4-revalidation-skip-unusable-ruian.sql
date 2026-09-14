begin;

-- Ziva korekce etapy 5: RUIAN lze pouzit k overeni vazby pouze tehdy, kdyz
-- kandidat obsahuje kod adresniho mista. Zachovava historii, pozastavi nove
-- claimy, opravi pouze SHADOW provider plan a po kontrole worker znovu spusti.
select public.pause_complete_power_outage_address_revalidation_v4_v1(
  'provider_plan_correction_skip_unusable_ruian'
);

alter table public.complete_power_outage_address_revalidation_v4_queue
  drop constraint if exists cpo_address_revalidation_v4_queue_provider_plan_check;
alter table public.complete_power_outage_address_revalidation_v4_queue
  drop constraint if exists cpo_address_revalidation_v4_queue_attempt_check;

create or replace function public.enforce_complete_power_outage_address_revalidation_v4_retry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (new.candidate_snapshot ? 'ruianAddressId') then
    new.provider_plan := array_remove(new.provider_plan, 'ruian');
    if new.next_provider = 'ruian' then
      new.next_provider := 'mapy';
    end if;
  end if;
  new.max_attempt_count := least(
    9,
    greatest(new.attempt_count + 3, cardinality(new.provider_plan) * 3)
  );
  return new;
end;
$$;

update public.complete_power_outage_address_revalidation_v4_queue queue_row
set provider_plan = case
      when queue_row.company_ico is not null
        then array['ares', 'mapy']::text[]
      else array['mapy']::text[]
    end,
    next_provider = case
      when queue_row.next_provider = 'ruian' then 'mapy'
      else queue_row.next_provider
    end,
    metadata = queue_row.metadata || jsonb_build_object(
      'providerPlanCorrectedAt', now(),
      'providerPlanCorrection', 'skip_ruian_without_candidate_address_id'
    ),
    updated_at = now()
where not (queue_row.candidate_snapshot ? 'ruianAddressId')
  and 'ruian' = any(queue_row.provider_plan)
  and queue_row.queue_status in ('pending', 'processing');

-- Platny lease muze dobehnout ze stareho requestu. Pokud jeste zadny externi
-- request nebezi, vratime polozku okamzite do pending; stary token tim zanikne.
update public.complete_power_outage_address_revalidation_v4_queue queue_row
set queue_status = 'pending',
    next_attempt_at = now(),
    lease_token = null,
    lease_expires_at = null,
    updated_at = now()
where queue_row.queue_status = 'processing'
  and not (queue_row.candidate_snapshot ? 'ruianAddressId')
  and queue_row.next_provider = 'mapy';

alter table public.complete_power_outage_address_revalidation_v4_queue
  add constraint cpo_address_revalidation_v4_queue_provider_plan_check check (
    cardinality(provider_plan) between 1 and 3
    and provider_plan <@ array['ares', 'ruian', 'mapy']::text[]
    and array_position(provider_plan, null) is null
    and next_provider = any(provider_plan)
    and (
      (
        company_ico is not null
        and candidate_snapshot ? 'ruianAddressId'
        and provider_plan = array['ares', 'ruian', 'mapy']::text[]
      )
      or (
        company_ico is not null
        and not (candidate_snapshot ? 'ruianAddressId')
        and provider_plan = array['ares', 'mapy']::text[]
      )
      or (
        company_ico is null
        and candidate_snapshot ? 'ruianAddressId'
        and provider_plan = array['ruian', 'mapy']::text[]
      )
      or (
        company_ico is null
        and not (candidate_snapshot ? 'ruianAddressId')
        and provider_plan = array['mapy']::text[]
      )
    )
  );

alter table public.complete_power_outage_address_revalidation_v4_queue
  add constraint cpo_address_revalidation_v4_queue_attempt_check check (
    attempt_count between 0 and max_attempt_count
    and max_attempt_count between cardinality(provider_plan) * 3 and 9
  );

update public.complete_power_outage_address_match_state state_row
set metadata = state_row.metadata || jsonb_build_object(
      'externalProviderPlanRevision', 2,
      'externalRuianRequiresCandidateAddressId', true,
      'externalProviderPlanCorrectedAt', now()
    ),
    updated_at = now()
where state_row.singleton;

select public.activate_complete_power_outage_address_revalidation_v4_v1()
  as address_revalidation_reactivation;

commit;

select
  count(*) filter (
    where queue_status in ('pending', 'processing')
      and 'ruian' = any(provider_plan)
      and not (candidate_snapshot ? 'ruianAddressId')
  )::bigint as unusable_ruian_remaining,
  count(*) filter (
    where queue_status in ('pending', 'processing')
      and next_provider = 'mapy'
  )::bigint as waiting_for_mapy,
  count(*) filter (
    where queue_status in ('pending', 'processing')
      and next_provider = 'ares'
  )::bigint as waiting_for_ares
from public.complete_power_outage_address_revalidation_v4_queue;
