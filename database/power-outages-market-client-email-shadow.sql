begin;

do $$
begin
  if to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is null then
    raise exception 'Nejdříve musí být nasazen krok 3 – plánovač kandidátů klientských e-mailů.';
  end if;
  if to_regprocedure('public.request_power_outages_endpoint(text)') is null then
    raise exception 'Chybí společná funkce pro bezpečné volání automatizačních endpointů.';
  end if;
end
$$;

-- HTML vzniká jako neměnný snapshot. Všechny hodnoty z databáze před vložením
-- escapujeme, aby ani text zdroje odstávky nemohl změnit strukturu e-mailu.
create or replace function public.power_outage_client_email_html_escape(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(
    replace(
      replace(
        replace(
          replace(p_value, '&', '&amp;'),
          '<', '&lt;'
        ),
        '>', '&gt;'
      ),
      '"', '&quot;'
    ),
    '''', '&#39;'
  );
$$;

revoke all on function public.power_outage_client_email_html_escape(text)
  from public, anon, authenticated;
grant execute on function public.power_outage_client_email_html_escape(text)
  to service_role;

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
  enabled_rule_count integer;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Stínová pravidla může měnit pouze administrátor.';
  end if;

  -- Připomínku zapojíme až po definici jejího přesného času a podmínek.
  if p_event_kind not in ('new_outage', 'schedule_changed', 'cancelled') then
    raise exception 'Tento typ události zatím nelze ve stínovém režimu aktivovat.';
  end if;

  select settings.*
  into selected_settings
  from public.power_outage_client_email_settings as settings
  where settings.client_id = p_client_id
  for update;

  if selected_settings.client_id is null then
    raise exception 'Klient není součástí e-mailových upozornění MARKETY.';
  end if;

  if p_enabled then
    if selected_settings.mode <> 'shadow' then
      raise exception 'Nejprve klienta uložte v režimu STÍNOVÝ.';
    end if;
    if nullif(trim(coalesce(selected_settings.from_name, '')), '') is null
      or trim(coalesce(selected_settings.from_email, ''))
        !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro stínový režim chybí platný odesílatel.';
    end if;
    if not exists (
      select 1
      from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = p_client_id
        and recipient.recipient_kind = 'to'
        and recipient.is_active
    ) then
      raise exception 'Pro stínový režim chybí aktivní příjemce TO.';
    end if;
  end if;

  select rule.*
  into selected_rule
  from public.power_outage_client_email_rules as rule
  where rule.client_id = p_client_id
    and rule.event_kind = p_event_kind
  order by rule.version desc
  limit 1
  for update;

  if selected_rule.id is null then
    raise exception 'Požadované pravidlo neexistuje.';
  end if;

  if p_enabled then
    update public.power_outage_client_email_rules
    set enabled = false,
        updated_at = now()
    where client_id = p_client_id
      and event_kind = p_event_kind
      and id <> selected_rule.id
      and enabled;

    update public.power_outage_client_email_rules
    set enabled = true,
        -- Čas nastavíme pouze při skutečném přechodu vypnuto -> zapnuto.
        -- Opakované uložení proto nezmění hranici a nevytvoří duplicity.
        activated_at = case when enabled then activated_at else now() end,
        updated_at = now()
    where id = selected_rule.id;

    update public.power_outage_client_email_settings
    set activated_at = coalesce(activated_at, now()),
        updated_at = now()
    where client_id = p_client_id;

    update public.power_outage_client_email_state
    set runtime_mode = 'shadow',
        dispatch_enabled = false,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where singleton;
  else
    update public.power_outage_client_email_rules
    set enabled = false,
        updated_at = now()
    where id = selected_rule.id;

    select count(*)
    into enabled_rule_count
    from public.power_outage_client_email_rules
    where enabled;

    if enabled_rule_count = 0 then
      update public.power_outage_client_email_state
      set runtime_mode = 'disabled',
          dispatch_enabled = false,
          updated_at = now()
      where singleton;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'clientId', p_client_id,
    'eventKind', p_event_kind,
    'enabled', p_enabled,
    'runtimeMode', case when p_enabled or enabled_rule_count > 0 then 'shadow' else 'disabled' end,
    'dispatchEnabled', false,
    'sendingAttempted', false
  );
end;
$$;

revoke all on function public.set_power_outage_client_email_shadow_rule(uuid,text,boolean)
  from public, anon;
grant execute on function public.set_power_outage_client_email_shadow_rule(uuid,text,boolean)
  to authenticated, service_role;

create or replace function public.sync_power_outage_client_email_shadow_mode()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode = 'disabled' and old.mode is distinct from new.mode then
    update public.power_outage_client_email_rules
    set enabled = false,
        updated_at = now()
    where client_id = new.client_id
      and enabled;

    if not exists (
      select 1 from public.power_outage_client_email_rules where enabled
    ) then
      update public.power_outage_client_email_state
      set runtime_mode = 'disabled',
          dispatch_enabled = false,
          updated_at = now()
      where singleton;
    end if;
  elsif new.mode = 'shadow' then
    update public.power_outage_client_email_settings
    set activated_at = (
          select min(rule.activated_at)
          from public.power_outage_client_email_rules as rule
          where rule.client_id = new.client_id
            and rule.enabled
        ),
        updated_at = now()
    where client_id = new.client_id
      and activated_at is distinct from (
        select min(rule.activated_at)
        from public.power_outage_client_email_rules as rule
        where rule.client_id = new.client_id
          and rule.enabled
      );
  end if;
  return new;
end;
$$;

drop trigger if exists power_outage_client_email_settings_sync_shadow_mode
  on public.power_outage_client_email_settings;
create trigger power_outage_client_email_settings_sync_shadow_mode
after update of mode on public.power_outage_client_email_settings
for each row execute function public.sync_power_outage_client_email_shadow_mode();

revoke all on function public.sync_power_outage_client_email_shadow_mode()
  from public, anon, authenticated;
grant execute on function public.sync_power_outage_client_email_shadow_mode()
  to service_role;

create or replace function public.render_power_outage_client_email_shadow_deliveries(
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
    raise exception 'Příprava stínových náhledů je dostupná pouze serverovému workeru.';
  end if;
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Velikost dávky musí být mezi 1 a 1000.';
  end if;

  with targets as (
    select delivery.id
    from public.power_outage_client_email_deliveries as delivery
    where delivery.delivery_status = 'planned'
      and delivery.mode_at_plan = 'shadow'
    order by delivery.created_at
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
      coalesce(jsonb_array_length(delivery.store_snapshot), 0) as store_count
    from targets
    join public.power_outage_client_email_deliveries as delivery on delivery.id = targets.id
    join public.power_outage_client_email_settings as settings on settings.client_id = delivery.client_id
    join public.power_outages as outage on outage.id = delivery.outage_id
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
          prepared.event_label,
          '',
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
            from jsonb_array_elements(prepared.store_snapshot) with ordinality as store(item, ordinality)
          ), '• bez detailu prodejny'),
          case when prepared.announcement_url ~* '^https://[^[:space:]]+$' then 'PDF oznámení: ' || prepared.announcement_url end,
          case when prepared.source_url ~* '^https://[^[:space:]]+$' then 'Zdroj: ' || prepared.source_url end,
          '',
          'Toto je automaticky připravené upozornění na odstávku elektřiny.'
        ),
        html_snapshot = format(
          '<!doctype html><html lang="cs"><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:680px;margin:0 auto;padding:24px"><div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#64748b;text-transform:uppercase">%s · %s</div><h1 style="margin:10px 0 20px;font-size:24px;line-height:1.25">%s</h1><table role="presentation" style="width:100%%;border-collapse:collapse"><tr><td style="padding:8px 0;color:#64748b">Termín</td><td style="padding:8px 0;text-align:right;font-weight:700">%s–%s</td></tr><tr><td style="padding:8px 0;color:#64748b">Obec</td><td style="padding:8px 0;text-align:right;font-weight:700">%s</td></tr><tr><td style="padding:8px 0;color:#64748b">Dotčené prodejny</td><td style="padding:8px 0;text-align:right;font-weight:700">%s</td></tr></table><h2 style="margin:24px 0 10px;font-size:17px">Prodejny</h2><ul style="margin:0;padding-left:20px;line-height:1.7">%s</ul>%s%s<p style="margin:24px 0 0;font-size:12px;color:#64748b">Toto je automaticky připravené upozornění na odstávku elektřiny.</p></div></div></body></html>',
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
            from jsonb_array_elements(prepared.store_snapshot) with ordinality as store(item, ordinality)
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
        next_attempt_at = null,
        metadata = delivery.metadata || jsonb_build_object(
          'contract', 'market-client-email-shadow-v1',
          'renderedAt', now(),
          'fromName', prepared.from_name,
          'fromEmail', prepared.from_email,
          'replyToEmail', prepared.reply_to_email,
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
    'status', 'shadow',
    'renderedCount', rendered_count,
    'sendingAttempted', false
  );
exception
  when others then
    update public.power_outage_client_email_state
    set last_error_code = 'CLIENT_EMAIL_SHADOW_RENDER_FAILED',
        last_error_message = sqlerrm,
        updated_at = now()
    where singleton;
    return jsonb_build_object(
      'ok', false,
      'status', 'shadow',
      'errorCode', 'CLIENT_EMAIL_SHADOW_RENDER_FAILED',
      'errorMessage', sqlerrm,
      'renderedCount', 0,
      'sendingAttempted', false
    );
end;
$$;

revoke all on function public.render_power_outage_client_email_shadow_deliveries(integer)
  from public, anon, authenticated;
grant execute on function public.render_power_outage_client_email_shadow_deliveries(integer)
  to service_role;

-- Automatizace pouze připravuje snapshoty. Globální databázová pojistka zůstává
-- dispatch_enabled = false a v tomto kroku neexistuje žádný odesílací worker.
do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'power_outage_client_email_shadow_plan_every_five_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outage_client_email_shadow_plan_every_five_minutes',
    '4-59/5 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/client-emails/plan');$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'set client email shadow rule' as object_name,
  to_regprocedure('public.set_power_outage_client_email_shadow_rule(uuid,text,boolean)') is not null as is_correct
union all
select 'FUNCTION', 'render final shadow email snapshots',
  to_regprocedure('public.render_power_outage_client_email_shadow_deliveries(integer)') is not null
union all
select 'TRIGGER', 'disabling client stops its shadow rules',
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.power_outage_client_email_settings'::regclass
      and tgname = 'power_outage_client_email_settings_sync_shadow_mode'
      and not tgisinternal
  )
union all
select 'CRON', 'shadow planner every five minutes',
  exists (
    select 1 from cron.job
    where jobname = 'power_outage_client_email_shadow_plan_every_five_minutes'
      and schedule = '4-59/5 * * * *'
      and active
  )
union all
select 'SAFETY', 'client email dispatch remains disabled',
  exists (
    select 1 from public.power_outage_client_email_state
    where singleton and dispatch_enabled = false
  )
union all
select 'SAFETY', 'shadow renderer cannot send email',
  pg_get_functiondef(
    'public.render_power_outage_client_email_shadow_deliveries(integer)'::regprocedure
  ) not ilike '%net.http%'
  and pg_get_functiondef(
    'public.render_power_outage_client_email_shadow_deliveries(integer)'::regprocedure
  ) not ilike '%api.resend%'
union all
select 'SAFETY', 'shadow activation is not retroactive',
  pg_get_functiondef(
    'public.set_power_outage_client_email_shadow_rule(uuid,text,boolean)'::regprocedure
  ) like '%activated_at = case when enabled then activated_at else now() end%'
union all
select 'SAFETY', 'no sending statuses were created',
  not exists (
    select 1 from public.power_outage_client_email_deliveries
    where delivery_status in ('queued', 'sending', 'sent', 'delivered')
  )
union all
select 'DATA', 'all shadow snapshots are complete',
  not exists (
    select 1 from public.power_outage_client_email_deliveries
    where mode_at_plan = 'shadow'
      and delivery_status = 'planned'
      and (
        nullif(trim(coalesce(subject_snapshot, '')), '') is null
        or nullif(trim(coalesce(text_snapshot, '')), '') is null
        or nullif(trim(coalesce(html_snapshot, '')), '') is null
        or jsonb_array_length(recipient_snapshot) = 0
        or jsonb_array_length(store_snapshot) = 0
      )
  )
union all
select 'SCOPE', 'shadow planner reads MARKET outage tables only',
  pg_get_functiondef(
    'public.render_power_outage_client_email_shadow_deliveries(integer)'::regprocedure
  ) not ilike '%complete_power_outage%'
union all
select 'ISOLATION', 'shadow cron calls planner, not sender',
  exists (
    select 1 from cron.job
    where jobname = 'power_outage_client_email_shadow_plan_every_five_minutes'
      and command like '%/client-emails/plan%'
      and command not ilike '%send%'
  )
order by check_type, object_name;
