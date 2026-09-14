begin;

-- Korekce Mapy SHADOW revalidace. Znovu vyhodnoti pouze jiz ulozene vysledky;
-- nevola Mapy ani jinou externi sluzbu a nemeni produkcni vazby firem.
do $$
begin
  if to_regclass('public.complete_power_outage_address_revalidation_v4_attempts') is null
     or to_regclass('public.complete_power_outage_address_revalidation_v4_queue') is null
     or to_regprocedure(
       'public.evaluate_complete_power_outage_address_match_v4(text,text,text,text,text,text,bigint,double precision,double precision,text,bigint,double precision,double precision,integer)'
     ) is null then
    raise exception 'Chybi zavislosti pro lokalni Mapy replay.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
      and not coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
      and not coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
  ) then
    raise exception 'Pred lokalnim Mapy replay musi byt externi SHADOW worker pozastaven.';
  end if;
end
$$;

create or replace function public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(
  target_municipality text,
  target_town_part text,
  target_street text,
  target_house_number text,
  target_orientation_number text,
  target_postal_code text,
  target_ruian_address_id bigint,
  target_latitude double precision,
  target_longitude double precision,
  candidate_display_address text,
  candidate_ruian_address_id bigint,
  candidate_latitude double precision,
  candidate_longitude double precision,
  recorded_distance_meters integer default null
)
returns table (
  classification text,
  automatic_confirmation_allowed boolean,
  confidence_ceiling numeric,
  reason_codes text[],
  distance_meters integer,
  normalized_target_postal_code text,
  normalized_candidate_postal_code text,
  meaningful_street text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  base_result record;
  normalized_candidate_without_postal text;
  normalized_house text := public.complete_power_outage_building_number_v4(target_house_number);
  normalized_orientation text := public.complete_power_outage_building_number_v4(target_orientation_number);
  exact_number_match boolean := false;
begin
  select result.* into base_result
  from public.evaluate_complete_power_outage_address_match_v4(
    target_municipality,
    target_town_part,
    target_street,
    target_house_number,
    target_orientation_number,
    target_postal_code,
    target_ruian_address_id,
    target_latitude,
    target_longitude,
    candidate_display_address,
    candidate_ruian_address_id,
    candidate_latitude,
    candidate_longitude,
    recorded_distance_meters
  ) result;

  normalized_candidate_without_postal := public.normalize_complete_power_outage_address_match_text_v4(
    regexp_replace(
      coalesce(candidate_display_address, ''),
      '(^|[^0-9])[0-9]{3}[[:space:]]?[0-9]{2}([^0-9]|$)',
      ' ',
      'g'
    )
  );

  exact_number_match := case
    when normalized_house is not null and normalized_orientation is not null then
      public.complete_power_outage_address_contains_token_v4(
        normalized_candidate_without_postal, normalized_house
      )
      and public.complete_power_outage_address_contains_token_v4(
        normalized_candidate_without_postal, normalized_orientation
      )
    when normalized_house is not null then
      public.complete_power_outage_address_contains_token_v4(
        normalized_candidate_without_postal, normalized_house
      )
    when normalized_orientation is not null then
      public.complete_power_outage_address_contains_token_v4(
        normalized_candidate_without_postal, normalized_orientation
      )
    else false
  end;

  if base_result.classification = 'needs_external_verification'
     and base_result.reason_codes = array['candidate_postal_code_missing']::text[]
     and exact_number_match
     and base_result.distance_meters is not null
     and base_result.distance_meters <= 500 then
    classification := 'exact_address';
    automatic_confirmation_allowed := true;
    confidence_ceiling := 0.94;
    reason_codes := case
      when base_result.meaningful_street is null then
        array['numbered_locality_match', 'coordinate_supported_number_match']::text[]
      else
        array[
          'municipality_match',
          'street_match',
          'building_number_match',
          'coordinate_supported_number_match'
        ]::text[]
    end;
    distance_meters := base_result.distance_meters;
    normalized_target_postal_code := base_result.normalized_target_postal_code;
    normalized_candidate_postal_code := base_result.normalized_candidate_postal_code;
    meaningful_street := base_result.meaningful_street;
    return next;
    return;
  end if;

  classification := base_result.classification;
  automatic_confirmation_allowed := base_result.automatic_confirmation_allowed;
  confidence_ceiling := base_result.confidence_ceiling;
  reason_codes := base_result.reason_codes;
  distance_meters := base_result.distance_meters;
  normalized_target_postal_code := base_result.normalized_target_postal_code;
  normalized_candidate_postal_code := base_result.normalized_candidate_postal_code;
  meaningful_street := base_result.meaningful_street;
  return next;
end;
$$;

create table if not exists public.complete_power_outage_address_revalidation_v4_replays (
  attempt_id uuid not null
    references public.complete_power_outage_address_revalidation_v4_attempts(id) on delete restrict,
  replay_version integer not null default 1,
  queue_id uuid not null
    references public.complete_power_outage_address_revalidation_v4_queue(id) on delete restrict,
  original_outcome text not null,
  original_reason_codes text[] not null,
  classification text not null,
  automatic_confirmation_allowed boolean not null,
  confidence_ceiling numeric not null,
  reason_codes text[] not null,
  distance_meters integer,
  normalized_target_postal_code text,
  normalized_candidate_postal_code text,
  meaningful_street text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (attempt_id, replay_version),
  constraint cpo_address_revalidation_v4_replays_version_check check (replay_version = 1),
  constraint cpo_address_revalidation_v4_replays_original_check check (
    original_outcome = 'inconclusive'
  ),
  constraint cpo_address_revalidation_v4_replays_classification_check check (
    classification in (
      'exact_address', 'same_building', 'needs_external_verification', 'address_conflict'
    )
  ),
  constraint cpo_address_revalidation_v4_replays_confirmation_check check (
    automatic_confirmation_allowed = (classification in ('exact_address', 'same_building'))
  ),
  constraint cpo_address_revalidation_v4_replays_distance_check check (
    distance_meters is null or distance_meters >= 0
  ),
  constraint cpo_address_revalidation_v4_replays_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create or replace function public.prevent_complete_power_outage_address_revalidation_v4_replay_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Mapy replay audit je nemenny.';
end;
$$;

drop trigger if exists cpo_address_revalidation_v4_replays_immutable
  on public.complete_power_outage_address_revalidation_v4_replays;
create trigger cpo_address_revalidation_v4_replays_immutable
before update or delete
on public.complete_power_outage_address_revalidation_v4_replays
for each row execute function public.prevent_complete_power_outage_address_revalidation_v4_replay_mutation();

create or replace function public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count bigint;
  verified_count bigint;
  review_count bigint;
begin
  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
      and not coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
      and not coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
  ) then
    raise exception 'Mapy replay lze spustit jen pri pozastavenem externim workeru.';
  end if;

  insert into public.complete_power_outage_address_revalidation_v4_replays (
    attempt_id,
    replay_version,
    queue_id,
    original_outcome,
    original_reason_codes,
    classification,
    automatic_confirmation_allowed,
    confidence_ceiling,
    reason_codes,
    distance_meters,
    normalized_target_postal_code,
    normalized_candidate_postal_code,
    meaningful_street,
    metadata
  )
  select
    attempt.id,
    1,
    queue_row.id,
    attempt.outcome,
    coalesce(original_reason.reason_codes, array[]::text[]),
    replay.classification,
    replay.automatic_confirmation_allowed,
    replay.confidence_ceiling,
    replay.reason_codes,
    replay.distance_meters,
    replay.normalized_target_postal_code,
    replay.normalized_candidate_postal_code,
    replay.meaningful_street,
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'replayVersion', 1,
      'provider', 'mapy',
      'externalRequestMade', false,
      'productionMutationMade', false,
      'queueMutationMade', false
    )
  from public.complete_power_outage_address_revalidation_v4_attempts attempt
  join public.complete_power_outage_address_revalidation_v4_queue queue_row
    on queue_row.id = attempt.queue_id
  cross join lateral (
    select array(
      select jsonb_array_elements_text(
        coalesce(attempt.normalized_result -> 'reasonCodes', '[]'::jsonb)
      )
    ) as reason_codes
  ) original_reason
  cross join lateral (
    select candidate_replay.*
    from jsonb_array_elements(
      case
        when jsonb_typeof(queue_row.target_snapshot -> 'buildingNumberPairs') = 'array'
          and jsonb_array_length(queue_row.target_snapshot -> 'buildingNumberPairs') > 0
        then queue_row.target_snapshot -> 'buildingNumberPairs'
        else jsonb_build_array(jsonb_build_object(
          'houseNumber', queue_row.target_snapshot ->> 'houseNumber',
          'orientationNumber', queue_row.target_snapshot ->> 'orientationNumber'
        ))
      end
    ) number_pair(value)
    cross join lateral public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(
      queue_row.target_snapshot ->> 'municipality',
      queue_row.target_snapshot ->> 'townPart',
      queue_row.target_snapshot ->> 'street',
      coalesce(number_pair.value ->> 'houseNumber', queue_row.target_snapshot ->> 'houseNumber'),
      coalesce(number_pair.value ->> 'orientationNumber', queue_row.target_snapshot ->> 'orientationNumber'),
      queue_row.target_snapshot ->> 'postalCode',
      case when coalesce(queue_row.target_snapshot ->> 'ruianAddressId', '') ~ '^[0-9]+$'
        then (queue_row.target_snapshot ->> 'ruianAddressId')::bigint else null end,
      case when coalesce(queue_row.target_snapshot ->> 'latitude', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (queue_row.target_snapshot ->> 'latitude')::double precision else null end,
      case when coalesce(queue_row.target_snapshot ->> 'longitude', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (queue_row.target_snapshot ->> 'longitude')::double precision else null end,
      concat_ws(', ',
        nullif(attempt.normalized_result #>> '{candidate,displayAddress}', ''),
        nullif(attempt.normalized_result #>> '{candidate,postalCode}', '')
      ),
      case when coalesce(attempt.normalized_result #>> '{candidate,ruianAddressId}', '') ~ '^[0-9]+$'
        then (attempt.normalized_result #>> '{candidate,ruianAddressId}')::bigint else null end,
      case when coalesce(attempt.normalized_result #>> '{candidate,latitude}', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (attempt.normalized_result #>> '{candidate,latitude}')::double precision else null end,
      case when coalesce(attempt.normalized_result #>> '{candidate,longitude}', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (attempt.normalized_result #>> '{candidate,longitude}')::double precision else null end,
      case when coalesce(attempt.normalized_result ->> 'distanceMeters', '') ~ '^[0-9]+$'
        then (attempt.normalized_result ->> 'distanceMeters')::integer else null end
    ) candidate_replay
    order by
      case candidate_replay.classification
        when 'exact_address' then 1
        when 'same_building' then 2
        when 'needs_external_verification' then 3
        else 4
      end,
      candidate_replay.confidence_ceiling desc
    limit 1
  ) replay
  where attempt.provider = 'mapy'
    and attempt.outcome = 'inconclusive'
    and attempt.normalized_result ->> 'contract' = 'complete-address-revalidation-v4'
  on conflict (attempt_id, replay_version) do nothing;

  get diagnostics inserted_count = row_count;

  select
    count(*) filter (where replay.automatic_confirmation_allowed),
    count(*) filter (where not replay.automatic_confirmation_allowed)
  into verified_count, review_count
  from public.complete_power_outage_address_revalidation_v4_replays replay
  where replay.replay_version = 1;

  update public.complete_power_outage_address_match_state state_row
  set metadata = state_row.metadata || jsonb_build_object(
        'mapyReplayVersion', 1,
        'mapyReplayReady', true,
        'mapyReplayInsertedCount', inserted_count,
        'mapyReplayVerifiedCount', verified_count,
        'mapyReplayReviewCount', review_count,
        'mapyReplayCompletedAt', now(),
        'mapyZipCapturePrepared', true,
        'productionMatchesMutationAllowed', false
      ),
      updated_at = now()
  where state_row.singleton;

  return jsonb_build_object(
    'status', 'complete',
    'insertedCount', inserted_count,
    'verifiedCount', verified_count,
    'reviewCount', review_count,
    'externalRequestMade', false,
    'productionMutationMade', false
  );
end;
$$;

alter table public.complete_power_outage_address_revalidation_v4_replays
  enable row level security;

revoke all on table public.complete_power_outage_address_revalidation_v4_replays
  from public, anon, authenticated;
grant select, insert on table public.complete_power_outage_address_revalidation_v4_replays
  to service_role;

revoke all on function public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(
  text,text,text,text,text,text,bigint,double precision,double precision,
  text,bigint,double precision,double precision,integer
) from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1()
  from public, anon, authenticated;
revoke all on function public.prevent_complete_power_outage_address_revalidation_v4_replay_mutation()
  from public, anon, authenticated;

grant execute on function public.evaluate_complete_power_outage_address_match_v4_mapy_replay_v1(
  text,text,text,text,text,text,bigint,double precision,double precision,
  text,bigint,double precision,double precision,integer
) to service_role;
grant execute on function public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1()
  to service_role;
grant execute on function public.prevent_complete_power_outage_address_revalidation_v4_replay_mutation()
  to service_role;

select public.refresh_complete_power_outage_address_revalidation_v4_mapy_replay_v1();

commit;
