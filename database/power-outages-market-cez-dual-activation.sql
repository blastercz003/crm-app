begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if to_regclass('public.power_outage_cez_market_collector_state') is null
    or to_regclass('public.power_outage_cez_market_version_state') is null
    or to_regclass('public.power_outage_cez_market_cycles') is null
    or to_regclass('public.power_outage_cez_market_cycle_targets') is null
    or to_regclass('public.power_outage_cez_market_v2_audit_runs') is null
    or to_regclass('public.power_outage_cez_market_preservation_manifests') is null
    or to_regclass('public.power_outage_cez_market_version_overview') is null
    or to_regclass('public.power_outage_cez_market_union_overview') is null
  then
    raise exception 'Chybí některá z připravených vrstev ČEZ MARKETY v1 + v2.';
  end if;
  if to_regprocedure('public.request_power_outage_cez_market_v2_cycle(text)') is null
    or to_regprocedure('public.capture_power_outage_cez_market_preservation_manifest(text,text)') is null
  then
    raise exception 'Chybí runtime nebo ochranný manifest ČEZ MARKETY v1 + v2.';
  end if;
end
$$;

create or replace function public.request_power_outage_cez_market_v2_endpoint()
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  app_url text;
  automation_token text;
  request_id bigint;
  current_mode text;
  is_ready boolean;
begin
  select state.operating_mode, state.activation_ready
  into current_mode, is_ready
  from public.power_outage_cez_market_collector_state state
  where state.singleton;

  if current_mode not in ('dual', 'v2_only') or not coalesce(is_ready, false) then
    return null;
  end if;

  select trim(trailing '/' from decrypted_secret)
  into app_url
  from vault.decrypted_secrets
  where name = 'weather_alerts_app_url'
  order by created_at desc
  limit 1;

  select decrypted_secret
  into automation_token
  from vault.decrypted_secrets
  where name = 'weather_alerts_automation_token'
  order by created_at desc
  limit 1;

  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url musí obsahovat kořenovou HTTPS adresu aplikace.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybí nebo je příliš krátký.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/cez/v2?limit=8',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-MARKETY-CEZ-v2-Production/1.0'
    ),
    timeout_milliseconds := 300000
  ) into request_id;

  return request_id;
end;
$$;

create or replace function public.activate_power_outage_cez_market_dual(
  requested_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_mode text;
  current_revision bigint := 0;
  audit_revision bigint := 0;
  audit_total integer := 0;
  pre_activation_manifest_id uuid;
  initial_cycle_id uuid;
  existing_job record;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Dual režim ČEZ MARKETY může aktivovat pouze service role.';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('power_outage_cez_market_dual_activation', 0)) then
    raise exception 'Jiná aktivace ČEZ MARKETY právě probíhá.';
  end if;

  select state.operating_mode
  into current_mode
  from public.power_outage_cez_market_collector_state state
  where state.singleton
  for update;

  if current_mode = 'dual' then
    select cycle.id into initial_cycle_id
    from public.power_outage_cez_market_cycles cycle
    where cycle.collector_version = 'v2'
      and cycle.status in ('pending', 'running')
    order by cycle.created_at desc
    limit 1;
    return jsonb_build_object(
      'status', 'already_active',
      'operatingMode', 'dual',
      'cycleId', initial_cycle_id
    );
  end if;
  if current_mode <> 'v1_only' then
    raise exception 'Aktivaci dual režimu lze provést pouze z bezpečného režimu v1_only.';
  end if;

  if not exists (
    select 1
    from public.power_outage_cez_market_collector_versions version
    where version.version = 'v1' and version.rollback_available
  ) or not exists (
    select 1
    from public.power_outage_cez_market_collector_versions version
    where version.version = 'v2' and version.rollback_available
  ) then
    raise exception 'Chybí neměnné definice v1/v2 nebo možnost návratu na v1.';
  end if;

  select coalesce(catalog.revision, 0)
  into current_revision
  from public.power_outage_store_catalog_state catalog
  where catalog.singleton;

  select audit.catalog_revision, audit.address_total_count
  into audit_revision, audit_total
  from public.power_outage_cez_market_v2_audit_runs audit
  where audit.status = 'succeeded'
    and audit.address_total_count = audit.address_processed_count
    and audit.address_processed_count = audit.address_success_count
    and audit.address_error_count = 0
    and audit.requested_sample_count >= 700
  order by audit.finished_at desc
  limit 1;

  if audit_revision is null or audit_total < 700 then
    raise exception 'Chybí úspěšný úplný audit ČEZ MARKETY v2 alespoň pro 700 adres.';
  end if;
  if current_revision < audit_revision or current_revision - audit_revision > 10 then
    raise exception 'Katalog prodejen se od úplného auditu v2 změnil o příliš mnoho revizí (% → %).',
      audit_revision, current_revision;
  end if;
  if not exists (
    select 1
    from public.power_outage_cez_market_preservation_manifests manifest
    where manifest.manifest_kind = 'foundation' and manifest.status = 'complete'
  ) then
    raise exception 'Chybí dokončený výchozí ochranný manifest ČEZ MARKETY.';
  end if;
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'po_cez_market_address_observations_normalize_timestamps'
      and not tgisinternal
  ) then
    raise exception 'Chybí oprava časových stop verzovaných pozorování ČEZ MARKETY.';
  end if;
  if exists (
    select 1
    from public.power_outage_cez_market_cycles cycle
    where cycle.collector_version = 'v2'
      and cycle.status in ('pending', 'running')
  ) then
    raise exception 'Před aktivací již neočekávaně existuje otevřený produkční cyklus v2.';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_app_url'
      and nullif(trim(decrypted_secret), '') is not null
  ) or not exists (
    select 1 from vault.decrypted_secrets
    where name = 'weather_alerts_automation_token'
      and length(decrypted_secret) >= 32
  ) then
    raise exception 'Chybí Vault konfigurace pro bezpečné volání produkčního endpointu v2.';
  end if;

  pre_activation_manifest_id := public.capture_power_outage_cez_market_preservation_manifest(
    'pre_activation',
    coalesce(
      nullif(btrim(requested_note), ''),
      'Bezpečný otisk bezprostředně před aktivací souběžného režimu ČEZ MARKETY v1 + v2.'
    )
  );

  update public.power_outage_cez_market_collector_state
  set previous_version = active_version,
      operating_mode = 'dual',
      active_version = 'v2',
      primary_version = 'v2',
      secondary_version = 'v1',
      activation_ready = true,
      switched_at = now(),
      switched_by = auth.uid(),
      switch_note = coalesce(
        nullif(btrim(requested_note), ''),
        'Aktivován souběžný režim: v2 primární, v1 kontrolní každých 24 hodin.'
      )
  where singleton;

  update public.power_outage_cez_market_version_state
  set metadata = metadata || jsonb_build_object(
        'activationState', 'active',
        'activatedAt', now(),
        'preActivationManifestId', pre_activation_manifest_id
      )
  where collector_version = 'v2';

  initial_cycle_id := public.request_power_outage_cez_market_v2_cycle('manual');
  if initial_cycle_id is null then
    raise exception 'Po aktivaci se nepodařilo založit první produkční cyklus ČEZ MARKETY v2.';
  end if;

  for existing_job in
    select jobid
    from cron.job
    where jobname = 'power_outages_market_cez_v2_every_two_minutes'
      or lower(command) like '%/api/power-outages/cez/v2?limit=8%'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outages_market_cez_v2_every_two_minutes',
    '*/2 * * * *',
    'select public.request_power_outage_cez_market_v2_endpoint();'
  );

  -- Auditní pokračování už po aktivaci nemá produkční roli.
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'power_outage_cez_market_v2_audit_continuation_every_two_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  return jsonb_build_object(
    'status', 'activated',
    'operatingMode', 'dual',
    'primaryVersion', 'v2',
    'secondaryVersion', 'v1',
    'preActivationManifestId', pre_activation_manifest_id,
    'initialCycleId', initial_cycle_id,
    'auditCatalogRevision', audit_revision,
    'activationCatalogRevision', current_revision,
    'auditAddressCount', audit_total
  );
end;
$$;

create or replace function public.rollback_power_outage_cez_market_to_v1(
  requested_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rollback_manifest_id uuid;
  existing_job record;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Návrat ČEZ MARKETY na v1 může provést pouze service role.';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('power_outage_cez_market_dual_activation', 0)) then
    raise exception 'Jiná změna režimu ČEZ MARKETY právě probíhá.';
  end if;

  rollback_manifest_id := public.capture_power_outage_cez_market_preservation_manifest(
    'rollback',
    coalesce(nullif(btrim(requested_note), ''), 'Bezpečný otisk před návratem ČEZ MARKETY na v1.')
  );

  for existing_job in
    select jobid
    from cron.job
    where jobname = 'power_outages_market_cez_v2_every_two_minutes'
      or lower(command) like '%/api/power-outages/cez/v2?limit=8%'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  update public.power_outage_cez_market_cycle_targets target
  set status = 'skipped',
      finished_at = now(),
      lock_token = null,
      lock_expires_at = null,
      error_code = 'CEZ_MARKET_V2_ROLLBACK',
      error_message = 'Cíl byl bezpečně zastaven při návratu produkce na ČEZ v1.'
  where target.collector_version = 'v2'
    and target.status in ('pending', 'running');

  update public.power_outage_cez_market_cycles cycle
  set status = 'cancelled',
      is_complete_snapshot = false,
      started_at = coalesce(started_at, now()),
      finished_at = now(),
      error_code = 'CEZ_MARKET_V2_ROLLBACK',
      error_message = 'Cyklus byl bezpečně zastaven při návratu produkce na ČEZ v1.'
  where cycle.collector_version = 'v2'
    and cycle.status in ('pending', 'running');

  update public.power_outage_cez_market_collector_state
  set previous_version = active_version,
      operating_mode = 'v1_only',
      active_version = 'v1',
      primary_version = 'v1',
      secondary_version = null,
      activation_ready = false,
      switched_at = now(),
      switched_by = auth.uid(),
      switch_note = coalesce(nullif(btrim(requested_note), ''), 'Bezpečný návrat na ČEZ MARKETY v1.')
  where singleton;

  update public.power_outage_cez_market_version_state
  set metadata = metadata || jsonb_build_object('activationState', 'inactive', 'deactivatedAt', now())
  where collector_version = 'v2';

  return jsonb_build_object(
    'status', 'rolled_back',
    'operatingMode', 'v1_only',
    'rollbackManifestId', rollback_manifest_id,
    'preservedV2Data', true
  );
end;
$$;

-- Zachovaný původní přepínač se při návratu na v1 opírá o stejnou úplnou
-- rollback proceduru, takže nemůže ponechat aktivní plánovač nebo otevřený cyklus v2.
create or replace function public.set_power_outage_cez_market_collector_version(
  requested_version text,
  requested_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Změnu verze sběrače může provést pouze service role.';
  end if;
  if requested_version is distinct from 'v1' then
    raise exception 'Původní přepínač podporuje pouze bezpečný návrat na ČEZ MARKETY v1.';
  end if;

  perform public.rollback_power_outage_cez_market_to_v1(requested_note);
  return 'v1';
end;
$$;

revoke all on function public.request_power_outage_cez_market_v2_endpoint()
  from public, anon, authenticated;
revoke all on function public.activate_power_outage_cez_market_dual(text)
  from public, anon, authenticated;
revoke all on function public.rollback_power_outage_cez_market_to_v1(text)
  from public, anon, authenticated;
revoke all on function public.set_power_outage_cez_market_collector_version(text,text)
  from public, anon, authenticated;
grant execute on function public.request_power_outage_cez_market_v2_endpoint() to service_role;
grant execute on function public.activate_power_outage_cez_market_dual(text) to service_role;
grant execute on function public.rollback_power_outage_cez_market_to_v1(text) to service_role;
grant execute on function public.set_power_outage_cez_market_collector_version(text,text) to service_role;

select public.activate_power_outage_cez_market_dual(
  'Řízená produkční aktivace ČEZ MARKETY v1 + v2 dne 6. 9. 2026.'
);

commit;

with latest_manifest as (
  select manifest.*
  from public.power_outage_cez_market_preservation_manifests manifest
  where manifest.manifest_kind = 'pre_activation'
    and manifest.status = 'complete'
  order by manifest.created_at desc
  limit 1
)
select 'CRON' as check_type, 'CEZ MARKET v2 production batch every two minutes' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_market_cez_v2_every_two_minutes'
      and schedule = '*/2 * * * *'
      and active
  ) as is_correct
union all
select 'FUNCTION', 'controlled CEZ MARKET dual activation',
  to_regprocedure('public.activate_power_outage_cez_market_dual(text)') is not null
union all
select 'FUNCTION', 'safe CEZ MARKET rollback to v1',
  to_regprocedure('public.rollback_power_outage_cez_market_to_v1(text)') is not null
union all
select 'GRANT', 'authenticated cannot activate or rollback CEZ MARKET',
  not has_function_privilege('authenticated', 'public.activate_power_outage_cez_market_dual(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.rollback_power_outage_cez_market_to_v1(text)', 'EXECUTE')
union all
select 'ISOLATION', 'CEZ MARKET dual activation does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(
    pg_get_functiondef('public.activate_power_outage_cez_market_dual(text)'::regprocedure)
    || pg_get_functiondef('public.rollback_power_outage_cez_market_to_v1(text)'::regprocedure)
    || pg_get_functiondef('public.request_power_outage_cez_market_v2_endpoint()'::regprocedure)
  )) = 0
union all
select 'SAFETY', 'pre-activation CEZ MARKET manifest is complete',
  exists (select 1 from latest_manifest)
union all
select 'SAFETY', 'pre-activation CEZ outages remain present',
  not exists (
    select 1
    from latest_manifest manifest
    join public.power_outage_cez_market_preservation_items item
      on item.manifest_id = manifest.id and item.entity_kind = 'outage'
    left join public.power_outages outage on outage.id::text = item.entity_key
    where outage.id is null
  )
union all
select 'SAFETY', 'pre-activation CEZ addresses remain present',
  not exists (
    select 1
    from latest_manifest manifest
    join public.power_outage_cez_market_preservation_items item
      on item.manifest_id = manifest.id and item.entity_kind = 'address'
    left join public.power_outage_addresses address on address.id::text = item.entity_key
    where address.id is null
  )
union all
select 'SAFETY', 'pre-activation CEZ store matches remain present',
  not exists (
    select 1
    from latest_manifest manifest
    join public.power_outage_cez_market_preservation_items item
      on item.manifest_id = manifest.id and item.entity_kind = 'store_match'
    left join public.power_outage_store_matches store_match on store_match.id::text = item.entity_key
    where store_match.id is null
  )
union all
select 'SAFETY', 'pre-activation CEZ job links remain present',
  not exists (
    select 1
    from latest_manifest manifest
    join public.power_outage_cez_market_preservation_items item
      on item.manifest_id = manifest.id and item.entity_kind = 'job_link'
    left join public.power_outage_job_links job_link
      on job_link.match_id::text || ':' || job_link.job_id::text = item.entity_key
    where job_link.match_id is null
  )
union all
select 'STATE', 'CEZ MARKET dual mode is active',
  coalesce((
    select state.operating_mode = 'dual'
      and state.active_version = 'v2'
      and state.primary_version = 'v2'
      and state.secondary_version = 'v1'
      and state.activation_ready
    from public.power_outage_cez_market_collector_state state
    where state.singleton
  ), false)
union all
select 'STATE', 'initial CEZ MARKET v2 cycle has current targets',
  exists (
    select 1
    from public.power_outage_cez_market_cycles cycle
    where cycle.collector_version = 'v2'
      and cycle.status in ('pending', 'running')
      and cycle.target_count > 0
      and cycle.catalog_revision = (
        select revision from public.power_outage_store_catalog_state where singleton
      )
  )
union all
select 'STATE', 'CEZ MARKET v1 remains enabled as secondary',
  coalesce((
    select overview.is_enabled and not overview.is_primary
      and overview.cadence_seconds = 86400
    from public.power_outage_cez_market_version_overview overview
    where overview.collector_version = 'v1'
  ), false)
order by check_type, object_name;
