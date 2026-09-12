begin;

-- Krok 10.9: rucne aktivovany, maximalne triclenny LIVE pilot KOMPLETNI.
-- Instalace sama nic neaktivuje ani neodesila. Aktivace vyzaduje admina,
-- presnou potvrzovaci frazi a cerstvy bezpecnostni preflight.
do $$
declare missing_dependencies text[] := array[]::text[];
begin
  if to_regprocedure('public.audit_cpo_notification_email_live_readiness_v1()') is null then
    missing_dependencies := array_append(missing_dependencies, 'LIVE security preflight');
  end if;
  if to_regprocedure('public.reserve_cpo_notification_email_pilot_slot_v1(uuid)') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot rate limiter');
  end if;
  if to_regprocedure('public.record_cpo_notification_email_pilot_safety_event_v1(text,text,text,uuid,text,text,text,jsonb)') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot safety recorder');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_allowlist_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'pilot allowlist');
  end if;
  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro LIVE pilot KOMPLETNI: %.', array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

alter table public.complete_power_outage_notification_email_pilot_allowlist_state
  drop constraint if exists cpo_pilot_allowlist_live_safety_check;
alter table public.complete_power_outage_notification_email_pilot_rate_limit_state
  drop constraint if exists cpo_pilot_rate_activation_check;
alter table public.complete_power_outage_notification_email_pilot_safety_state
  drop constraint if exists cpo_pilot_safety_ingestion_check;

create table if not exists public.complete_power_outage_notification_email_pilot_activation_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('activated', 'paused', 'completed')),
  selected_company_count integer not null check (selected_company_count between 0 and 3),
  decided_by uuid references public.profiles(id) on delete set null,
  reason text not null check (btrim(reason) <> ''),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create or replace function public.prevent_cpo_notification_email_pilot_activation_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Historie aktivace pilotu je nemenna.';
end;
$$;

drop trigger if exists cpo_notification_email_pilot_activation_immutable
  on public.complete_power_outage_notification_email_pilot_activation_events;
create trigger cpo_notification_email_pilot_activation_immutable
before update or delete on public.complete_power_outage_notification_email_pilot_activation_events
for each row execute function public.prevent_cpo_notification_email_pilot_activation_mutation();

alter table public.complete_power_outage_notification_email_pilot_activation_events enable row level security;
revoke all on table public.complete_power_outage_notification_email_pilot_activation_events from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_pilot_activation_events to service_role;

create or replace function public.activate_cpo_notification_email_live_pilot_v1(requested_confirmation text)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare
  selected_count integer;
  failed_checks integer;
  safety_state public.complete_power_outage_notification_email_pilot_safety_state%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'LIVE pilot muze aktivovat pouze administrator.'; end if;
  if btrim(coalesce(requested_confirmation, '')) <> 'AKTIVOVAT PILOT KOMPLETNÍ' then
    raise exception 'Aktivace vyzaduje presnou potvrzovaci frazi.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_live_pilot_v1', 0));
  select count(*) into failed_checks
  from public.audit_cpo_notification_email_live_readiness_v1() audit
  where not audit.is_correct
    -- Krok 8 spravne vyzadoval, aby pred instalaci neexistoval LIVE cron.
    -- V kroku 9 uz je tento jediny preaktivacni bod nahrazen kontrolou
    -- konkretniho omezeneho workeru nize.
    and audit.object_name <> 'no automatic COMPLETE LIVE dispatch schedule exists';
  if failed_checks > 0 then raise exception 'LIVE bezpecnostni preflight obsahuje % neuspesnych kontrol.', failed_checks; end if;
  if not exists (
    select 1 from cron.job job
    where job.jobname = 'complete_notification_email_live_pilot_every_minute'
      and job.schedule = '* * * * *'
      and job.command like '%request_cpo_notification_email_live_pilot_v1%'
  ) then
    raise exception 'Omezeny LIVE worker KOMPLETNI neni spravne naplanovan.';
  end if;

  select count(distinct entry.ico)::integer into selected_count
  from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
  where entry.active_and_eligible_now;
  if selected_count < 1 or selected_count > 3 then
    raise exception 'Pilot musi obsahovat 1 az 3 aktualni rucne schvalene firmy; nyni obsahuje %.', selected_count;
  end if;
  select * into safety_state from public.complete_power_outage_notification_email_pilot_safety_state where singleton for update;
  if safety_state.is_paused then raise exception 'Bezpecnostni incident musi byt pred aktivaci zkontrolovan.'; end if;

  update public.complete_power_outage_notification_email_state
  set runtime_mode = 'live', planning_enabled = true, dispatch_enabled = true,
      consecutive_failure_count = 0, last_error_code = null, last_error_message = null,
      metadata = metadata || jsonb_build_object('liveDispatchEnabled', true, 'liveActivatedAt', now(), 'liveActivatedBy', auth.uid()),
      updated_at = now() where singleton;
  update public.complete_power_outage_notification_email_pilot_allowlist_state
  set live_dispatch_enabled = true, metadata = metadata || jsonb_build_object('liveActivatedAt', now()), updated_at = now()
  where singleton;
  update public.complete_power_outage_notification_email_pilot_rate_limit_state
  set reservation_enabled = true, metadata = metadata || jsonb_build_object('liveActivatedAt', now()), updated_at = now()
  where singleton;
  update public.complete_power_outage_notification_email_pilot_safety_state
  set live_signal_ingestion_enabled = true, consecutive_transient_failure_count = 0,
      first_transient_failure_at = null, metadata = metadata || jsonb_build_object('liveActivatedAt', now()), updated_at = now()
  where singleton;

  insert into public.complete_power_outage_notification_email_pilot_activation_events
    (action, selected_company_count, decided_by, reason, metadata)
  values ('activated', selected_count, auth.uid(), 'Rucne potvrzen prvni omezeny LIVE pilot.',
    jsonb_build_object('contract', 'complete-notification-email-live-pilot-v1', 'dailyLimit', 3, 'minimumIntervalSeconds', 600));
  return jsonb_build_object('status', 'activated', 'selectedCompanyCount', selected_count, 'automaticSendingStarted', true);
end;
$$;

-- Samostatny HTTP requester zachovava oddeleni od whitelistu a automatiky MARKETY.
create or replace function public.request_cpo_notification_email_live_pilot_v1()
returns bigint language plpgsql security definer set search_path = '' as $$
declare app_url text; automation_token text; request_id bigint;
begin
  if not coalesce((
    select state_row.runtime_mode = 'live' and state_row.dispatch_enabled
    from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
  ), false) then return null; end if;

  select trim(trailing '/' from decrypted_secret) into app_url
  from vault.decrypted_secrets where name = 'weather_alerts_app_url'
  order by created_at desc limit 1;
  select decrypted_secret into automation_token
  from vault.decrypted_secrets where name = 'weather_alerts_automation_token'
  order by created_at desc limit 1;
  if app_url is null or app_url !~ '^https://[^/]+$' then
    raise exception 'Vault secret weather_alerts_app_url neni platny.';
  end if;
  if automation_token is null or length(automation_token) < 32 then
    raise exception 'Vault secret weather_alerts_automation_token chybi.';
  end if;

  select net.http_get(
    url := app_url || '/api/power-outages/complete/notification-emails/pilot/send',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || automation_token,
      'Accept', 'application/json',
      'User-Agent', 'B-Energy-Complete-Notification-Live-Pilot/1.0'
    ),
    timeout_milliseconds := 60000
  ) into request_id;
  return request_id;
end;
$$;

create or replace function public.pause_cpo_notification_email_live_pilot_v1(requested_reason text)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare selected_count integer; normalized_reason text := nullif(btrim(coalesce(requested_reason, '')), '');
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'LIVE pilot muze pozastavit pouze administrator.'; end if;
  if normalized_reason is null then raise exception 'Pro pozastaveni je vyzadovan duvod.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_live_pilot_v1', 0));
  select count(distinct ico)::integer into selected_count from public.complete_power_outage_notification_email_pilot_allowlist_v1 where active_and_eligible_now;
  update public.complete_power_outage_notification_email_state
  set runtime_mode = 'shadow', planning_enabled = true, dispatch_enabled = false,
      metadata = metadata || jsonb_build_object('liveDispatchEnabled', false, 'manuallyPausedAt', now()), updated_at = now() where singleton;
  update public.complete_power_outage_notification_email_pilot_allowlist_state set live_dispatch_enabled = false, updated_at = now() where singleton;
  update public.complete_power_outage_notification_email_pilot_rate_limit_state set reservation_enabled = false, updated_at = now() where singleton;
  -- Webhook prijimame i po rucnim zastaveni: bounce nebo complaint muze prijit
  -- az se zpozdenim. Tato volba sama neumoznuje zadne dalsi odeslani.
  update public.complete_power_outage_notification_email_pilot_safety_state
  set live_signal_ingestion_enabled = true,
      metadata = metadata || jsonb_build_object('dispatchManuallyPausedAt', now()),
      updated_at = now()
  where singleton;
  insert into public.complete_power_outage_notification_email_pilot_activation_events
    (action, selected_company_count, decided_by, reason, metadata)
  values ('paused', coalesce(selected_count, 0), auth.uid(), normalized_reason,
    jsonb_build_object('contract', 'complete-notification-email-live-pilot-v1'));
  return jsonb_build_object('status', 'paused', 'dispatchEnabled', false);
end;
$$;

create or replace function public.claim_cpo_notification_email_live_pilot_v1()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare
  email_state public.complete_power_outage_notification_email_state%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  selected_outage public.complete_power_outages%rowtype;
  reservation jsonb;
  selected_count integer;
begin
  select * into email_state from public.complete_power_outage_notification_email_state where singleton;
  if email_state.runtime_mode <> 'live' or not email_state.dispatch_enabled then
    return jsonb_build_object('status', 'disabled', 'sendingAttempted', false);
  end if;
  if exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_state where singleton and is_paused) then
    return jsonb_build_object('status', 'paused', 'sendingAttempted', false);
  end if;

  select plan.* into selected_plan
  from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
  join public.complete_power_outage_notification_email_plans plan on plan.id = entry.plan_id
  where entry.active_and_eligible_now
    and not exists (
      select 1 from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      where outcome.plan_id = plan.id and outcome.outcome = 'sent'
    )
  order by plan.starts_at_snapshot, plan.id
  limit 1;

  if selected_plan.id is null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_live_pilot_v1', 0));
    select count(distinct ico)::integer into selected_count from public.complete_power_outage_notification_email_pilot_allowlist_v1 where active_and_eligible_now;
    update public.complete_power_outage_notification_email_state set runtime_mode = 'shadow', planning_enabled = true, dispatch_enabled = false,
      metadata = metadata || jsonb_build_object('liveDispatchEnabled', false, 'pilotCompletedAt', now()), updated_at = now() where singleton;
    update public.complete_power_outage_notification_email_pilot_allowlist_state set live_dispatch_enabled = false, updated_at = now() where singleton;
    update public.complete_power_outage_notification_email_pilot_rate_limit_state set reservation_enabled = false, updated_at = now() where singleton;
    -- Po prijeti posledni zpravy zustava webhook aktivni kvuli pozdnim
    -- delivery, bounce a complaint udalostem. Odesilaci cast je vypnuta vyse.
    update public.complete_power_outage_notification_email_pilot_safety_state
    set live_signal_ingestion_enabled = true,
        metadata = metadata || jsonb_build_object('pilotDispatchCompletedAt', now()),
        updated_at = now()
    where singleton;
    if not exists (
      select 1 from public.complete_power_outage_notification_email_pilot_activation_events event
      where event.action = 'completed' and event.created_at >= (
        select max(started.created_at) from public.complete_power_outage_notification_email_pilot_activation_events started where started.action = 'activated'
      )
    ) then
      insert into public.complete_power_outage_notification_email_pilot_activation_events
        (action, selected_company_count, reason, metadata)
      values ('completed', coalesce(selected_count, 0), 'Vsechny polozky prvniho pilotu byly prijaty poskytovatelem.',
        jsonb_build_object('contract', 'complete-notification-email-live-pilot-v1'));
    end if;
    return jsonb_build_object('status', 'completed', 'sendingAttempted', false);
  end if;

  reservation := public.reserve_cpo_notification_email_pilot_slot_v1(selected_plan.id);
  if coalesce((reservation ->> 'reserved')::boolean, false) is not true then
    return reservation || jsonb_build_object('planId', selected_plan.id);
  end if;
  select * into selected_outage from public.complete_power_outages where id = selected_plan.outage_id;
  if selected_outage.id is null then raise exception 'Pilotni plan nema platnou odstavku.'; end if;

  return jsonb_build_object(
    'status', 'claimed', 'slotId', reservation ->> 'slotId', 'claimToken', reservation ->> 'claimToken',
    'delivery', jsonb_build_object(
      'planId', selected_plan.id, 'recipient', selected_plan.recipient_email,
      'companyName', selected_plan.company_name_snapshot, 'startsAt', selected_plan.starts_at_snapshot,
      'endsAt', selected_plan.ends_at_snapshot, 'addresses', selected_plan.address_snapshot,
      'source', selected_plan.source_snapshot, 'municipality', selected_plan.municipality_snapshot,
      'announcementUrl', selected_outage.announcement_url, 'sourceUrl', selected_outage.source_url,
      'unsubscribeToken', selected_plan.unsubscribe_token
    )
  );
end;
$$;

create or replace function public.record_cpo_notification_email_live_resend_event_v1(
  requested_provider_event_id text, requested_provider_message_id text,
  requested_event_kind text, requested_payload jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' as $$
declare selected_plan_id uuid; signal_type text;
begin
  select outcome.plan_id into selected_plan_id
  from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
  where outcome.outcome = 'sent' and outcome.provider_message_id = nullif(btrim(requested_provider_message_id), '');
  if selected_plan_id is null then return jsonb_build_object('status', 'ignored', 'recorded', false); end if;
  signal_type := case requested_event_kind
    when 'email.delivered' then 'delivery_success'
    when 'email.bounced' then 'hard_bounce'
    when 'email.complained' then 'complaint'
    when 'email.failed' then 'transient_error'
    when 'email.delivery_delayed' then 'transient_error'
    when 'email.suppressed' then 'hard_bounce'
    else null end;
  if signal_type is null then return jsonb_build_object('status', 'ignored', 'recorded', false); end if;
  return public.record_cpo_notification_email_pilot_safety_event_v1(
    'complete_resend_webhook', requested_provider_event_id, signal_type, selected_plan_id,
    requested_provider_message_id,
    case when signal_type = 'transient_error' then upper(replace(requested_event_kind, '.', '_')) else null end,
    case when signal_type = 'transient_error' then 'Resend oznamil prechodny problem LIVE pilotu KOMPLETNI.' else null end,
    coalesce(requested_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.prevent_cpo_notification_email_pilot_activation_mutation() from public, anon, authenticated;
revoke all on function public.activate_cpo_notification_email_live_pilot_v1(text) from public, anon;
revoke all on function public.pause_cpo_notification_email_live_pilot_v1(text) from public, anon;
revoke all on function public.claim_cpo_notification_email_live_pilot_v1() from public, anon, authenticated;
revoke all on function public.record_cpo_notification_email_live_resend_event_v1(text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.request_cpo_notification_email_live_pilot_v1() from public, anon, authenticated;
grant execute on function public.prevent_cpo_notification_email_pilot_activation_mutation() to service_role;
grant execute on function public.activate_cpo_notification_email_live_pilot_v1(text) to authenticated, service_role;
grant execute on function public.pause_cpo_notification_email_live_pilot_v1(text) to authenticated, service_role;
grant execute on function public.claim_cpo_notification_email_live_pilot_v1() to service_role;
grant execute on function public.record_cpo_notification_email_live_resend_event_v1(text,text,text,jsonb) to service_role;
grant execute on function public.request_cpo_notification_email_live_pilot_v1() to service_role;

-- Panel zobrazi moznost rucni aktivace, ale instalace zachova SHADOW stav.
create or replace function public.get_cpo_notification_email_management_v1(requested_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '20s' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Panel EMAILY je dostupny pouze administratorum.'; end if;
  if requested_limit < 1 or requested_limit > 100 then raise exception 'Limit prehledu musi byt mezi 1 a 100.'; end if;
  return jsonb_build_object(
    'contract', 'complete-notification-email-management-ui-v1', 'adminOnly', true,
    'liveActivationAvailable', true,
    'review', public.get_cpo_notification_email_pilot_review_v1(requested_limit),
    'allowlist', public.get_cpo_notification_email_pilot_allowlist_v1(requested_limit),
    'rateLimit', public.get_cpo_notification_email_pilot_rate_summary_v1(),
    'safety', public.get_cpo_notification_email_pilot_safety_summary_v1()
  );
end;
$$;
revoke all on function public.get_cpo_notification_email_management_v1(integer) from public, anon;
grant execute on function public.get_cpo_notification_email_management_v1(integer) to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
  'livePilotContract', 'complete-notification-email-live-pilot-v1',
  'liveActivationAvailable', true, 'liveDispatchEnabled', false, 'livePilotInstalledAt', now()
), updated_at = now() where singleton;

do $$ declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'complete_notification_email_live_pilot_every_minute'
  loop perform cron.unschedule(existing_job.jobid); end loop;
  perform cron.schedule(
    'complete_notification_email_live_pilot_every_minute', '* * * * *',
    $job$select public.request_cpo_notification_email_live_pilot_v1();$job$
  );
end $$;

notify pgrst, 'reload schema';
commit;
