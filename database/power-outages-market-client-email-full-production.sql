begin;

do $$
begin
  if to_regclass('public.power_outage_client_email_deliveries') is null
    or to_regprocedure('public.set_power_outage_client_email_live_pilot(uuid,boolean)') is null
  then
    raise exception 'Nejdříve musí být nasazen a ověřen e-mailový worker a ostrý pilot.';
  end if;
  if to_regclass('public.power_outage_job_links') is null then
    raise exception 'Chybí vazby odstávek na interní zakázky.';
  end if;
end
$$;

-- Páté pravidlo je součástí stejného auditovatelného modelu.
alter table public.power_outage_client_email_rules
  drop constraint if exists power_outage_client_email_rules_event_check;
alter table public.power_outage_client_email_rules
  add constraint power_outage_client_email_rules_event_check
  check (event_kind in (
    'new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h'
  ));

alter table public.power_outage_client_email_deliveries
  drop constraint if exists power_outage_client_email_deliveries_event_check;
alter table public.power_outage_client_email_deliveries
  add constraint power_outage_client_email_deliveries_event_check
  check (event_kind in (
    'new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h'
  ));

update public.power_outage_client_email_rules
set name = case event_kind
    when 'new_outage' then 'Nová plánovaná odstávka'
    when 'schedule_changed' then 'Změna termínu plánované odstávky'
    when 'cancelled' then 'Zrušení plánované odstávky'
    when 'reminder_24h' then 'Připomenutí plánované odstávky'
    else name
  end,
  updated_at = now()
where event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h');

insert into public.power_outage_client_email_rules (
  client_id, name, event_kind, enabled, condition_schema_version,
  conditions, version, activated_at
)
select
  settings.client_id,
  'Bez objednávky – 3 dny předem',
  'missing_job_72h',
  false,
  1,
  jsonb_build_object('hoursBefore', 72, 'requiresMissingJob', true, 'exclusive', true),
  1,
  null
from public.power_outage_client_email_settings as settings
on conflict (client_id, event_kind, name, version) do nothing;

create or replace function public.set_power_outage_client_email_shadow_rule(
  p_client_id uuid,
  p_event_kind text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_settings record;
  selected_rule record;
  enabled_rule_count integer := 0;
  next_runtime text;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Stínová pravidla může měnit pouze administrátor.';
  end if;
  if p_event_kind not in (
    'new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h'
  ) then
    raise exception 'Neplatný typ e-mailového pravidla.';
  end if;

  select settings.* into selected_settings
  from public.power_outage_client_email_settings as settings
  where settings.client_id = p_client_id
  for update;
  if selected_settings.client_id is null then
    raise exception 'Klient není součástí e-mailových upozornění MARKETY.';
  end if;
  if selected_settings.mode <> 'shadow' then
    raise exception 'Pravidla lze měnit pouze v režimu STÍNOVÝ.';
  end if;
  if p_enabled then
    if nullif(trim(coalesce(selected_settings.from_name, '')), '') is null
      or trim(coalesce(selected_settings.from_email, ''))
        !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro stínový režim chybí platný odesílatel.';
    end if;
    if not exists (
      select 1 from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = p_client_id
        and recipient.recipient_kind = 'to' and recipient.is_active
    ) then
      raise exception 'Pro stínový režim chybí aktivní příjemce TO.';
    end if;
    if p_event_kind <> 'missing_job_72h' and exists (
      select 1 from public.power_outage_client_email_rules
      where client_id = p_client_id and event_kind = 'missing_job_72h' and enabled
    ) then
      raise exception 'Pravidlo Bez objednávky – 3 dny předem je výhradní.';
    end if;
  end if;

  select rule.* into selected_rule
  from public.power_outage_client_email_rules as rule
  where rule.client_id = p_client_id and rule.event_kind = p_event_kind
  order by rule.version desc limit 1 for update;
  if selected_rule.id is null then raise exception 'Požadované pravidlo neexistuje.'; end if;

  if p_enabled and p_event_kind = 'missing_job_72h' then
    update public.power_outage_client_email_rules
    set enabled = false, updated_at = now()
    where client_id = p_client_id and event_kind <> 'missing_job_72h' and enabled;
  end if;

  update public.power_outage_client_email_rules
  set enabled = p_enabled,
      activated_at = case when p_enabled and not enabled then now() else activated_at end,
      updated_at = now()
  where id = selected_rule.id;

  update public.power_outage_client_email_settings
  set activated_at = coalesce(activated_at, now()), updated_at = now()
  where client_id = p_client_id;

  select count(*) into enabled_rule_count
  from public.power_outage_client_email_rules where enabled;
  next_runtime := case
    when exists (select 1 from public.power_outage_client_email_settings where mode = 'live') then 'live'
    when enabled_rule_count > 0 then 'shadow'
    else 'disabled'
  end;
  update public.power_outage_client_email_state
  set runtime_mode = next_runtime,
      dispatch_enabled = exists (
        select 1 from public.power_outage_client_email_settings where mode = 'live'
      ),
      last_error_code = null, last_error_message = null, updated_at = now()
  where singleton;

  return jsonb_build_object(
    'ok', true, 'clientId', p_client_id, 'eventKind', p_event_kind,
    'enabled', p_enabled, 'runtimeMode', next_runtime,
    'dispatchEnabled', next_runtime = 'live', 'sendingAttempted', false
  );
end;
$$;

create or replace function public.set_power_outage_client_email_live(
  p_client_id uuid,
  p_enabled boolean,
  p_event_kinds text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_settings record;
  requested_event text;
  base_rule record;
  next_version integer;
  activation_time timestamptz := clock_timestamp();
  another_live_exists boolean;
  next_runtime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Ostrý režim může změnit pouze zabezpečená serverová akce.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_client_email_live', 0)
  );
  select settings.* into selected_settings
  from public.power_outage_client_email_settings as settings
  where settings.client_id = p_client_id for update;
  if selected_settings.client_id is null then
    raise exception 'Klient není součástí e-mailových upozornění MARKETY.';
  end if;

  if p_enabled then
    if selected_settings.mode <> 'shadow' then
      raise exception 'Klient musí být před aktivací v režimu STÍNOVÝ.';
    end if;
    if exists (
      select 1 from public.power_outage_client_email_settings
      where mode = 'test' and client_id <> p_client_id
    ) then
      raise exception 'Nejprve ukončete aktivní TEST jiného klienta.';
    end if;
    if coalesce(cardinality(p_event_kinds), 0) = 0 then
      raise exception 'Vyberte alespoň jedno pravidlo.';
    end if;
    if exists (
      select 1 from unnest(p_event_kinds) as requested(kind)
      where requested.kind not in (
        'new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h'
      )
    ) then
      raise exception 'Výběr obsahuje neplatné pravidlo.';
    end if;
    if cardinality(p_event_kinds) <> (
      select count(distinct requested.kind)
      from unnest(p_event_kinds) as requested(kind)
    ) then
      raise exception 'Každé pravidlo lze vybrat pouze jednou.';
    end if;
    if 'missing_job_72h' = any(p_event_kinds) and cardinality(p_event_kinds) <> 1 then
      raise exception 'Pravidlo Bez objednávky – 3 dny předem musí být aktivní samostatně.';
    end if;
    if nullif(trim(coalesce(selected_settings.from_name, '')), '') is null
      or trim(coalesce(selected_settings.from_email, ''))
        !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro ostrý režim chybí platný odesílatel.';
    end if;
    if not exists (
      select 1 from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = p_client_id
        and recipient.recipient_kind = 'to' and recipient.is_active
    ) then
      raise exception 'Pro ostrý režim chybí aktivní příjemce TO.';
    end if;
    if not exists (
      select 1 from public.power_outage_client_email_deliveries as delivery
      where delivery.client_id = p_client_id
        and delivery.mode_at_plan = 'test'
        and delivery.delivery_status = 'delivered'
        and delivery.delivered_at is not null
        and delivery.provider = 'resend'
        and delivery.provider_message_id is not null
    ) then
      raise exception 'Před ostrým režimem chybí úspěšně doručený TEST stejného klienta.';
    end if;

    update public.power_outage_client_email_rules
    set enabled = false, updated_at = now()
    where client_id = p_client_id and enabled;

    foreach requested_event in array p_event_kinds loop
      select rule.* into base_rule
      from public.power_outage_client_email_rules as rule
      where rule.client_id = p_client_id and rule.event_kind = requested_event
      order by rule.version desc limit 1;
      if base_rule.id is null then
        raise exception 'Pro pravidlo % chybí šablona.', requested_event;
      end if;
      select coalesce(max(version), 0) + 1 into next_version
      from public.power_outage_client_email_rules
      where client_id = p_client_id and event_kind = requested_event;
      insert into public.power_outage_client_email_rules (
        client_id, name, event_kind, enabled, condition_schema_version,
        conditions, version, activated_at
      ) values (
        p_client_id, base_rule.name, requested_event, true,
        base_rule.condition_schema_version, base_rule.conditions,
        next_version, activation_time
      );
    end loop;

    update public.power_outage_client_email_settings
    set mode = 'live', activated_at = activation_time, updated_at = now()
    where client_id = p_client_id;
    update public.power_outage_client_email_state
    set runtime_mode = 'live', dispatch_enabled = true,
        last_error_code = null, last_error_message = null, updated_at = now()
    where singleton;
  else
    update public.power_outage_client_email_deliveries
    set delivery_status = 'cancelled', processing_token = null,
        processing_expires_at = null, next_attempt_at = null,
        last_error_code = 'CLIENT_EMAIL_LIVE_STOPPED',
        last_error_message = 'Zpráva byla zrušena při vypnutí ostrého režimu klienta.',
        updated_at = now()
    where client_id = p_client_id and mode_at_plan = 'live'
      and delivery_status in ('planned', 'queued', 'failed');
    update public.power_outage_client_email_rules
    set enabled = false, updated_at = now()
    where client_id = p_client_id and enabled;
    update public.power_outage_client_email_settings
    set mode = 'shadow', updated_at = now()
    where client_id = p_client_id and mode = 'live';
    select exists (
      select 1 from public.power_outage_client_email_settings
      where mode = 'live' and client_id <> p_client_id
    ) into another_live_exists;
    next_runtime := case when another_live_exists then 'live' else 'shadow' end;
    update public.power_outage_client_email_state
    set runtime_mode = next_runtime, dispatch_enabled = another_live_exists,
        updated_at = now()
    where singleton;
  end if;

  return jsonb_build_object(
    'ok', true, 'clientId', p_client_id, 'enabled', p_enabled,
    'eventKinds', coalesce(to_jsonb(p_event_kinds), '[]'::jsonb),
    'runtimeMode', case when p_enabled then 'live' else next_runtime end,
    'dispatchEnabled', case when p_enabled then true else another_live_exists end,
    'activatedAt', case when p_enabled then activation_time else null end,
    'nonRetroactive', true
  );
end;
$$;

create or replace function public.plan_power_outage_client_email_candidates(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_record record;
  candidate record;
  created_delivery_id uuid;
  recipient_snapshot jsonb;
  store_snapshot jsonb;
  planned_count integer := 0;
  skipped_count integer := 0;
  processed_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Plánování klientských e-mailů je dostupné pouze serverovému workeru.';
  end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'Velikost dávky musí být mezi 1 a 1000.'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_client_email_candidate_planner', 0)
  ) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_running', 'plannedCount', 0);
  end if;
  select runtime_mode, dispatch_enabled into runtime_record
  from public.power_outage_client_email_state where singleton;
  if runtime_record.runtime_mode is null then raise exception 'Globální stav klientských e-mailů není dostupný.'; end if;
  if runtime_record.runtime_mode = 'disabled' then
    return jsonb_build_object('ok', true, 'status', 'disabled', 'plannedCount', 0, 'processedCount', 0, 'skippedCount', 0, 'sendingAttempted', false);
  end if;

  -- Neaktuální časové nebo třídenní položky se nesmí dostat k workeru.
  update public.power_outage_client_email_deliveries as delivery
  set delivery_status = 'cancelled', next_attempt_at = null,
      last_error_code = 'CLIENT_EMAIL_NO_LONGER_ELIGIBLE',
      last_error_message = 'Před odesláním již nebyla splněna podmínka pravidla.',
      updated_at = now()
  where delivery.delivery_status in ('planned', 'queued', 'failed')
    and delivery.mode_at_plan = 'live'
    and (
      (delivery.event_kind in ('new_outage', 'reminder_24h', 'missing_job_72h') and exists (
        select 1 from public.power_outages as outage
        where outage.id = delivery.outage_id
          and (outage.archived_at is not null or outage.source_status in ('completed', 'cancelled') or outage.starts_at <= now())
      ))
      or (delivery.event_kind = 'missing_job_72h' and not exists (
        select 1
        from public.power_outage_store_matches as match
        join public.power_outage_job_client_mappings as mapping
          on mapping.chain_name = upper(trim(match.store_chain_name))
         and mapping.client_id = delivery.client_id
        where match.outage_id = delivery.outage_id and match.match_status = 'confirmed'
          and not exists (select 1 from public.power_outage_job_links as link where link.match_id = match.id)
      ))
    );

  for candidate in
    with new_candidates as (
      select settings.client_id, settings.mode as mode_at_plan, rule.id as rule_id,
        outage.id as outage_id, latest_version.id as outage_version_id,
        'new_outage'::text as event_kind,
        min(coalesce(match.resolved_at, match.first_matched_at)) as event_at,
        outage.source, outage.external_id, outage.title, outage.starts_at, outage.ends_at,
        null::timestamptz as previous_starts_at, null::timestamptz as previous_ends_at,
        outage.municipality, outage.source_url, outage.announcement_url,
        concat('market-client-email:', settings.client_id, ':new_outage:', outage.id) as dedupe_key
      from public.power_outage_client_email_settings settings
      join public.power_outage_client_email_rules rule on rule.client_id=settings.client_id and rule.event_kind='new_outage' and rule.enabled and rule.activated_at is not null
      join public.power_outage_job_client_mappings mapping on mapping.client_id=settings.client_id
      join public.power_outage_store_matches match on upper(trim(match.store_chain_name))=mapping.chain_name and match.match_status='confirmed'
      join public.power_outages outage on outage.id=match.outage_id and outage.archived_at is null and outage.source_status not in ('completed','cancelled') and outage.starts_at > now()
      left join lateral (select id from public.power_outage_versions v where v.outage_id=outage.id order by version_number desc limit 1) latest_version on true
      where settings.mode <> 'disabled'
      group by settings.client_id, settings.mode, rule.id, rule.activated_at, outage.id, latest_version.id
      having outage.created_at >= rule.activated_at
    ), changed_candidates as (
      select settings.client_id, settings.mode as mode_at_plan, rule.id as rule_id,
        outage.id as outage_id, version.id as outage_version_id, rule.event_kind,
        version.created_at as event_at, outage.source, outage.external_id, outage.title,
        coalesce(nullif(version.snapshot->>'starts_at','')::timestamptz, outage.starts_at) as starts_at,
        coalesce(nullif(version.snapshot->>'ends_at','')::timestamptz, outage.ends_at) as ends_at,
        nullif(previous_version.snapshot->>'starts_at','')::timestamptz as previous_starts_at,
        nullif(previous_version.snapshot->>'ends_at','')::timestamptz as previous_ends_at,
        outage.municipality, outage.source_url, outage.announcement_url,
        concat('market-client-email:', settings.client_id, ':', rule.event_kind, ':', outage.id, ':', version.id) as dedupe_key
      from public.power_outage_client_email_settings settings
      join public.power_outage_client_email_rules rule on rule.client_id=settings.client_id and rule.event_kind in ('schedule_changed','cancelled') and rule.enabled and rule.activated_at is not null
      join public.power_outage_job_client_mappings mapping on mapping.client_id=settings.client_id
      join public.power_outage_store_matches match on upper(trim(match.store_chain_name))=mapping.chain_name and match.match_status='confirmed'
      join public.power_outages outage on outage.id=match.outage_id
      join public.power_outage_versions version on version.outage_id=outage.id and version.created_at >= rule.activated_at
      left join public.power_outage_versions previous_version on previous_version.outage_id=version.outage_id and previous_version.version_number=version.version_number-1
      where settings.mode <> 'disabled' and (
        (rule.event_kind='cancelled' and version.change_reasons @> array['cancelled']::text[])
        or (rule.event_kind='schedule_changed' and version.change_reasons @> array['schedule_changed']::text[] and not version.change_reasons @> array['cancelled']::text[])
      )
      group by settings.client_id, settings.mode, rule.id, rule.event_kind, outage.id, version.id, previous_version.snapshot
      having outage.created_at >= rule.activated_at
    ), reminder_candidates as (
      select settings.client_id, settings.mode as mode_at_plan, rule.id as rule_id,
        outage.id as outage_id, latest_version.id as outage_version_id,
        'reminder_24h'::text as event_kind,
        greatest(min(coalesce(match.resolved_at,match.first_matched_at)), outage.starts_at-interval '24 hours') as event_at,
        outage.source, outage.external_id, outage.title, outage.starts_at, outage.ends_at,
        null::timestamptz previous_starts_at, null::timestamptz previous_ends_at,
        outage.municipality, outage.source_url, outage.announcement_url,
        concat('market-client-email:',settings.client_id,':reminder_24h:',outage.id,':',extract(epoch from outage.starts_at)::bigint) dedupe_key
      from public.power_outage_client_email_settings settings
      join public.power_outage_client_email_rules rule on rule.client_id=settings.client_id and rule.event_kind='reminder_24h' and rule.enabled and rule.activated_at is not null
      join public.power_outage_job_client_mappings mapping on mapping.client_id=settings.client_id
      join public.power_outage_store_matches match on upper(trim(match.store_chain_name))=mapping.chain_name and match.match_status='confirmed'
      join public.power_outages outage on outage.id=match.outage_id and outage.archived_at is null and outage.source_status not in ('completed','cancelled') and outage.starts_at > now() and now() >= outage.starts_at-interval '24 hours'
      left join lateral (select id from public.power_outage_versions v where v.outage_id=outage.id order by version_number desc limit 1) latest_version on true
      where settings.mode <> 'disabled'
      group by settings.client_id,settings.mode,rule.id,rule.activated_at,outage.id,latest_version.id
      having outage.created_at >= rule.activated_at
    ), missing_job_candidates as (
      select settings.client_id, settings.mode as mode_at_plan, rule.id as rule_id,
        outage.id as outage_id, latest_version.id as outage_version_id,
        'missing_job_72h'::text as event_kind,
        greatest(min(coalesce(match.resolved_at,match.first_matched_at)), outage.starts_at-interval '72 hours') as event_at,
        outage.source, outage.external_id, outage.title, outage.starts_at, outage.ends_at,
        null::timestamptz previous_starts_at, null::timestamptz previous_ends_at,
        outage.municipality, outage.source_url, outage.announcement_url,
        concat('market-client-email:',settings.client_id,':missing_job_72h:',outage.id,':',extract(epoch from outage.starts_at)::bigint) dedupe_key
      from public.power_outage_client_email_settings settings
      join public.power_outage_client_email_rules rule on rule.client_id=settings.client_id and rule.event_kind='missing_job_72h' and rule.enabled and rule.activated_at is not null
      join public.power_outage_job_client_mappings mapping on mapping.client_id=settings.client_id
      join public.power_outage_store_matches match on upper(trim(match.store_chain_name))=mapping.chain_name and match.match_status='confirmed'
        and not exists (select 1 from public.power_outage_job_links link where link.match_id=match.id)
      join public.power_outages outage on outage.id=match.outage_id and outage.archived_at is null and outage.source_status not in ('completed','cancelled') and outage.starts_at > now() and now() >= outage.starts_at-interval '72 hours'
      left join lateral (select id from public.power_outage_versions v where v.outage_id=outage.id order by version_number desc limit 1) latest_version on true
      where settings.mode <> 'disabled'
      group by settings.client_id,settings.mode,rule.id,rule.activated_at,outage.id,latest_version.id
      having outage.created_at >= rule.activated_at
    ), candidates as (
      select * from new_candidates union all select * from changed_candidates
      union all select * from reminder_candidates union all select * from missing_job_candidates
    )
    select * from candidates c
    where not exists (select 1 from public.power_outage_client_email_deliveries d where d.dedupe_key=c.dedupe_key)
    order by event_at,client_id,outage_id limit p_limit
  loop
    processed_count := processed_count + 1;
    select coalesce(jsonb_agg(jsonb_build_object('kind',recipient_kind,'name',name,'email',email) order by recipient_kind,email),'[]'::jsonb)
      into recipient_snapshot
    from public.power_outage_client_email_recipients
    where client_id=candidate.client_id and is_active;
    if not exists (select 1 from public.power_outage_client_email_recipients where client_id=candidate.client_id and is_active and recipient_kind='to') then
      skipped_count := skipped_count + 1; continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'matchId',match.id,'storeId',match.store_id,'chainName',match.store_chain_name,
      'storeNumber',match.store_number,'city',match.store_city,'address',match.store_address
    ) order by match.store_city,match.store_number),'[]'::jsonb) into store_snapshot
    from public.power_outage_store_matches match
    join public.power_outage_job_client_mappings mapping on mapping.chain_name=upper(trim(match.store_chain_name)) and mapping.client_id=candidate.client_id
    where match.outage_id=candidate.outage_id and match.match_status='confirmed'
      and (candidate.event_kind <> 'missing_job_72h' or not exists (select 1 from public.power_outage_job_links link where link.match_id=match.id));
    if jsonb_array_length(store_snapshot)=0 then skipped_count := skipped_count+1; continue; end if;

    insert into public.power_outage_client_email_deliveries (
      client_id,rule_id,outage_id,outage_version_id,event_kind,mode_at_plan,dedupe_key,
      delivery_status,recipient_snapshot,store_snapshot,subject_snapshot,text_snapshot,metadata
    ) values (
      candidate.client_id,candidate.rule_id,candidate.outage_id,candidate.outage_version_id,candidate.event_kind,candidate.mode_at_plan,candidate.dedupe_key,
      'planned',recipient_snapshot,store_snapshot,
      case candidate.event_kind when 'new_outage' then 'Nová plánovaná odstávka' when 'schedule_changed' then 'Změna termínu plánované odstávky' when 'cancelled' then 'Zrušení plánované odstávky' when 'reminder_24h' then 'Připomenutí plánované odstávky' when 'missing_job_72h' then 'Víte o této plánované odstávce?' end,
      null,
      jsonb_build_object(
        'contract','market-client-email-production-v1','source',candidate.source,'externalId',candidate.external_id,
        'eventAt',candidate.event_at,'startsAt',candidate.starts_at,'endsAt',candidate.ends_at,
        'previousStartsAt',candidate.previous_starts_at,'previousEndsAt',candidate.previous_ends_at,
        'municipality',candidate.municipality,'sourceUrl',candidate.source_url,
        'announcementUrl',candidate.announcement_url,'sendingAttempted',false
      )
    ) on conflict (dedupe_key) do nothing returning id into created_delivery_id;
    if created_delivery_id is null then continue; end if;
    insert into public.power_outage_client_email_delivery_matches (
      delivery_id,match_id,store_id,store_chain_name,store_number,store_city,store_address
    ) select created_delivery_id,match.id,match.store_id,match.store_chain_name,match.store_number,match.store_city,match.store_address
    from public.power_outage_store_matches match
    join public.power_outage_job_client_mappings mapping on mapping.chain_name=upper(trim(match.store_chain_name)) and mapping.client_id=candidate.client_id
    where match.outage_id=candidate.outage_id and match.match_status='confirmed'
      and (candidate.event_kind <> 'missing_job_72h' or not exists (select 1 from public.power_outage_job_links link where link.match_id=match.id))
    on conflict (delivery_id,match_id) where match_id is not null do nothing;
    planned_count := planned_count+1; created_delivery_id := null;
  end loop;

  update public.power_outage_client_email_state
  set last_planned_at=now(),last_error_code=null,last_error_message=null,updated_at=now()
  where singleton;
  return jsonb_build_object('ok',true,'status',runtime_record.runtime_mode,'processedCount',processed_count,'plannedCount',planned_count,'skippedCount',skipped_count,'sendingAttempted',false);
exception when others then
  update public.power_outage_client_email_state set last_error_code='CLIENT_EMAIL_CANDIDATE_PLAN_FAILED',last_error_message=sqlerrm,updated_at=now() where singleton;
  return jsonb_build_object('ok',false,'status',coalesce(runtime_record.runtime_mode,'disabled'),'errorCode','CLIENT_EMAIL_CANDIDATE_PLAN_FAILED','errorMessage',sqlerrm,'plannedCount',0,'sendingAttempted',false);
end;
$$;

-- Starý jednoprvkový pilot již nesmí omylem aktivovat zastaralou logiku.
create or replace function public.set_power_outage_client_email_live_pilot(
  p_client_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Ostrý režim může změnit pouze zabezpečená serverová akce.';
  end if;
  if p_enabled then
    raise exception 'Jednoklientský pilot byl nahrazen plným produkčním režimem. Aktualizujte aplikaci.';
  end if;
  return public.set_power_outage_client_email_live(p_client_id, false, '{}'::text[]);
end;
$$;

-- Bounce/complaint zastaví pouze dotčeného klienta; ostatní ostré klienty nechá běžet.
create or replace function public.stop_power_outage_client_email_live_pilot_on_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  another_live_exists boolean;
begin
  if new.mode_at_plan <> 'live' or new.delivery_status not in ('bounced','complained')
    or old.delivery_status = new.delivery_status
    or not exists (select 1 from public.power_outage_client_email_settings where client_id=new.client_id and mode='live')
  then return new; end if;
  update public.power_outage_client_email_deliveries
  set delivery_status='cancelled',processing_token=null,processing_expires_at=null,next_attempt_at=null,
      last_error_code='CLIENT_EMAIL_LIVE_CIRCUIT_BREAKER',
      last_error_message='Položka byla zrušena po odmítnutí jiné ostré zprávy stejného klienta.',updated_at=now()
  where client_id=new.client_id and mode_at_plan='live' and id<>new.id and delivery_status in ('planned','queued','failed');
  update public.power_outage_client_email_rules set enabled=false,updated_at=now() where client_id=new.client_id and enabled;
  update public.power_outage_client_email_settings set mode='shadow',updated_at=now() where client_id=new.client_id and mode='live';
  select exists(select 1 from public.power_outage_client_email_settings where mode='live') into another_live_exists;
  update public.power_outage_client_email_state
  set runtime_mode=case when another_live_exists then 'live' else 'shadow' end,
      dispatch_enabled=another_live_exists,
      last_error_code=case when new.delivery_status='complained' then 'CLIENT_EMAIL_LIVE_COMPLAINT' else 'CLIENT_EMAIL_LIVE_BOUNCE' end,
      last_error_message='Ostré odesílání klienta bylo automaticky zastaveno po odmítnutí zprávy příjemcem.',updated_at=now()
  where singleton;
  return new;
end;
$$;

revoke all on function public.set_power_outage_client_email_live(uuid,boolean,text[]) from public,anon,authenticated;
grant execute on function public.set_power_outage_client_email_live(uuid,boolean,text[]) to service_role;
revoke all on function public.set_power_outage_client_email_live_pilot(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_power_outage_client_email_live_pilot(uuid,boolean) to service_role;
revoke all on function public.plan_power_outage_client_email_candidates(integer) from public,anon,authenticated;
grant execute on function public.plan_power_outage_client_email_candidates(integer) to service_role;
revoke all on function public.stop_power_outage_client_email_live_pilot_on_rejection() from public,anon,authenticated;
grant execute on function public.stop_power_outage_client_email_live_pilot_on_rejection() to service_role;

notify pgrst, 'reload schema';
commit;

select 'COLUMN' as check_type, 'five production email event kinds' as object_name,
  pg_get_constraintdef(oid) like '%missing_job_72h%' as is_correct
from pg_constraint where conname='power_outage_client_email_deliveries_event_check'
union all
select 'DATA','five rule templates per MARKET client',not exists(
  select 1 from public.power_outage_client_email_settings s where (
    select count(distinct event_kind) from public.power_outage_client_email_rules r
    where r.client_id=s.client_id and r.event_kind in ('new_outage','schedule_changed','cancelled','reminder_24h','missing_job_72h')
  )<>5
)
union all
select 'FUNCTION','full production activation',to_regprocedure('public.set_power_outage_client_email_live(uuid,boolean,text[])') is not null
union all
select 'FUNCTION','non-retroactive five-rule planner',
  pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) like '%rule.activated_at%'
  and pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) like '%missing_job_72h%'
  and pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) like '%reminder_24h%'
union all
select 'LOGIC','missing order uses green-check job links',
  pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) like '%power_outage_job_links%'
union all
select 'LOGIC','missing order rule is exclusive',
  pg_get_functiondef('public.set_power_outage_client_email_live(uuid,boolean,text[])'::regprocedure) like '%cardinality(p_event_kinds) <> 1%'
union all
select 'SAFETY','migration did not activate live sending',not exists(
  select 1 from public.power_outage_client_email_settings where mode='live'
)
union all
select 'SAFETY','old events are excluded by activation timestamp',
  pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) like '%outage.created_at >= rule.activated_at%'
union all
select 'GRANT','authenticated cannot activate production',
  not has_function_privilege('authenticated','public.set_power_outage_client_email_live(uuid,boolean,text[])','execute')
union all
select 'ISOLATION','production email planner stays in MARKET scope',
  pg_get_functiondef('public.plan_power_outage_client_email_candidates(integer)'::regprocedure) not ilike '%complete_power_outage%'
order by check_type,object_name;
