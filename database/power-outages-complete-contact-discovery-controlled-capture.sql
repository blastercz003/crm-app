begin;

-- Krok 4: kontrolovane zachyceni vybraneho selectoru do pripravene fronty.
-- Funkce nesmi bezet pri aktivnim dohledavani a neprovadi zadny HTTP pozadavek.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is null
     or to_regclass('public.complete_power_outage_contact_discovery_batches') is null
     or to_regclass('public.complete_power_outage_contact_discovery_batch_items') is null
     or to_regclass('public.complete_power_outage_contact_discovery_queue') is null
     or to_regclass('public.complete_power_outage_contact_discovery_state') is null
  then
    raise exception 'Chybi zavislosti pro kontrolovane zachyceni kontaktni fronty.';
  end if;
end
$$;

create or replace function public.capture_complete_power_outage_contact_discovery_batch(
  requested_selector_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  v_selector_key text;
  v_selection_version_key text;
  v_selector_contract jsonb;
  v_target_set_hash text;
  v_batch_id uuid;
  v_target_count bigint := 0;
  v_profile_ready_count bigint := 0;
  v_profile_waiting_count bigint := 0;
  v_represented_count bigint := 0;
  v_pending_count bigint := 0;
  v_waiting_count bigint := 0;
  v_existing boolean := false;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'complete_power_outage_contact_discovery_controlled_capture',
      0
    )
  ) then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'already_running',
      'finishedAt', now()
    );
  end if;

  perform 1
  from public.complete_power_outage_contact_discovery_state
  where singleton
  for update;

  if not found then
    raise exception 'Chybi stav dohledavani kontaktu.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
      and (
        state_row.discovery_enabled
        or state_row.website_lookup_enabled
        or state_row.contact_extraction_enabled
        or state_row.email_planning_enabled
        or state_row.email_dispatch_enabled
      )
  ) then
    raise exception 'Pred zachycenim noveho vyberu musi byt dohledavani kontaktu pozastaveno.';
  end if;

  select coalesce(
    nullif(btrim(requested_selector_key), ''),
    state_row.selected_selector_key
  )
  into v_selector_key
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton;

  select
    selector_row.selection_version_key,
    selector_row.selector_contract
  into
    v_selection_version_key,
    v_selector_contract
  from public.complete_power_outage_contact_discovery_selectors selector_row
  where selector_row.selector_key = v_selector_key
    and selector_row.lifecycle_status = 'active';

  if not found then
    raise exception 'Pozadovany selector neexistuje nebo neni aktivni: %.',
      v_selector_key;
  end if;

  select
    count(*)::bigint,
    count(*) filter (where target.has_company_profile)::bigint,
    count(*) filter (where not target.has_company_profile)::bigint,
    md5(
      v_selector_key || ':' || coalesce(
        string_agg(target.ico, '|' order by target.ico),
        ''
      )
    )
  into
    v_target_count,
    v_profile_ready_count,
    v_profile_waiting_count,
    v_target_set_hash
  from public.complete_power_outage_contact_discovery_selector_targets target
  where target.selector_key = v_selector_key;

  if v_target_count = 0 then
    raise exception 'Selector % aktualne neobsahuje zadne zpusobile ICO.',
      v_selector_key;
  end if;

  select batch.id
  into v_batch_id
  from public.complete_power_outage_contact_discovery_batches batch
  where batch.selector_key = v_selector_key
    and batch.metadata ->> 'targetSetHash' = v_target_set_hash
    and batch.batch_status in ('ready', 'active', 'paused', 'completed')
  order by batch.created_at desc
  limit 1;

  v_existing := found;

  if v_existing then
    select
      batch.target_ico_count,
      batch.profile_ready_count,
      batch.profile_waiting_count
    into
      v_target_count,
      v_profile_ready_count,
      v_profile_waiting_count
    from public.complete_power_outage_contact_discovery_batches batch
    where batch.id = v_batch_id;
  end if;

  if not v_existing then
    v_batch_id := gen_random_uuid();

    insert into public.complete_power_outage_contact_discovery_batches (
      id,
      selector_key,
      selection_version_key,
      batch_status,
      selector_contract_snapshot,
      metadata
    ) values (
      v_batch_id,
      v_selector_key,
      v_selection_version_key,
      'capturing',
      v_selector_contract,
      jsonb_build_object(
        'contract', 'complete-contact-discovery-controlled-capture-v1',
        'targetSetHash', v_target_set_hash,
        'externalRequests', false,
        'capturedFrom', 'dynamic-selector-adapter'
      )
    );

    insert into public.complete_power_outage_contact_discovery_batch_items (
      batch_id,
      ico,
      company_profile_id,
      company_name,
      candidate_count,
      outage_count,
      nearest_outage_starts_at,
      latest_outage_ends_at,
      outage_sources,
      profile_ready_at_capture,
      target_snapshot
    )
    select
      v_batch_id,
      target.ico,
      target.company_profile_id,
      target.company_name,
      target.candidate_count,
      target.outage_count,
      target.nearest_outage_starts_at,
      target.latest_outage_ends_at,
      target.outage_sources,
      target.has_company_profile,
      jsonb_build_object(
        'selectorKey', target.selector_key,
        'selectionVersionKey', target.selection_version_key,
        'representativeCandidateId', target.representative_candidate_id,
        'capturedAt', now()
      )
    from public.complete_power_outage_contact_discovery_selector_targets target
    where target.selector_key = v_selector_key
    order by target.ico;

    update public.complete_power_outage_contact_discovery_batches
    set batch_status = 'ready',
        target_ico_count = v_target_count,
        profile_ready_count = v_profile_ready_count,
        profile_waiting_count = v_profile_waiting_count,
        captured_at = now()
    where id = v_batch_id;
  end if;

  insert into public.complete_power_outage_contact_discovery_queue (
    ico,
    origin_batch_id,
    origin_selector_key,
    company_profile_id,
    queue_status,
    priority,
    next_attempt_at,
    metadata
  )
  select
    item.ico,
    item.batch_id,
    batch.selector_key,
    item.company_profile_id,
    case
      when item.company_profile_id is null then 'waiting_profile'
      else 'pending'
    end,
    100,
    case when item.company_profile_id is null then null else now() end,
    jsonb_build_object(
      'queueReason', 'controlled_selector_capture',
      'selectorKey', batch.selector_key,
      'batchId', batch.id,
      'externalRequests', false,
      'queuedAt', now()
    )
  from public.complete_power_outage_contact_discovery_batch_items item
  join public.complete_power_outage_contact_discovery_batches batch
    on batch.id = item.batch_id
  where item.batch_id = v_batch_id
  on conflict (ico) do nothing;

  select count(*)
  into v_represented_count
  from public.complete_power_outage_contact_discovery_batch_items item
  where item.batch_id = v_batch_id
    and exists (
      select 1
      from public.complete_power_outage_contact_discovery_queue queue_row
      where queue_row.ico = item.ico
    );

  if v_represented_count <> v_target_count then
    raise exception 'Davka neni kompletne zastoupena ve fronte (% z %).',
      v_represented_count,
      v_target_count;
  end if;

  update public.complete_power_outage_contact_discovery_batches
  set represented_queue_count = v_represented_count
  where id = v_batch_id;

  select
    count(*) filter (where queue_row.queue_status = 'pending')::bigint,
    count(*) filter (where queue_row.queue_status = 'waiting_profile')::bigint
  into v_pending_count, v_waiting_count
  from public.complete_power_outage_contact_discovery_batch_items item
  join public.complete_power_outage_contact_discovery_queue queue_row
    on queue_row.ico = item.ico
  where item.batch_id = v_batch_id;

  update public.complete_power_outage_contact_discovery_state
  set selected_selector_key = v_selector_key,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'preparedBatchId', v_batch_id,
        'preparedSelectorKey', v_selector_key,
        'preparedTargetSetHash', v_target_set_hash,
        'preparedTargetCount', v_target_count,
        'preparedAt', now(),
        'externalRequests', false
      )
  where singleton;

  return jsonb_build_object(
    'status', case when v_existing then 'already_prepared' else 'prepared' end,
    'batchId', v_batch_id,
    'selectorKey', v_selector_key,
    'targetSetHash', v_target_set_hash,
    'targetIcoCount', v_target_count,
    'profileReadyCount', v_profile_ready_count,
    'profileWaitingCount', v_profile_waiting_count,
    'representedQueueCount', v_represented_count,
    'pendingCount', v_pending_count,
    'waitingProfileCount', v_waiting_count,
    'externalRequests', false,
    'finishedAt', now()
  );
end;
$$;

revoke all on function
  public.capture_complete_power_outage_contact_discovery_batch(text)
  from public, anon, authenticated;
grant execute on function
  public.capture_complete_power_outage_contact_discovery_batch(text)
  to service_role;

-- Kontrolovane zachyceni aktualne zvoleneho TOP VYBERU. Vytvori pouze data
-- pripravene fronty; vsechny aktivacni prepinace zustavaji vypnute.
select public.capture_complete_power_outage_contact_discovery_batch(null);

commit;
