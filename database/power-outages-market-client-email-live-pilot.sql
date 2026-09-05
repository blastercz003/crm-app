begin;

do $$
begin
  if to_regprocedure('public.set_power_outage_client_email_test_mode(uuid,boolean)') is null then
    raise exception 'Nejdříve musí být nasazen a ověřen TEST režim klientských e-mailů.';
  end if;
  if to_regprocedure('public.claim_power_outage_client_email_delivery_batch(integer)') is null then
    raise exception 'Chybí e-mailový worker.';
  end if;
end
$$;

-- Worker smí převzít jen položky právě aktivního globálního režimu a klienta,
-- který v tomto režimu stále je. Zastavený pilot proto nelze později omylem odeslat.
do $$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.claim_power_outage_client_email_delivery_batch(integer)'::regprocedure
  );

  if function_definition like '%settings.mode = delivery.mode_at_plan%'
    and function_definition like '%delivery.mode_at_plan = runtime_record.runtime_mode%'
  then
    return;
  end if;
  if function_definition not like '%where delivery.mode_at_plan in (''test'', ''live'')%'
    or function_definition not like '%and mode_at_plan in (''test'', ''live'')%'
    or function_definition not like '%from public.power_outage_client_email_deliveries as delivery%'
  then
    raise exception 'Definice odesílacího workeru neodpovídá očekávané verzi.';
  end if;

  function_definition := replace(
    function_definition,
    'and mode_at_plan in (''test'', ''live'')',
    'and mode_at_plan = runtime_record.runtime_mode'
  );
  function_definition := replace(
    function_definition,
    'from public.power_outage_client_email_deliveries as delivery
    where delivery.mode_at_plan in (''test'', ''live'')',
    'from public.power_outage_client_email_deliveries as delivery
    join public.power_outage_client_email_settings as settings
      on settings.client_id = delivery.client_id
     and settings.mode = delivery.mode_at_plan
    where delivery.mode_at_plan = runtime_record.runtime_mode'
  );

  if function_definition not like '%settings.mode = delivery.mode_at_plan%'
    or function_definition not like '%delivery.mode_at_plan = runtime_record.runtime_mode%'
    or function_definition like '%mode_at_plan in (''test'', ''live'')%'
  then
    raise exception 'Omezení workeru na aktivní režim nebylo úplné.';
  end if;

  execute function_definition;
end
$$;

create or replace function public.set_power_outage_client_email_live_pilot(
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
    raise exception 'Ostrý pilot může změnit pouze zabezpečená serverová akce.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_client_email_live_pilot', 0)
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
      where singleton and runtime_mode in ('test', 'live')
    ) or exists (
      select 1
      from public.power_outage_client_email_settings
      where mode in ('test', 'live')
    ) then
      raise exception 'Jiný TEST nebo ostrý pilot je již aktivní.';
    end if;
    if selected_settings.mode <> 'shadow' then
      raise exception 'Klient musí být před pilotem v režimu STÍNOVÝ.';
    end if;
    if nullif(trim(coalesce(selected_settings.from_name, '')), '') is null
      or trim(coalesce(selected_settings.from_email, ''))
        !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro ostrý pilot chybí platný odesílatel.';
    end if;
    if not exists (
      select 1
      from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = p_client_id
        and recipient.recipient_kind = 'to'
        and recipient.is_active
    ) then
      raise exception 'Pro ostrý pilot chybí aktivní příjemce TO.';
    end if;
    if not exists (
      select 1
      from public.power_outage_client_email_deliveries as delivery
      where delivery.client_id = p_client_id
        and delivery.mode_at_plan = 'test'
        and delivery.delivery_status = 'delivered'
        and delivery.delivered_at is not null
        and delivery.provider = 'resend'
        and delivery.provider_message_id is not null
    ) then
      raise exception 'Před ostrým pilotem chybí úspěšně doručený TEST stejného klienta.';
    end if;

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
        last_error_code = 'CLIENT_EMAIL_LIVE_PILOT_REPLACED',
        last_error_message = 'Neodeslaná položka patřila k předchozímu ostrému pilotu.',
        updated_at = now()
    where client_id = p_client_id
      and mode_at_plan = 'live'
      and delivery_status in ('planned', 'queued', 'failed');

    update public.power_outage_client_email_settings
    set mode = 'live',
        activated_at = now(),
        updated_at = now()
    where client_id = p_client_id;

    update public.power_outage_client_email_state
    set runtime_mode = 'live',
        dispatch_enabled = true,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where singleton;

    return jsonb_build_object(
      'ok', true,
      'clientId', p_client_id,
      'mode', 'live',
      'eventKind', 'new_outage',
      'dispatchEnabled', true,
      'nonRetroactive', true,
      'singleClientPilot', true
    );
  end if;

  if selected_settings.mode <> 'live' then
    raise exception 'Vybraný klient nemá aktivní ostrý pilot.';
  end if;
  if exists (
    select 1
    from public.power_outage_client_email_deliveries
    where client_id = p_client_id
      and mode_at_plan = 'live'
      and delivery_status = 'sending'
  ) then
    raise exception 'Právě probíhá jedno odeslání. Ukončení pilotu opakujte za chvíli.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'cancelled',
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      last_error_code = 'CLIENT_EMAIL_LIVE_PILOT_ENDED',
      last_error_message = 'Neodeslaná ostrá položka byla zrušena při ukončení pilotu.',
      updated_at = now()
  where client_id = p_client_id
    and mode_at_plan = 'live'
    and delivery_status in ('planned', 'queued', 'failed');

  update public.power_outage_client_email_settings
  set mode = 'shadow',
      updated_at = now()
  where client_id = p_client_id;

  select case
    when exists (select 1 from public.power_outage_client_email_rules where enabled)
      then 'shadow'
    else 'disabled'
  end into next_runtime;

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

-- Tvrdá pojistka pilotu: bounce nebo complaint vypne další odesílání a zruší
-- dosud nepřevzaté ostré položky stejného klienta.
create or replace function public.stop_power_outage_client_email_live_pilot_on_rejection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.mode_at_plan <> 'live'
    or new.delivery_status not in ('bounced', 'complained')
    or old.delivery_status = new.delivery_status
    or not exists (
      select 1
      from public.power_outage_client_email_settings as settings
      where settings.client_id = new.client_id
        and settings.mode = 'live'
    )
  then
    return new;
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'cancelled',
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      last_error_code = 'CLIENT_EMAIL_LIVE_CIRCUIT_BREAKER',
      last_error_message = 'Položka byla zrušena po odmítnutí jiné zprávy ostrého pilotu.',
      updated_at = now()
  where client_id = new.client_id
    and mode_at_plan = 'live'
    and id <> new.id
    and delivery_status in ('planned', 'queued', 'failed');

  update public.power_outage_client_email_settings
  set mode = 'shadow',
      updated_at = now()
  where client_id = new.client_id
    and mode = 'live';

  update public.power_outage_client_email_state
  set runtime_mode = 'shadow',
      dispatch_enabled = false,
      worker_token = null,
      worker_expires_at = null,
      last_error_code = case
        when new.delivery_status = 'complained' then 'CLIENT_EMAIL_LIVE_COMPLAINT'
        else 'CLIENT_EMAIL_LIVE_BOUNCE'
      end,
      last_error_message = 'Ostrý pilot byl automaticky zastaven po odmítnutí zprávy příjemcem.',
      updated_at = now()
  where singleton;

  return new;
end;
$$;

drop trigger if exists power_outage_client_email_live_rejection_stop
  on public.power_outage_client_email_deliveries;
create trigger power_outage_client_email_live_rejection_stop
after update of delivery_status on public.power_outage_client_email_deliveries
for each row execute function public.stop_power_outage_client_email_live_pilot_on_rejection();

revoke all on function public.set_power_outage_client_email_live_pilot(uuid,boolean)
  from public, anon, authenticated;
revoke all on function public.stop_power_outage_client_email_live_pilot_on_rejection()
  from public, anon, authenticated;
grant execute on function public.set_power_outage_client_email_live_pilot(uuid,boolean) to service_role;
grant execute on function public.stop_power_outage_client_email_live_pilot_on_rejection() to service_role;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'server controlled single-client live pilot' as object_name,
  to_regprocedure('public.set_power_outage_client_email_live_pilot(uuid,boolean)') is not null as is_correct
union all
select 'FUNCTION', 'live rejection circuit breaker',
  to_regprocedure('public.stop_power_outage_client_email_live_pilot_on_rejection()') is not null
union all
select 'TRIGGER', 'live rejection stops pilot',
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.power_outage_client_email_deliveries'::regclass
      and tgname = 'power_outage_client_email_live_rejection_stop'
      and not tgisinternal
  )
union all
select 'FUNCTION', 'worker claims only current client mode',
  pg_get_functiondef('public.claim_power_outage_client_email_delivery_batch(integer)'::regprocedure)
    like '%settings.mode = delivery.mode_at_plan%'
  and pg_get_functiondef('public.claim_power_outage_client_email_delivery_batch(integer)'::regprocedure)
    like '%delivery.mode_at_plan = runtime_record.runtime_mode%'
union all
select 'GRANT', 'authenticated cannot activate live pilot',
  not has_function_privilege('authenticated', 'public.set_power_outage_client_email_live_pilot(uuid,boolean)', 'execute')
union all
select 'SAFETY', 'migration leaves dispatch disabled',
  exists (
    select 1 from public.power_outage_client_email_state
    where singleton and dispatch_enabled = false and runtime_mode in ('disabled', 'shadow')
  )
union all
select 'SAFETY', 'migration activates no live client',
  not exists (select 1 from public.power_outage_client_email_settings where mode = 'live')
union all
select 'SAFETY', 'migration creates no live delivery',
  not exists (select 1 from public.power_outage_client_email_deliveries where mode_at_plan = 'live')
union all
select 'SAFETY', 'pilot requires delivered TEST for same client',
  pg_get_functiondef('public.set_power_outage_client_email_live_pilot(uuid,boolean)'::regprocedure)
    like '%delivery.delivery_status = ''delivered''%'
union all
select 'SAFETY', 'pilot activation is non-retroactive',
  pg_get_functiondef('public.set_power_outage_client_email_live_pilot(uuid,boolean)'::regprocedure)
    like '%next_version, now(), null%'
union all
select 'SAFETY', 'pilot stop cancels unsent live deliveries',
  pg_get_functiondef('public.set_power_outage_client_email_live_pilot(uuid,boolean)'::regprocedure)
    like '%CLIENT_EMAIL_LIVE_PILOT_ENDED%'
union all
select 'ISOLATION', 'live pilot does not reference COMPLETE outage tables',
  pg_get_functiondef('public.set_power_outage_client_email_live_pilot(uuid,boolean)'::regprocedure)
    not ilike '%complete_power_outage%'
order by check_type, object_name;
