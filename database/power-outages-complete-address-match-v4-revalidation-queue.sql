begin;

-- Oprava adresniho matcheru KOMPLETNI, etapa 3.
-- Vytvari pouze pozastavenou SHADOW frontu pro nejednoznacne vysledky EG.D.
-- Instalace ani naplneni fronty nevola ARES, RUIAN, Mapy nebo jiny HTTP zdroj
-- a nemeni produkcni firmy, dukazy, prirazeni ani komunikaci.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_address_match_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_address_match_state');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_targets') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_address_match_v4_targets');
  end if;
  if to_regclass('public.complete_power_outage_address_match_v4_evaluations') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_address_match_v4_evaluations');
  end if;
  if to_regclass('public.complete_power_outage_companies') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_companies');
  end if;
  if to_regclass('public.complete_power_outage_addresses') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_addresses');
  end if;
  if to_regclass('public.complete_power_outages') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outages');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro frontu adresni revalidace KOMPLETNI v4: %.',
      array_to_string(missing_dependencies, ', ');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
      and coalesce((state_row.metadata ->> 'localShadowProjectionReady')::boolean, false)
      and coalesce((state_row.metadata ->> 'localShadowProjectionRevision')::integer, 0) = 2
  ) then
    raise exception 'Etapa 3 vyzaduje dokonceny lokalni SHADOW audit revize 2 a vypnutou externi revalidaci.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_address_revalidation_v4_queue (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null
    references public.complete_power_outage_address_match_v4_targets(id) on delete cascade,
  company_id uuid not null
    references public.complete_power_outage_companies(id) on delete cascade,
  source text not null default 'egd',
  company_ico text,
  company_name text not null,
  provider_plan text[] not null,
  next_provider text not null,
  queue_status text not null default 'prepared',
  priority integer not null default 100,
  protected_record boolean not null default false,
  attempt_count integer not null default 0,
  max_attempt_count integer not null,
  next_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  target_snapshot jsonb not null,
  candidate_snapshot jsonb not null,
  input_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_address_revalidation_v4_queue_source_check check (source = 'egd'),
  constraint cpo_address_revalidation_v4_queue_ico_check check (
    company_ico is null or company_ico ~ '^[0-9]{8}$'
  ),
  constraint cpo_address_revalidation_v4_queue_name_check check (btrim(company_name) <> ''),
  constraint cpo_address_revalidation_v4_queue_provider_plan_check check (
    cardinality(provider_plan) between 2 and 3
    and provider_plan <@ array['ares', 'ruian', 'mapy']::text[]
    and array_position(provider_plan, null) is null
    and next_provider = any(provider_plan)
    and (
      (company_ico is not null and provider_plan = array['ares', 'ruian', 'mapy']::text[])
      or (company_ico is null and provider_plan = array['ruian', 'mapy']::text[])
    )
  ),
  constraint cpo_address_revalidation_v4_queue_status_check check (
    queue_status in (
      'prepared', 'pending', 'processing', 'verified', 'conflict',
      'needs_review', 'exhausted', 'cancelled'
    )
  ),
  constraint cpo_address_revalidation_v4_queue_attempt_check check (
    attempt_count between 0 and max_attempt_count
    and max_attempt_count = cardinality(provider_plan) * 3
  ),
  constraint cpo_address_revalidation_v4_queue_lease_check check (
    (queue_status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (queue_status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  constraint cpo_address_revalidation_v4_queue_snapshots_check check (
    jsonb_typeof(target_snapshot) = 'object'
    and jsonb_typeof(candidate_snapshot) = 'object'
    and jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_address_revalidation_v4_queue_fingerprint_check check (
    input_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_address_revalidation_v4_queue_target_company_unique unique (target_id, company_id)
);

create index if not exists cpo_address_revalidation_v4_queue_claim_idx
  on public.complete_power_outage_address_revalidation_v4_queue (
    queue_status, next_attempt_at, priority, created_at, id
  )
  where queue_status in ('pending', 'processing');

create index if not exists cpo_address_revalidation_v4_queue_company_idx
  on public.complete_power_outage_address_revalidation_v4_queue (company_id, queue_status);

create table if not exists public.complete_power_outage_address_revalidation_v4_attempts (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references public.complete_power_outage_address_revalidation_v4_queue(id) on delete restrict,
  provider text not null,
  attempt_number integer not null,
  outcome text not null,
  response_fingerprint text,
  normalized_result jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null,
  finished_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cpo_address_revalidation_v4_attempts_provider_check check (
    provider in ('ares', 'ruian', 'mapy')
  ),
  constraint cpo_address_revalidation_v4_attempts_number_check check (attempt_number between 1 and 3),
  constraint cpo_address_revalidation_v4_attempts_outcome_check check (
    outcome in ('verified', 'conflict', 'inconclusive', 'not_found', 'transient_error', 'configuration_error')
  ),
  constraint cpo_address_revalidation_v4_attempts_hash_check check (
    response_fingerprint is null or response_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_address_revalidation_v4_attempts_result_check check (
    jsonb_typeof(normalized_result) = 'object'
  ),
  constraint cpo_address_revalidation_v4_attempts_time_check check (finished_at >= started_at),
  constraint cpo_address_revalidation_v4_attempts_queue_number_unique unique (queue_id, attempt_number),
  constraint cpo_address_revalidation_v4_attempts_queue_provider_unique unique (queue_id, provider)
);

create or replace function public.prevent_complete_power_outage_address_revalidation_v4_attempt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie externi adresni revalidace KOMPLETNI v4 je nemenna.';
end;
$$;

drop trigger if exists cpo_address_revalidation_v4_attempts_immutable
  on public.complete_power_outage_address_revalidation_v4_attempts;
create trigger cpo_address_revalidation_v4_attempts_immutable
before update or delete
on public.complete_power_outage_address_revalidation_v4_attempts
for each row execute function public.prevent_complete_power_outage_address_revalidation_v4_attempt_mutation();

create or replace function public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(
  requested_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(2000, greatest(1, coalesce(requested_limit, 500)));
  processed_count bigint := 0;
  cancelled_count bigint := 0;
  remaining_count bigint := 0;
  prepared_count bigint := 0;
  protected_count bigint := 0;
begin
  if not pg_try_advisory_xact_lock(
    pg_catalog.hashtext('complete_power_outage_address_revalidation_v4_queue')
  ) then
    return jsonb_build_object('status', 'busy');
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
      and coalesce((state_row.metadata ->> 'localShadowProjectionReady')::boolean, false)
      and coalesce((state_row.metadata ->> 'localShadowProjectionRevision')::integer, 0) = 2
  ) then
    raise exception 'Frontu lze pripravit pouze po lokalnim auditu revize 2 pri vypnute revalidaci.';
  end if;

  -- Zrusime pouze dosud nezpracovane SHADOW polozky, ktere uz prestaly byt
  -- nejednoznacne. Zadna produkcni tabulka se tim nemeni.
  with eligible_pairs as (
    select evaluation.target_id, evaluation.company_id
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    join public.complete_power_outage_address_match_v4_targets target
      on target.id = evaluation.target_id and target.source = 'egd'
    join public.complete_power_outage_companies company
      on company.id = evaluation.company_id
    join public.complete_power_outage_addresses address on address.id = target.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    where outage.source = 'egd'
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and company.candidate_status not in ('dismissed', 'stale')
    group by evaluation.target_id, evaluation.company_id
    having bool_or(evaluation.classification = 'needs_external_verification')
       and not bool_or(evaluation.classification in ('exact_address', 'same_building'))
  )
  update public.complete_power_outage_address_revalidation_v4_queue queue_row
  set queue_status = 'cancelled',
      last_error_code = 'NO_LONGER_ELIGIBLE',
      metadata = queue_row.metadata || jsonb_build_object('cancelledAt', now()),
      updated_at = now()
  where queue_row.queue_status = 'prepared'
    and not exists (
      select 1 from eligible_pairs eligible
      where eligible.target_id = queue_row.target_id
        and eligible.company_id = queue_row.company_id
    );

  get diagnostics cancelled_count = row_count;

  with pair_inputs as (
    select
      evaluation.target_id,
      evaluation.company_id,
      target.source,
      target.target_fingerprint,
      target.municipality,
      target.municipality_code,
      target.town_part,
      target.street,
      target.house_number,
      target.orientation_number,
      target.building_number_pairs,
      target.postal_code,
      target.ruian_address_id as target_ruian_address_id,
      target.latitude as target_latitude,
      target.longitude as target_longitude,
      company.ico,
      company.company_name,
      company.display_address,
      company.ruian_address_id as company_ruian_address_id,
      company.latitude as company_latitude,
      company.longitude as company_longitude,
      outage.starts_at,
      bool_or(evaluation.protected_record) as protected_record,
      bool_or(evaluation.classification = 'needs_external_verification') as has_ambiguous,
      bool_or(evaluation.classification in ('exact_address', 'same_building')) as has_local_confirmation,
      encode(extensions.digest(concat_ws('|',
        'complete-address-revalidation-v4',
        target.target_fingerprint,
        evaluation.company_id::text,
        coalesce(company.ico, ''),
        coalesce(company.display_address, ''),
        string_agg(evaluation.input_fingerprint, ',' order by evaluation.evidence_id)
      ), 'sha256'), 'hex') as input_fingerprint
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    join public.complete_power_outage_address_match_v4_targets target
      on target.id = evaluation.target_id
    join public.complete_power_outage_companies company
      on company.id = evaluation.company_id
    join public.complete_power_outage_addresses address
      on address.id = target.outage_address_id
    join public.complete_power_outages outage
      on outage.id = address.outage_id
    where target.source = 'egd'
      and outage.source = 'egd'
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and company.candidate_status not in ('dismissed', 'stale')
    group by
      evaluation.target_id, evaluation.company_id, target.source,
      target.target_fingerprint, target.municipality, target.municipality_code,
      target.town_part, target.street, target.house_number, target.orientation_number,
      target.building_number_pairs, target.postal_code, target.ruian_address_id,
      target.latitude, target.longitude, company.ico, company.company_name,
      company.display_address, company.ruian_address_id, company.latitude,
      company.longitude, outage.starts_at
  ), eligible as (
    select pair_inputs.*
    from pair_inputs
    left join public.complete_power_outage_address_revalidation_v4_queue existing
      on existing.target_id = pair_inputs.target_id
     and existing.company_id = pair_inputs.company_id
    where pair_inputs.has_ambiguous
      and not pair_inputs.has_local_confirmation
      and (
        existing.id is null
        or (
          existing.queue_status in ('prepared', 'cancelled')
          and existing.input_fingerprint <> pair_inputs.input_fingerprint
        )
      )
    order by
      case when pair_inputs.protected_record then 0 else 1 end,
      pair_inputs.starts_at,
      pair_inputs.target_id,
      pair_inputs.company_id
    limit safe_limit
  )
  insert into public.complete_power_outage_address_revalidation_v4_queue as queue_row (
    target_id,
    company_id,
    source,
    company_ico,
    company_name,
    provider_plan,
    next_provider,
    queue_status,
    priority,
    protected_record,
    max_attempt_count,
    target_snapshot,
    candidate_snapshot,
    input_fingerprint,
    metadata,
    updated_at
  )
  select
    eligible.target_id,
    eligible.company_id,
    'egd',
    case when eligible.ico ~ '^[0-9]{8}$' then eligible.ico else null end,
    eligible.company_name,
    case
      when eligible.ico ~ '^[0-9]{8}$' then array['ares', 'ruian', 'mapy']::text[]
      else array['ruian', 'mapy']::text[]
    end,
    case when eligible.ico ~ '^[0-9]{8}$' then 'ares' else 'ruian' end,
    'prepared',
    case
      when eligible.protected_record then 0
      when eligible.starts_at < now() + interval '2 days' then 10
      when eligible.starts_at < now() + interval '7 days' then 20
      else 30
    end,
    eligible.protected_record,
    case when eligible.ico ~ '^[0-9]{8}$' then 9 else 6 end,
    jsonb_strip_nulls(jsonb_build_object(
      'municipality', eligible.municipality,
      'municipalityCode', eligible.municipality_code,
      'townPart', eligible.town_part,
      'street', eligible.street,
      'houseNumber', eligible.house_number,
      'orientationNumber', eligible.orientation_number,
      'buildingNumberPairs', eligible.building_number_pairs,
      'postalCode', eligible.postal_code,
      'ruianAddressId', eligible.target_ruian_address_id,
      'latitude', eligible.target_latitude,
      'longitude', eligible.target_longitude
    )),
    jsonb_strip_nulls(jsonb_build_object(
      'ico', case when eligible.ico ~ '^[0-9]{8}$' then eligible.ico else null end,
      'companyName', eligible.company_name,
      'displayAddress', eligible.display_address,
      'ruianAddressId', eligible.company_ruian_address_id,
      'latitude', eligible.company_latitude,
      'longitude', eligible.company_longitude
    )),
    eligible.input_fingerprint,
    jsonb_build_object(
      'contract', 'complete-address-match-v4',
      'stage', 3,
      'source', 'egd',
      'preparedWithoutExternalRequest', true,
      'outageStartsAt', eligible.starts_at,
      'preparedAt', now()
    ),
    now()
  from eligible
  on conflict (target_id, company_id) do update set
    company_ico = excluded.company_ico,
    company_name = excluded.company_name,
    provider_plan = excluded.provider_plan,
    next_provider = excluded.next_provider,
    queue_status = 'prepared',
    priority = excluded.priority,
    protected_record = excluded.protected_record,
    attempt_count = 0,
    max_attempt_count = excluded.max_attempt_count,
    next_attempt_at = null,
    lease_token = null,
    lease_expires_at = null,
    last_error_code = null,
    target_snapshot = excluded.target_snapshot,
    candidate_snapshot = excluded.candidate_snapshot,
    input_fingerprint = excluded.input_fingerprint,
    metadata = excluded.metadata,
    updated_at = now()
  where queue_row.queue_status in ('prepared', 'cancelled');

  get diagnostics processed_count = row_count;

  with pair_inputs as (
    select
      evaluation.target_id,
      evaluation.company_id,
      target.target_fingerprint,
      company.ico,
      company.display_address,
      bool_or(evaluation.classification = 'needs_external_verification') as has_ambiguous,
      bool_or(evaluation.classification in ('exact_address', 'same_building')) as has_local_confirmation,
      encode(extensions.digest(concat_ws('|',
        'complete-address-revalidation-v4', target.target_fingerprint,
        evaluation.company_id::text, coalesce(company.ico, ''), coalesce(company.display_address, ''),
        string_agg(evaluation.input_fingerprint, ',' order by evaluation.evidence_id)
      ), 'sha256'), 'hex') as input_fingerprint
    from public.complete_power_outage_address_match_v4_evaluations evaluation
    join public.complete_power_outage_address_match_v4_targets target
      on target.id = evaluation.target_id
    join public.complete_power_outage_companies company on company.id = evaluation.company_id
    join public.complete_power_outage_addresses address on address.id = target.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    where target.source = 'egd'
      and outage.source = 'egd'
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and company.candidate_status not in ('dismissed', 'stale')
    group by evaluation.target_id, evaluation.company_id, target.target_fingerprint,
      company.ico, company.display_address
  )
  select count(*) into remaining_count
  from pair_inputs
  left join public.complete_power_outage_address_revalidation_v4_queue queue_row
    on queue_row.target_id = pair_inputs.target_id
   and queue_row.company_id = pair_inputs.company_id
   and queue_row.input_fingerprint = pair_inputs.input_fingerprint
   and queue_row.queue_status <> 'cancelled'
  where pair_inputs.has_ambiguous
    and not pair_inputs.has_local_confirmation
    and queue_row.id is null;

  select
    count(*) filter (where queue_status = 'prepared'),
    count(*) filter (where queue_status = 'prepared' and protected_record)
  into prepared_count, protected_count
  from public.complete_power_outage_address_revalidation_v4_queue;

  update public.complete_power_outage_address_match_state state_row
  set metadata = state_row.metadata || jsonb_build_object(
        'stage', 3,
        'externalQueueSource', 'egd',
        'externalQueueReady', remaining_count = 0,
        'externalQueuePreparedCount', prepared_count,
        'externalQueueProtectedCount', protected_count,
        'externalQueueRemainingCount', remaining_count,
        'externalQueueProviderOrder', jsonb_build_array('ares', 'ruian', 'mapy'),
        'externalQueueExecutionEnabled', false,
        'externalRequestsAllowed', false,
        'latestExternalQueueRefreshAt', now()
      ),
      updated_at = now()
  where state_row.singleton;

  return jsonb_build_object(
    'status', case when remaining_count = 0 then 'complete' else 'pending' end,
    'processedCount', processed_count,
    'cancelledCount', cancelled_count,
    'remainingCount', remaining_count,
    'preparedCount', prepared_count,
    'protectedCount', protected_count,
    'externalRequestsMade', 0
  );
end;
$$;

alter table public.complete_power_outage_address_revalidation_v4_queue enable row level security;
alter table public.complete_power_outage_address_revalidation_v4_attempts enable row level security;

revoke all on table public.complete_power_outage_address_revalidation_v4_queue
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_address_revalidation_v4_attempts
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.complete_power_outage_address_revalidation_v4_queue to service_role;
grant select, insert
  on table public.complete_power_outage_address_revalidation_v4_attempts to service_role;

revoke all on function public.prevent_complete_power_outage_address_revalidation_v4_attempt_mutation()
  from public, anon, authenticated;
revoke all on function public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(integer)
  from public, anon, authenticated;
grant execute on function public.prevent_complete_power_outage_address_revalidation_v4_attempt_mutation()
  to service_role;
grant execute on function public.refresh_complete_power_outage_address_revalidation_v4_queue_v1(integer)
  to service_role;

update public.complete_power_outage_address_match_state state_row
set metadata = state_row.metadata || jsonb_build_object(
      'stage', 3,
      'externalQueueInstalled', true,
      'externalQueueSource', 'egd',
      'externalQueueReady', coalesce(
        (state_row.metadata ->> 'externalQueueReady')::boolean,
        false
      ),
      'externalQueueExecutionEnabled', false,
      'externalRequestsAllowed', false,
      'externalQueueInstalledAt', now()
    ),
    updated_at = now()
where state_row.singleton;

commit;
