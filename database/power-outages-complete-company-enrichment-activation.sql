begin;

do $$
begin
  if to_regprocedure('public.claim_complete_power_outage_company_enrichment(integer)') is null
     or to_regprocedure('public.finish_complete_power_outage_company_enrichment(text,uuid,text,uuid,text,text,boolean)') is null
     or to_regprocedure('public.request_power_outages_endpoint(text)') is null then
    raise exception 'Chybí závislosti pro bezpečnou aktivaci ARES/RES enrichmentu.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_company_enrichment_activations (
  id uuid primary key default gen_random_uuid(),
  activation_status text not null default 'capturing',
  current_candidate_count bigint not null default 0,
  unique_ico_count bigint not null default 0,
  represented_queue_count bigint not null default 0,
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_company_enrichment_activation_status_check check (
    activation_status in ('capturing', 'complete', 'failed')
  ),
  constraint cpo_company_enrichment_activation_counts_check check (
    current_candidate_count >= 0
    and unique_ico_count >= 0
    and represented_queue_count >= 0
    and represented_queue_count <= unique_ico_count
  ),
  constraint cpo_company_enrichment_activation_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint cpo_company_enrichment_activation_complete_check check (
    activation_status <> 'complete'
    or (activated_at is not null and represented_queue_count = unique_ico_count)
  )
);

create table if not exists public.complete_power_outage_company_enrichment_activation_items (
  activation_id uuid not null
    references public.complete_power_outage_company_enrichment_activations(id) on delete restrict,
  ico text not null,
  candidate_count integer not null,
  sources text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  primary key (activation_id, ico),
  constraint cpo_company_enrichment_activation_item_ico_check check (ico ~ '^[0-9]{8}$'),
  constraint cpo_company_enrichment_activation_item_count_check check (candidate_count > 0),
  constraint cpo_company_enrichment_activation_item_sources_check check (
    array_position(sources, null) is null and sources <@ array['cez', 'egd', 'pre']::text[]
  )
);

create or replace function public.protect_complete_power_outage_company_enrichment_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or old.activation_status = 'complete' then
    raise exception 'Dokončený aktivační manifest ARES/RES je neměnný.';
  end if;
  return new;
end;
$$;

drop trigger if exists cpo_company_enrichment_activation_immutable
  on public.complete_power_outage_company_enrichment_activations;
create trigger cpo_company_enrichment_activation_immutable
before update or delete on public.complete_power_outage_company_enrichment_activations
for each row execute function public.protect_complete_power_outage_company_enrichment_activation();

create or replace function public.enqueue_current_complete_power_outage_company_enrichment()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer;
begin
  if not coalesce((
    select state_row.res_enrichment_enabled
    from public.complete_power_outage_commercial_selection_state state_row
    where state_row.singleton
  ), false) then
    return 0;
  end if;

  insert into public.complete_power_outage_company_enrichment_queue (
    ico, queue_status, priority, requested_sources, next_attempt_at, metadata
  )
  select distinct
    company.ico,
    'pending',
    100,
    array['res']::text[],
    now(),
    jsonb_build_object('queueReason', 'current_complete_company', 'queuedAt', now())
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address_row
    on address_row.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address_row.outage_id
  where company.ico ~ '^[0-9]{8}$'
    and company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
  on conflict (ico) do update
  set queue_status = 'pending',
      company_profile_id = null,
      attempt_count = 0,
      next_attempt_at = now(),
      processing_token = null,
      processing_expires_at = null,
      started_at = null,
      finished_at = null,
      last_error_code = null,
      last_error_message = null,
      metadata = public.complete_power_outage_company_enrichment_queue.metadata
        || jsonb_build_object('refreshReason', 'expired_profile', 'requeuedAt', now())
  where public.complete_power_outage_company_enrichment_queue.queue_status = 'ready'
    and (
      public.complete_power_outage_company_enrichment_queue.company_profile_id is null
      or exists (
        select 1
        from public.complete_power_outage_company_profiles profile_row
        where profile_row.id = public.complete_power_outage_company_enrichment_queue.company_profile_id
          and profile_row.expires_at <= now()
      )
    );
  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.enqueue_complete_power_outage_company_enrichment_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.ico, '') !~ '^[0-9]{8}$'
     or new.candidate_status not in ('confirmed', 'needs_review')
     or new.business_relevance_status <> 'eligible'
     or not coalesce((
       select state_row.res_enrichment_enabled
       from public.complete_power_outage_commercial_selection_state state_row
       where state_row.singleton
     ), false) then
    return new;
  end if;

  if exists (
    select 1
    from public.complete_power_outage_addresses address_row
    join public.complete_power_outages outage on outage.id = address_row.outage_id
    where address_row.id = new.outage_address_id
      and outage.ends_at >= now()
      and outage.source_status in ('scheduled', 'active')
  ) then
    insert into public.complete_power_outage_company_enrichment_queue (
      ico, queue_status, priority, requested_sources, next_attempt_at, metadata
    ) values (
      new.ico, 'pending', 100, array['res']::text[], now(),
      jsonb_build_object('queueReason', 'new_current_complete_company', 'queuedAt', now())
    )
    on conflict (ico) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists cpo_companies_enqueue_res_enrichment
  on public.complete_power_outage_companies;
create trigger cpo_companies_enqueue_res_enrichment
after insert or update of ico, candidate_status, business_relevance_status
on public.complete_power_outage_companies
for each row execute function public.enqueue_complete_power_outage_company_enrichment_trigger();

create or replace function public.activate_complete_power_outage_company_enrichment()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activation_id uuid := gen_random_uuid();
  candidate_count bigint;
  ico_count bigint;
  queue_count bigint;
  existing_activation_id uuid;
begin
  perform 1
  from public.complete_power_outage_commercial_selection_state
  where singleton
  for update;

  if coalesce((
    select res_enrichment_enabled
    from public.complete_power_outage_commercial_selection_state
    where singleton
  ), false) then
    select id into existing_activation_id
    from public.complete_power_outage_company_enrichment_activations
    where activation_status = 'complete'
    order by activated_at desc
    limit 1;
    return existing_activation_id;
  end if;

  select count(*), count(distinct company.ico)
  into candidate_count, ico_count
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address_row
    on address_row.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address_row.outage_id
  where company.ico ~ '^[0-9]{8}$'
    and company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active');
  if ico_count = 0 then
    raise exception 'Aktivaci nelze provést: aktuální tabulka KOMPLETNÍ neobsahuje žádné způsobilé IČO.';
  end if;

  insert into public.complete_power_outage_company_enrichment_activations (
    id, activation_status, current_candidate_count, unique_ico_count, metadata
  ) values (
    activation_id, 'capturing', candidate_count, ico_count,
    jsonb_build_object(
      'scope', 'visible_current_complete_companies',
      'priorityPolicy', 'equal_priority_no_date_or_distributor_weighting',
      'sourceRegistry', 'public_ares_res'
    )
  );

  insert into public.complete_power_outage_company_enrichment_activation_items (
    activation_id, ico, candidate_count, sources
  )
  select activation_id, company.ico, count(*)::integer,
    array_agg(distinct outage.source::text order by outage.source::text)
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address_row
    on address_row.id = company.outage_address_id
  join public.complete_power_outages outage
    on outage.id = address_row.outage_id
  where company.ico ~ '^[0-9]{8}$'
    and company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
  group by company.ico;

  insert into public.complete_power_outage_company_enrichment_queue (
    ico, queue_status, priority, requested_sources, next_attempt_at, metadata
  )
  select item.ico, 'pending', 100, array['res']::text[], now(),
    jsonb_build_object('queueReason', 'controlled_backfill', 'activationId', activation_id)
  from public.complete_power_outage_company_enrichment_activation_items item
  where item.activation_id = activation_id
  on conflict (ico) do nothing;

  select count(*) into queue_count
  from public.complete_power_outage_company_enrichment_activation_items item
  join public.complete_power_outage_company_enrichment_queue queue_row on queue_row.ico = item.ico
  where item.activation_id = activation_id;
  if queue_count <> ico_count then
    raise exception 'Aktivační manifest není kompletně zastoupen ve frontě (% z %).', queue_count, ico_count;
  end if;

  update public.complete_power_outage_company_enrichment_activations
  set activation_status = 'complete', represented_queue_count = queue_count, activated_at = now()
  where id = activation_id;

  update public.complete_power_outage_commercial_selection_state
  set res_enrichment_enabled = true,
      last_enrichment_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'resActivationId', activation_id,
        'resActivatedAt', now(),
        'resBackfillIcoCount', ico_count
      )
  where singleton;
  return activation_id;
end;
$$;

create or replace function public.pause_complete_power_outage_company_enrichment()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.complete_power_outage_commercial_selection_state
  set res_enrichment_enabled = false,
      metadata = metadata || jsonb_build_object('resPausedAt', now())
  where singleton and res_enrichment_enabled;
  return found;
end;
$$;

create or replace function public.request_complete_power_outage_company_enrichment(
  requested_limit integer default 20
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  automation_token text;
  safe_limit integer := least(50, greatest(1, coalesce(requested_limit, 20)));
  request_id bigint;
begin
  if not coalesce((
    select state_row.res_enrichment_enabled
    from public.complete_power_outage_commercial_selection_state state_row
    where state_row.singleton
  ), false) then
    return null;
  end if;

  perform public.enqueue_current_complete_power_outage_company_enrichment();

  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url není platný.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/companies/enrich?limit=' || safe_limit::text,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Company-ARES-RES/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function public.protect_complete_power_outage_company_enrichment_activation()
  from public, anon, authenticated;
revoke all on function public.enqueue_current_complete_power_outage_company_enrichment()
  from public, anon, authenticated;
revoke all on function public.enqueue_complete_power_outage_company_enrichment_trigger()
  from public, anon, authenticated;
revoke all on function public.activate_complete_power_outage_company_enrichment()
  from public, anon, authenticated;
revoke all on function public.pause_complete_power_outage_company_enrichment()
  from public, anon, authenticated;
revoke all on function public.request_complete_power_outage_company_enrichment(integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_current_complete_power_outage_company_enrichment() to service_role;
grant execute on function public.activate_complete_power_outage_company_enrichment() to service_role;
grant execute on function public.pause_complete_power_outage_company_enrichment() to service_role;
grant execute on function public.request_complete_power_outage_company_enrichment(integer) to service_role;

alter table public.complete_power_outage_company_enrichment_activations enable row level security;
alter table public.complete_power_outage_company_enrichment_activation_items enable row level security;

revoke all on table public.complete_power_outage_company_enrichment_activations
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_company_enrichment_activation_items
  from public, anon, authenticated;
grant select on table public.complete_power_outage_company_enrichment_activations to service_role;
grant select on table public.complete_power_outage_company_enrichment_activation_items to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname in (
      'power_outages_complete_company_enrichment_every_minute',
      'power_outages_complete_company_enrichment_every_two_minutes',
      'power_outages_complete_company_enrichment_every_five_minutes'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform public.activate_complete_power_outage_company_enrichment();

  perform cron.schedule(
    'power_outages_complete_company_enrichment_every_minute',
    '* * * * *',
    $job$select public.request_complete_power_outage_company_enrichment(20);$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;
