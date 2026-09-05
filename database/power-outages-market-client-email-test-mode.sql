begin;

do $$
begin
  if to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is null then
    raise exception 'Nejdříve musí být nasazen plánovač klientských e-mailů.';
  end if;
  if to_regprocedure('public.claim_power_outage_client_email_delivery_batch(integer)') is null then
    raise exception 'Nejdříve musí být nasazen e-mailový worker.';
  end if;
  if to_regprocedure('public.power_outage_client_email_html_escape(text)') is null then
    raise exception 'Nejdříve musí být nasazen stínový renderer e-mailů.';
  end if;
end
$$;

-- TEST může odemknout pouze server po ověření přihlášeného administrátora
-- a všech proměnných Resendu. Přímé volání z prohlížeče není povoleno.
create or replace function public.set_power_outage_client_email_test_mode(
  p_client_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_settings record;
  latest_rule record;
  next_version integer;
  next_runtime text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Testovací režim může změnit pouze zabezpečená serverová akce.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_client_email_test_mode', 0)
  );

  select settings.*
  into selected_settings
  from public.power_outage_client_email_settings as settings
  where settings.client_id = p_client_id
  for update;

  if selected_settings.client_id is null then
    raise exception 'Klient není součástí e-mailových upozornění MARKETY.';
  end if;

  if p_enabled then
    if exists (
      select 1
      from public.power_outage_client_email_state
      where singleton and runtime_mode = 'live'
    ) then
      raise exception 'Test nelze spustit během ostrého odesílání.';
    end if;
    if exists (
      select 1
      from public.power_outage_client_email_settings
      where mode = 'test' and client_id <> p_client_id
    ) then
      raise exception 'Současně může být v TEST režimu pouze jeden klient.';
    end if;
    if selected_settings.mode not in ('shadow', 'test') then
      raise exception 'Nejprve klienta nakonfigurujte a uložte v režimu STÍNOVÝ.';
    end if;
    if nullif(trim(coalesce(selected_settings.from_name, '')), '') is null
      or trim(coalesce(selected_settings.from_email, ''))
        !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro TEST chybí platný odesílatel.';
    end if;
    if not exists (
      select 1
      from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = p_client_id
        and recipient.recipient_kind = 'to'
        and recipient.is_active
    ) then
      raise exception 'Pro TEST chybí aktivní původní příjemce TO.';
    end if;

    if selected_settings.mode <> 'test' then
      select rule.*
      into latest_rule
      from public.power_outage_client_email_rules as rule
      where rule.client_id = p_client_id
        and rule.event_kind = 'new_outage'
      order by rule.version desc
      limit 1
      for update;

      if latest_rule.id is null then
        raise exception 'Chybí pravidlo pro novou potvrzenou odstávku.';
      end if;

      select coalesce(max(rule.version), 0) + 1
      into next_version
      from public.power_outage_client_email_rules as rule
      where rule.client_id = p_client_id
        and rule.event_kind = 'new_outage'
        and rule.name = latest_rule.name;

      update public.power_outage_client_email_rules
      set enabled = false,
          updated_at = now()
      where client_id = p_client_id
        and enabled;

      insert into public.power_outage_client_email_rules (
        client_id, name, event_kind, enabled, condition_schema_version,
        conditions, version, activated_at, created_by
      ) values (
        p_client_id, latest_rule.name, 'new_outage', true,
        latest_rule.condition_schema_version, latest_rule.conditions,
        next_version, now(), null
      );

      update public.power_outage_client_email_deliveries
      set delivery_status = 'cancelled',
          processing_token = null,
          processing_expires_at = null,
          next_attempt_at = null,
          last_error_code = 'CLIENT_EMAIL_TEST_SESSION_REPLACED',
          last_error_message = 'Neodeslaná položka patřila k předchozímu testovacímu sezení.',
          updated_at = now()
      where client_id = p_client_id
        and mode_at_plan = 'test'
        and delivery_status in ('planned', 'queued', 'failed');

      update public.power_outage_client_email_settings
      set mode = 'test',
          activated_at = now(),
          updated_at = now()
      where client_id = p_client_id;
    end if;

    update public.power_outage_client_email_state
    set runtime_mode = 'test',
        dispatch_enabled = true,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where singleton;

    return jsonb_build_object(
      'ok', true,
      'clientId', p_client_id,
      'mode', 'test',
      'dispatchEnabled', true,
      'nonRetroactive', true
    );
  end if;

  if selected_settings.mode <> 'test' then
    raise exception 'Vybraný klient není v TEST režimu.';
  end if;
  if exists (
    select 1
    from public.power_outage_client_email_deliveries
    where client_id = p_client_id
      and mode_at_plan = 'test'
      and delivery_status = 'sending'
  ) then
    raise exception 'Právě probíhá odeslání. Ukončení TESTU opakujte za chvíli.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'cancelled',
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      last_error_code = 'CLIENT_EMAIL_TEST_SESSION_ENDED',
      last_error_message = 'Neodeslaná testovací položka byla zrušena při ukončení TESTU.',
      updated_at = now()
  where client_id = p_client_id
    and mode_at_plan = 'test'
    and delivery_status in ('planned', 'queued', 'failed');

  update public.power_outage_client_email_settings
  set mode = 'shadow',
      updated_at = now()
  where client_id = p_client_id;

  select case
    when exists (
      select 1 from public.power_outage_client_email_rules where enabled
    ) then 'shadow'
    else 'disabled'
  end
  into next_runtime;

  update public.power_outage_client_email_state
  set runtime_mode = next_runtime,
      dispatch_enabled = false,
      worker_token = null,
      worker_expires_at = null,
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'ok', true,
    'clientId', p_client_id,
    'mode', 'shadow',
    'runtimeMode', next_runtime,
    'dispatchEnabled', false
  );
end;
$$;

create or replace function public.render_power_outage_client_email_test_deliveries(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rendered_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Testovací e-maily může připravit pouze serverový worker.';
  end if;
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Velikost dávky musí být mezi 1 a 1000.';
  end if;

  with targets as (
    select delivery.id
    from public.power_outage_client_email_deliveries as delivery
    where delivery.delivery_status = 'planned'
      and delivery.mode_at_plan = 'test'
      and delivery.html_snapshot is null
    order by delivery.created_at, delivery.id
    limit p_limit
    for update skip locked
  ),
  prepared as (
    select
      delivery.id,
      settings.client_name_snapshot,
      settings.chain_name,
      settings.from_name,
      settings.from_email,
      settings.reply_to_email,
      outage.source,
      outage.external_id,
      coalesce(nullif(trim(outage.title), ''), 'Plánovaná odstávka elektřiny') as outage_title,
      outage.starts_at,
      outage.ends_at,
      outage.municipality,
      outage.source_url,
      outage.announcement_url,
      delivery.event_kind,
      delivery.recipient_snapshot,
      delivery.store_snapshot,
      case delivery.event_kind
        when 'new_outage' then 'Nová potvrzená odstávka'
        when 'schedule_changed' then 'Změna termínu odstávky'
        when 'cancelled' then 'Zrušení plánované odstávky'
        else 'Informace o plánované odstávce'
      end as event_label,
      coalesce(jsonb_array_length(delivery.store_snapshot), 0) as store_count,
      coalesce((
        select string_agg(recipient.item ->> 'email', ', ' order by recipient.ordinality)
        from jsonb_array_elements(delivery.recipient_snapshot)
          with ordinality as recipient(item, ordinality)
      ), 'bez příjemce') as original_recipients
    from targets
    join public.power_outage_client_email_deliveries as delivery on delivery.id = targets.id
    join public.power_outage_client_email_settings as settings on settings.client_id = delivery.client_id
    join public.power_outages as outage on outage.id = delivery.outage_id
    where settings.mode = 'test'
  ),
  rendered as (
    update public.power_outage_client_email_deliveries as delivery
    set subject_snapshot = format(
          '%s: %s · %s (%s)',
          prepared.client_name_snapshot,
          prepared.event_label,
          coalesce(prepared.municipality, 'bez určení obce'),
          upper(prepared.source)
        ),
        text_snapshot = concat_ws(E'\n',
          'TESTOVACÍ REŽIM – klient nic neobdrží',
          'Původní příjemci: ' || prepared.original_recipients,
          '',
          prepared.event_label,
          'Klient: ' || prepared.client_name_snapshot,
          'Zdroj: ' || upper(prepared.source),
          'Odstávka: ' || prepared.outage_title,
          'Termín: ' || to_char(prepared.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY HH24:MI')
            || '–' || to_char(prepared.ends_at at time zone 'Europe/Prague', 'DD. MM. YYYY HH24:MI'),
          'Obec: ' || coalesce(prepared.municipality, 'neuvedena'),
          'Dotčené prodejny: ' || prepared.store_count::text,
          coalesce((
            select string_agg(
              '• ' || coalesce(store.item ->> 'chainName', prepared.chain_name)
                || ' ' || coalesce(store.item ->> 'storeNumber', '')
                || ' · ' || coalesce(store.item ->> 'address', '')
                || ', ' || coalesce(store.item ->> 'city', ''),
              E'\n' order by store.ordinality
            )
            from jsonb_array_elements(prepared.store_snapshot)
              with ordinality as store(item, ordinality)
          ), '• bez detailu prodejny'),
          case when prepared.announcement_url ~* '^https://[^[:space:]]+$'
            then 'PDF oznámení: ' || prepared.announcement_url end,
          case when prepared.source_url ~* '^https://[^[:space:]]+$'
            then 'Zdroj: ' || prepared.source_url end,
          '',
          'Toto je testovací automatické upozornění na odstávku elektřiny.'
        ),
        html_snapshot = format(
          '<!doctype html><html lang="cs"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="margin-bottom:14px;border:1px solid #a78bfa;border-radius:14px;background:#f5f3ff;padding:14px;color:#5b21b6"><strong>TESTOVACÍ REŽIM</strong><br><span style="font-size:13px">Klient nic neobdrží. Původní příjemci: %s</span></div><div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#64748b;text-transform:uppercase">%s · %s</div><h1 style="margin:10px 0 20px;font-size:24px;line-height:1.25">%s</h1><table role="presentation" style="width:100%%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Termín</td><td style="padding:8px 0;text-align:right;font-weight:700">%s–%s</td></tr><tr><td style="padding:8px 0;color:#64748b">Obec</td><td style="padding:8px 0;text-align:right;font-weight:700">%s</td></tr><tr><td style="padding:8px 0;color:#64748b">Dotčené prodejny</td><td style="padding:8px 0;text-align:right;font-weight:700">%s</td></tr></table><h2 style="margin:24px 0 10px;font-size:17px">Prodejny</h2><ul style="margin:0;padding-left:20px;line-height:1.7">%s</ul>%s%s<p style="margin:24px 0 0;font-size:12px;color:#64748b">Toto je testovací automatické upozornění na odstávku elektřiny.</p></div></div></body></html>',
          public.power_outage_client_email_html_escape(prepared.original_recipients),
          public.power_outage_client_email_html_escape(prepared.client_name_snapshot),
          public.power_outage_client_email_html_escape(upper(prepared.source)),
          public.power_outage_client_email_html_escape(prepared.event_label),
          public.power_outage_client_email_html_escape(to_char(prepared.starts_at at time zone 'Europe/Prague', 'DD. MM. YYYY HH24:MI')),
          public.power_outage_client_email_html_escape(to_char(prepared.ends_at at time zone 'Europe/Prague', 'DD. MM. YYYY HH24:MI')),
          public.power_outage_client_email_html_escape(coalesce(prepared.municipality, 'neuvedena')),
          prepared.store_count,
          coalesce((
            select string_agg(
              '<li><strong>' || public.power_outage_client_email_html_escape(coalesce(store.item ->> 'chainName', prepared.chain_name))
                || ' ' || public.power_outage_client_email_html_escape(coalesce(store.item ->> 'storeNumber', ''))
                || '</strong> · ' || public.power_outage_client_email_html_escape(coalesce(store.item ->> 'address', ''))
                || ', ' || public.power_outage_client_email_html_escape(coalesce(store.item ->> 'city', '')) || '</li>',
              '' order by store.ordinality
            )
            from jsonb_array_elements(prepared.store_snapshot)
              with ordinality as store(item, ordinality)
          ), '<li>Bez detailu prodejny</li>'),
          case when prepared.announcement_url ~* '^https://[^[:space:]]+$' then format(
            '<p style="margin:22px 0 0"><a href="%s" style="color:#0369a1;font-weight:700">Otevřít PDF oznámení</a></p>',
            public.power_outage_client_email_html_escape(prepared.announcement_url)
          ) else '' end,
          case when prepared.source_url ~* '^https://[^[:space:]]+$' then format(
            '<p style="margin:10px 0 0"><a href="%s" style="color:#0369a1">Otevřít zdroj odstávky</a></p>',
            public.power_outage_client_email_html_escape(prepared.source_url)
          ) else '' end
        ),
        provider = null,
        next_attempt_at = now(),
        metadata = delivery.metadata || jsonb_build_object(
          'contract', 'market-client-email-test-v1',
          'renderedAt', now(),
          'fromName', prepared.from_name,
          'fromEmail', prepared.from_email,
          'replyToEmail', prepared.reply_to_email,
          'originalRecipients', prepared.recipient_snapshot,
          'source', prepared.source,
          'externalId', prepared.external_id,
          'municipality', prepared.municipality,
          'startsAt', prepared.starts_at,
          'endsAt', prepared.ends_at,
          'sourceUrl', prepared.source_url,
          'announcementUrl', prepared.announcement_url,
          'storeCount', prepared.store_count,
          'sendingAttempted', false
        ),
        updated_at = now()
    from prepared
    where delivery.id = prepared.id
    returning delivery.id
  )
  select count(*) into rendered_count from rendered;

  return jsonb_build_object(
    'ok', true,
    'status', 'test',
    'renderedCount', rendered_count,
    'sendingAttempted', false
  );
exception
  when others then
    update public.power_outage_client_email_state
    set last_error_code = 'CLIENT_EMAIL_TEST_RENDER_FAILED',
        last_error_message = sqlerrm,
        updated_at = now()
    where singleton;
    return jsonb_build_object(
      'ok', false,
      'status', 'test',
      'errorCode', 'CLIENT_EMAIL_TEST_RENDER_FAILED',
      'errorMessage', sqlerrm,
      'renderedCount', 0,
      'sendingAttempted', false
    );
end;
$$;

create or replace function public.queue_power_outage_client_email_manual_test(
  p_client_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_settings record;
  selected_rule_id uuid;
  recipient_snapshot jsonb;
  original_recipients text;
  delivery_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Kontrolní e-mail může připravit pouze zabezpečená serverová akce.';
  end if;

  select settings.*
  into selected_settings
  from public.power_outage_client_email_settings as settings
  where settings.client_id = p_client_id
    and settings.mode = 'test'
  for update;

  if selected_settings.client_id is null then
    raise exception 'Klient není v TEST režimu.';
  end if;
  if not exists (
    select 1
    from public.power_outage_client_email_state
    where singleton and runtime_mode = 'test' and dispatch_enabled
  ) then
    raise exception 'Globální testovací odesílání není povoleno.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind', recipient.recipient_kind,
      'name', recipient.name,
      'email', recipient.email
    ) order by recipient.recipient_kind, recipient.email), '[]'::jsonb),
    coalesce(string_agg(recipient.email, ', ' order by recipient.recipient_kind, recipient.email), 'bez příjemce')
  into recipient_snapshot, original_recipients
  from public.power_outage_client_email_recipients as recipient
  where recipient.client_id = p_client_id
    and recipient.is_active;

  if not exists (
    select 1 from jsonb_array_elements(recipient_snapshot) as item(value)
    where item.value ->> 'kind' = 'to'
  ) then
    raise exception 'Chybí aktivní původní příjemce TO.';
  end if;

  select rule.id into selected_rule_id
  from public.power_outage_client_email_rules as rule
  where rule.client_id = p_client_id
    and rule.event_kind = 'new_outage'
    and rule.enabled
  order by rule.version desc
  limit 1;

  insert into public.power_outage_client_email_deliveries (
    client_id, rule_id, event_kind, mode_at_plan, dedupe_key,
    delivery_status, recipient_snapshot, store_snapshot,
    subject_snapshot, html_snapshot, text_snapshot, provider,
    next_attempt_at, metadata
  ) values (
    p_client_id,
    selected_rule_id,
    'new_outage',
    'test',
    'market-client-email:manual-test:' || gen_random_uuid()::text,
    'queued',
    recipient_snapshot,
    jsonb_build_array(jsonb_build_object(
      'chainName', selected_settings.chain_name,
      'storeNumber', 'TEST',
      'city', 'Testovací zpráva',
      'address', 'Bez skutečné odstávky'
    )),
    selected_settings.client_name_snapshot || ': kontrolní test e-mailových upozornění',
    format(
      '<!doctype html><html lang="cs"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="border:1px solid #a78bfa;border-radius:14px;background:#f5f3ff;padding:14px;color:#5b21b6"><strong>TESTOVACÍ REŽIM</strong><br><span style="font-size:13px">Klient nic neobdrží. Původní příjemci: %s</span></div><div style="margin-top:14px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px"><h1 style="margin:0 0 12px;font-size:24px">Kontrolní e-mail funguje</h1><p style="line-height:1.6">Odesílání přes Resend, česká diakritika a vzhled e-mailu jsou připravené k ověření.</p><p style="line-height:1.6"><strong>Klient:</strong> %s</p><p style="font-size:12px;color:#64748b">Nejde o skutečnou odstávku a klientovi nebyl e-mail odeslán.</p></div></div></body></html>',
      public.power_outage_client_email_html_escape(original_recipients),
      public.power_outage_client_email_html_escape(selected_settings.client_name_snapshot)
    ),
    concat_ws(E'\n',
      'TESTOVACÍ REŽIM – klient nic neobdrží',
      'Původní příjemci: ' || original_recipients,
      '',
      'Kontrolní e-mail funguje.',
      'Klient: ' || selected_settings.client_name_snapshot,
      'Odesílání přes Resend a česká diakritika jsou připravené k ověření.',
      'Nejde o skutečnou odstávku.'
    ),
    null,
    now(),
    jsonb_build_object(
      'contract', 'market-client-email-manual-test-v1',
      'manualTest', true,
      'fromName', selected_settings.from_name,
      'fromEmail', selected_settings.from_email,
      'replyToEmail', selected_settings.reply_to_email,
      'originalRecipients', recipient_snapshot,
      'sendingAttempted', false
    )
  ) returning id into delivery_id;

  return jsonb_build_object(
    'ok', true,
    'deliveryId', delivery_id,
    'mode', 'test',
    'queued', true
  );
end;
$$;

revoke all on function public.set_power_outage_client_email_test_mode(uuid,boolean)
  from public, anon, authenticated;
revoke all on function public.render_power_outage_client_email_test_deliveries(integer)
  from public, anon, authenticated;
revoke all on function public.queue_power_outage_client_email_manual_test(uuid)
  from public, anon, authenticated;
grant execute on function public.set_power_outage_client_email_test_mode(uuid,boolean) to service_role;
grant execute on function public.render_power_outage_client_email_test_deliveries(integer) to service_role;
grant execute on function public.queue_power_outage_client_email_manual_test(uuid) to service_role;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'server controlled client email TEST mode' as object_name,
  to_regprocedure('public.set_power_outage_client_email_test_mode(uuid,boolean)') is not null as is_correct
union all
select 'FUNCTION', 'render final TEST email snapshots',
  to_regprocedure('public.render_power_outage_client_email_test_deliveries(integer)') is not null
union all
select 'FUNCTION', 'queue manual TEST email',
  to_regprocedure('public.queue_power_outage_client_email_manual_test(uuid)') is not null
union all
select 'GRANT', 'authenticated cannot activate or queue TEST emails',
  not has_function_privilege('authenticated', 'public.set_power_outage_client_email_test_mode(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.queue_power_outage_client_email_manual_test(uuid)', 'execute')
union all
select 'SAFETY', 'migration leaves dispatch disabled',
  exists (select 1 from public.power_outage_client_email_state where singleton and dispatch_enabled = false)
union all
select 'SAFETY', 'migration creates no TEST delivery',
  not exists (select 1 from public.power_outage_client_email_deliveries where mode_at_plan = 'test')
union all
select 'SAFETY', 'at most one client can be in TEST',
  (select count(*) from public.power_outage_client_email_settings where mode = 'test') <= 1
union all
select 'SAFETY', 'TEST activation is non-retroactive',
  pg_get_functiondef('public.set_power_outage_client_email_test_mode(uuid,boolean)'::regprocedure)
    like '%next_version, now(), null%'
union all
select 'SAFETY', 'ending TEST cancels unsent TEST deliveries',
  pg_get_functiondef('public.set_power_outage_client_email_test_mode(uuid,boolean)'::regprocedure)
    like '%CLIENT_EMAIL_TEST_SESSION_ENDED%'
union all
select 'ISOLATION', 'TEST mode reads MARKET outage tables only',
  pg_get_functiondef('public.render_power_outage_client_email_test_deliveries(integer)'::regprocedure)
    not ilike '%complete_power_outage%'
order by check_type, object_name;
