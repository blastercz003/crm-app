begin;

-- Oprava adresniho matcheru KOMPLETNI, etapa 4.
-- Instaluje databazovy kontrakt externiho workeru, ale ponechava vsechny
-- prepinace vypnute, frontu ve stavu prepared a nevytvari zadny cron.
do $$
begin
  if to_regclass('public.complete_power_outage_address_revalidation_v4_queue') is null
     or to_regclass('public.complete_power_outage_address_revalidation_v4_attempts') is null then
    raise exception 'Etapa 4 vyzaduje dokoncenou frontu externi revalidace z etapy 3.';
  end if;

  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.contract = 'complete-address-match-v4'
      and state_row.runtime_mode = 'shadow'
      and not state_row.revalidation_enabled
      and not state_row.external_validation_enabled
      and coalesce((state_row.metadata ->> 'externalQueueReady')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalQueueRemainingCount')::bigint, -1) = 0
  ) then
    raise exception 'Etapa 4 vyzaduje kompletni pozastavenou SHADOW frontu.';
  end if;
end
$$;

-- Kazdy provider muze mit nejvyse tri docasne pokusy. Nejednoznacny nebo
-- nenalezeny vysledek prechazi na dalsi provider okamzite.
alter table public.complete_power_outage_address_revalidation_v4_attempts
  drop constraint if exists cpo_address_revalidation_v4_attempts_queue_provider_unique;
alter table public.complete_power_outage_address_revalidation_v4_attempts
  drop constraint if exists cpo_address_revalidation_v4_attempts_number_check;
alter table public.complete_power_outage_address_revalidation_v4_attempts
  add constraint cpo_address_revalidation_v4_attempts_number_check
  check (attempt_number between 1 and 9);

alter table public.complete_power_outage_address_revalidation_v4_queue
  drop constraint if exists cpo_address_revalidation_v4_queue_attempt_check;
update public.complete_power_outage_address_revalidation_v4_queue
set max_attempt_count = cardinality(provider_plan) * 3,
    updated_at = now()
where max_attempt_count <> cardinality(provider_plan) * 3;
alter table public.complete_power_outage_address_revalidation_v4_queue
  add constraint cpo_address_revalidation_v4_queue_attempt_check check (
    attempt_count between 0 and max_attempt_count
    and max_attempt_count = cardinality(provider_plan) * 3
  );

create or replace function public.enforce_complete_power_outage_address_revalidation_v4_retry_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.max_attempt_count := cardinality(new.provider_plan) * 3;
  return new;
end;
$$;

drop trigger if exists cpo_address_revalidation_v4_queue_retry_limit
  on public.complete_power_outage_address_revalidation_v4_queue;
create trigger cpo_address_revalidation_v4_queue_retry_limit
before insert or update of provider_plan, max_attempt_count
on public.complete_power_outage_address_revalidation_v4_queue
for each row execute function public.enforce_complete_power_outage_address_revalidation_v4_retry_limit();

create table if not exists public.complete_power_outage_address_revalidation_v4_ruian_quota (
  singleton boolean primary key default true check (singleton),
  minute_started_at timestamptz not null default date_trunc('minute', now()),
  minute_request_count integer not null default 0,
  day_started_on date not null default (timezone('Europe/Prague', now()))::date,
  day_request_count integer not null default 0,
  last_request_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint cpo_address_revalidation_v4_ruian_quota_counts_check check (
    minute_request_count >= 0 and day_request_count >= 0
  )
);

insert into public.complete_power_outage_address_revalidation_v4_ruian_quota (singleton)
values (true)
on conflict (singleton) do nothing;

create or replace function public.claim_complete_power_outage_address_revalidation_v4_ruian_quota(
  requested_minute_limit integer default 4,
  requested_day_limit integer default 500
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota_row public.complete_power_outage_address_revalidation_v4_ruian_quota%rowtype;
  current_minute timestamptz := date_trunc('minute', now());
  current_day date := (timezone('Europe/Prague', now()))::date;
  safe_minute_limit integer := least(10, greatest(1, coalesce(requested_minute_limit, 4)));
  safe_day_limit integer := least(1000, greatest(1, coalesce(requested_day_limit, 500)));
begin
  insert into public.complete_power_outage_address_revalidation_v4_ruian_quota (singleton)
  values (true)
  on conflict (singleton) do nothing;

  select * into quota_row
  from public.complete_power_outage_address_revalidation_v4_ruian_quota
  where singleton
  for update;

  if quota_row.minute_started_at < current_minute then
    quota_row.minute_started_at := current_minute;
    quota_row.minute_request_count := 0;
  end if;
  if quota_row.day_started_on <> current_day then
    quota_row.day_started_on := current_day;
    quota_row.day_request_count := 0;
  end if;

  if quota_row.minute_request_count >= safe_minute_limit
     or quota_row.day_request_count >= safe_day_limit then
    update public.complete_power_outage_address_revalidation_v4_ruian_quota
    set minute_started_at = quota_row.minute_started_at,
        minute_request_count = quota_row.minute_request_count,
        day_started_on = quota_row.day_started_on,
        day_request_count = quota_row.day_request_count,
        updated_at = now()
    where singleton;
    return false;
  end if;

  update public.complete_power_outage_address_revalidation_v4_ruian_quota
  set minute_started_at = quota_row.minute_started_at,
      minute_request_count = quota_row.minute_request_count + 1,
      day_started_on = quota_row.day_started_on,
      day_request_count = quota_row.day_request_count + 1,
      last_request_at = now(),
      updated_at = now()
  where singleton;
  return true;
end;
$$;

create or replace function public.claim_complete_power_outage_address_revalidation_v4_v1(
  requested_limit integer default 1
)
returns table (
  id uuid,
  processing_token uuid,
  provider text,
  attempt_count integer,
  max_attempt_count integer,
  company_ico text,
  company_name text,
  target_snapshot jsonb,
  candidate_snapshot jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(3, greatest(1, coalesce(requested_limit, 1)));
begin
  -- Dokud neprobehne budouci samostatna aktivace, vraci funkce prazdnou sadu
  -- a nemuze odemknout ani jedinou polozku prepared.
  if not exists (
    select 1
    from public.complete_power_outage_address_match_state state_row
    where state_row.singleton
      and state_row.runtime_mode = 'shadow'
      and state_row.revalidation_enabled
      and state_row.external_validation_enabled
      and coalesce((state_row.metadata ->> 'externalQueueExecutionEnabled')::boolean, false)
      and coalesce((state_row.metadata ->> 'externalRequestsAllowed')::boolean, false)
  ) then
    return;
  end if;

  return query
  with selected as (
    select queue_row.id
    from public.complete_power_outage_address_revalidation_v4_queue queue_row
    where (
        queue_row.queue_status = 'pending'
        and (queue_row.next_attempt_at is null or queue_row.next_attempt_at <= now())
      )
      or (
        queue_row.queue_status = 'processing'
        and queue_row.lease_expires_at <= now()
      )
    order by queue_row.priority, queue_row.next_attempt_at nulls first,
      queue_row.created_at, queue_row.id
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_address_revalidation_v4_queue queue_row
    set queue_status = 'processing',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '5 minutes',
        next_attempt_at = null,
        updated_at = now()
    from selected
    where queue_row.id = selected.id
    returning queue_row.*
  )
  select
    claimed.id,
    claimed.lease_token,
    claimed.next_provider,
    claimed.attempt_count,
    claimed.max_attempt_count,
    claimed.company_ico,
    claimed.company_name,
    claimed.target_snapshot,
    claimed.candidate_snapshot
  from claimed;
end;
$$;

create or replace function public.release_complete_power_outage_address_revalidation_v4_claim_v1(
  requested_queue_id uuid,
  requested_processing_token uuid,
  requested_delay_seconds integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.complete_power_outage_address_revalidation_v4_queue queue_row
  set queue_status = 'pending',
      next_attempt_at = now() + make_interval(
        secs => least(3600, greatest(15, coalesce(requested_delay_seconds, 60)))
      ),
      lease_token = null,
      lease_expires_at = null,
      updated_at = now()
  where queue_row.id = requested_queue_id
    and queue_row.queue_status = 'processing'
    and queue_row.lease_token = requested_processing_token;
  return found;
end;
$$;

create or replace function public.finish_complete_power_outage_address_revalidation_v4_v1(
  requested_queue_id uuid,
  requested_processing_token uuid,
  requested_outcome text,
  requested_response_fingerprint text default null,
  requested_normalized_result jsonb default '{}'::jsonb,
  requested_error_code text default null,
  requested_started_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_row public.complete_power_outage_address_revalidation_v4_queue%rowtype;
  safe_outcome text := lower(btrim(coalesce(requested_outcome, '')));
  safe_result jsonb := coalesce(requested_normalized_result, '{}'::jsonb);
  current_attempt integer;
  provider_attempt_count integer;
  provider_position integer;
  following_provider text;
  following_status text;
  retry_delay_seconds integer;
begin
  if safe_outcome not in (
    'verified', 'conflict', 'inconclusive', 'not_found',
    'transient_error', 'configuration_error'
  ) then
    raise exception 'Neplatny vysledek externi adresni revalidace.';
  end if;
  if jsonb_typeof(safe_result) <> 'object' then
    raise exception 'Normalizovany vysledek musi byt JSON objekt.';
  end if;
  if requested_response_fingerprint is not null
     and requested_response_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Neplatny otisk odpovedi externi revalidace.';
  end if;

  select * into queue_row
  from public.complete_power_outage_address_revalidation_v4_queue
  where id = requested_queue_id
  for update;

  if queue_row.id is null
     or queue_row.queue_status <> 'processing'
     or queue_row.lease_token <> requested_processing_token
     or queue_row.lease_expires_at < now() then
    return false;
  end if;

  current_attempt := queue_row.attempt_count + 1;
  if current_attempt > queue_row.max_attempt_count then
    raise exception 'Pocet pokusu externi revalidace prekrocil pevny limit.';
  end if;

  insert into public.complete_power_outage_address_revalidation_v4_attempts (
    queue_id, provider, attempt_number, outcome, response_fingerprint,
    normalized_result, error_code, started_at, finished_at
  ) values (
    queue_row.id, queue_row.next_provider, current_attempt, safe_outcome,
    requested_response_fingerprint, safe_result, nullif(btrim(requested_error_code), ''),
    least(coalesce(requested_started_at, now()), now()), now()
  );

  select count(*) into provider_attempt_count
  from public.complete_power_outage_address_revalidation_v4_attempts attempt
  where attempt.queue_id = queue_row.id
    and attempt.provider = queue_row.next_provider;

  provider_position := array_position(queue_row.provider_plan, queue_row.next_provider);
  following_provider := queue_row.provider_plan[provider_position + 1];

  if safe_outcome = 'verified' then
    following_status := 'verified';
  elsif safe_outcome = 'conflict' then
    following_status := 'conflict';
  elsif safe_outcome in ('inconclusive', 'not_found') then
    following_status := case when following_provider is null then 'needs_review' else 'pending' end;
  elsif safe_outcome = 'transient_error' and provider_attempt_count < 3 then
    following_status := 'pending';
    following_provider := queue_row.next_provider;
  elsif safe_outcome = 'transient_error' then
    following_status := case when following_provider is null then 'exhausted' else 'pending' end;
  else
    following_status := 'needs_review';
    following_provider := queue_row.next_provider;
  end if;

  retry_delay_seconds := case provider_attempt_count
    when 1 then 60
    when 2 then 300
    else 1800
  end;

  update public.complete_power_outage_address_revalidation_v4_queue current_queue
  set queue_status = following_status,
      next_provider = coalesce(following_provider, current_queue.next_provider),
      attempt_count = current_attempt,
      next_attempt_at = case
        when following_status = 'pending' and safe_outcome = 'transient_error'
          then now() + make_interval(secs => retry_delay_seconds)
        when following_status = 'pending' then now()
        else null
      end,
      lease_token = null,
      lease_expires_at = null,
      last_error_code = case
        when safe_outcome in ('transient_error', 'configuration_error')
          then coalesce(nullif(btrim(requested_error_code), ''), upper(safe_outcome))
        else null
      end,
      metadata = current_queue.metadata || jsonb_build_object(
        'lastProvider', queue_row.next_provider,
        'lastOutcome', safe_outcome,
        'lastCompletedAt', now()
      ),
      updated_at = now()
  where current_queue.id = queue_row.id;

  if safe_outcome = 'configuration_error' then
    update public.complete_power_outage_address_match_state state_row
    set revalidation_enabled = false,
        external_validation_enabled = false,
        metadata = state_row.metadata || jsonb_build_object(
          'externalQueueExecutionEnabled', false,
          'externalRequestsAllowed', false,
          'externalWorkerPausedAt', now(),
          'externalWorkerPauseReason', coalesce(
            nullif(btrim(requested_error_code), ''), 'CONFIGURATION_ERROR'
          )
        ),
        updated_at = now()
    where state_row.singleton;
  end if;

  return true;
end;
$$;

alter table public.complete_power_outage_address_revalidation_v4_ruian_quota
  enable row level security;

revoke all on table public.complete_power_outage_address_revalidation_v4_ruian_quota
  from public, anon, authenticated;
grant select, insert, update on table public.complete_power_outage_address_revalidation_v4_ruian_quota
  to service_role;

revoke all on function public.claim_complete_power_outage_address_revalidation_v4_ruian_quota(integer, integer)
  from public, anon, authenticated;
revoke all on function public.enforce_complete_power_outage_address_revalidation_v4_retry_limit()
  from public, anon, authenticated;
revoke all on function public.claim_complete_power_outage_address_revalidation_v4_v1(integer)
  from public, anon, authenticated;
revoke all on function public.release_complete_power_outage_address_revalidation_v4_claim_v1(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.finish_complete_power_outage_address_revalidation_v4_v1(uuid, uuid, text, text, jsonb, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.claim_complete_power_outage_address_revalidation_v4_ruian_quota(integer, integer)
  to service_role;
grant execute on function public.enforce_complete_power_outage_address_revalidation_v4_retry_limit()
  to service_role;
grant execute on function public.claim_complete_power_outage_address_revalidation_v4_v1(integer)
  to service_role;
grant execute on function public.release_complete_power_outage_address_revalidation_v4_claim_v1(uuid, uuid, integer)
  to service_role;
grant execute on function public.finish_complete_power_outage_address_revalidation_v4_v1(uuid, uuid, text, text, jsonb, text, timestamptz)
  to service_role;

update public.complete_power_outage_address_match_state state_row
set metadata = state_row.metadata || jsonb_build_object(
      'stage', 4,
      'externalWorkerInstalled', true,
      'externalWorkerBatchLimit', 3,
      'externalWorkerLeaseSeconds', 300,
      'externalProviderRetryLimit', 3,
      'externalRuianMinuteLimit', 4,
      'externalRuianDayLimit', 500,
      'externalQueueExecutionEnabled', false,
      'externalRequestsAllowed', false,
      'externalWorkerInstalledAt', now()
    ),
    updated_at = now()
where state_row.singleton;

commit;
