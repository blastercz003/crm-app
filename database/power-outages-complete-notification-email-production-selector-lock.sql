begin;

-- Ostry provoz KOMPLETNI, krok 5: zdrojovy AI SELECT filtr se nesmi zmenit
-- behem odesilani. Mimo LIVE se kontaktni davka a oba e-mailove ukazatele
-- prepnou v jedine transakci; bez HTTP, Brave nebo Resend pozadavku.
do $$
begin
  if to_regprocedure('public.prepare_complete_power_outage_contact_selector_v1(text)') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config_events') is null
    or to_regclass('public.complete_power_outage_notification_email_state') is null then
    raise exception 'Chybi zavislosti pro uzamceni zdrojoveho filtru KOMPLETNI.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_production_config config
    cross join public.complete_power_outage_notification_email_state email_state
    where config.singleton and email_state.singleton
      and (
        config.configuration_status = 'live'
        or config.production_activation_enabled
        or config.continuous_dispatch_enabled
        or email_state.runtime_mode = 'live'
        or email_state.dispatch_enabled
      )
  ) then
    raise exception 'Pred instalaci zamku musi byt produkcni odesilani KOMPLETNI vypnute.';
  end if;
end
$$;

-- Trigger chrani vsechny tri ulozene ukazatele. Zamek tak plati i pro primy
-- serverovy zapis mimo admin RPC, ne pouze pro ovladaci prvek v aplikaci.
create or replace function public.enforce_cpo_contact_selector_dispatch_lock_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_selector_key text;
  new_selector_key text;
  sending_is_active boolean;
begin
  old_selector_key := coalesce(
    to_jsonb(old) ->> 'selected_selector_key',
    to_jsonb(old) ->> 'active_selector_key'
  );
  new_selector_key := coalesce(
    to_jsonb(new) ->> 'selected_selector_key',
    to_jsonb(new) ->> 'active_selector_key'
  );

  if old_selector_key is not distinct from new_selector_key then
    return new;
  end if;

  select
    config.configuration_status = 'live'
      or config.production_activation_enabled
      or config.continuous_dispatch_enabled
      or email_state.runtime_mode = 'live'
      or email_state.dispatch_enabled
  into sending_is_active
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton;

  if coalesce(sending_is_active, true) then
    raise exception 'Zdrojovy vyber je uzamcen behem aktivniho odesilani KOMPLETNI.';
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_contact_selector_dispatch_lock
  on public.complete_power_outage_contact_discovery_state;
create trigger cpo_contact_selector_dispatch_lock
before update on public.complete_power_outage_contact_discovery_state
for each row execute function public.enforce_cpo_contact_selector_dispatch_lock_v1();

drop trigger if exists cpo_production_selector_dispatch_lock
  on public.complete_power_outage_notification_email_production_config;
create trigger cpo_production_selector_dispatch_lock
before update on public.complete_power_outage_notification_email_production_config
for each row execute function public.enforce_cpo_contact_selector_dispatch_lock_v1();

drop trigger if exists cpo_email_state_selector_dispatch_lock
  on public.complete_power_outage_notification_email_state;
create trigger cpo_email_state_selector_dispatch_lock
before update on public.complete_power_outage_notification_email_state
for each row execute function public.enforce_cpo_contact_selector_dispatch_lock_v1();

create or replace function public.get_cpo_contact_selector_lock_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Stav zdrojoveho vyberu je dostupny pouze administratorum.';
  end if;

  select jsonb_build_object(
    'selectorLockedByEmailDispatch',
      config.configuration_status = 'live'
      or config.production_activation_enabled
      or config.continuous_dispatch_enabled
      or email_state.runtime_mode = 'live'
      or email_state.dispatch_enabled,
    'selectorLockReason', case
      when config.configuration_status = 'live'
        or config.production_activation_enabled
        or config.continuous_dispatch_enabled
        or email_state.runtime_mode = 'live'
        or email_state.dispatch_enabled
      then 'Zdrojový výběr je uzamčen během aktivního odesílání. Nejprve pozastavte Upozornění firmám.'
      else null
    end,
    'productionEmailSelectorKey', config.active_selector_key
  ) into result
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton;

  return coalesce(result, jsonb_build_object(
    'selectorLockedByEmailDispatch', true,
    'selectorLockReason', 'Stav zámku zdrojového výběru není dostupný.',
    'productionEmailSelectorKey', null
  ));
end;
$$;

create or replace function public.prepare_complete_power_outage_contact_selector_v2(
  requested_selector_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  capture_result jsonb;
  previous_config jsonb;
  resulting_config jsonb;
  planning_was_running boolean;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Vyber kontaktu muze menit pouze administrator.';
  end if;

  -- Stejny zamek pouziva planner. Po dobu prepnuti tak nemuze pozorovat
  -- mezistav a nastaveni nelze soubezne menit v druhem admin pozadavku.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_production_planner_v1', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('complete-notification-email-production-config-v1')
  );

  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton
  for update;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton
  for update;

  if config_row.singleton is null or email_state.singleton is null then
    raise exception 'Chybi stav produkcnich e-mailu KOMPLETNI.';
  end if;

  if config_row.configuration_status = 'live'
    or config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled
    or email_state.runtime_mode = 'live'
    or email_state.dispatch_enabled then
    raise exception 'Zdrojovy vyber je uzamcen behem aktivniho odesilani. Nejprve pozastavte Upozorneni firmam.';
  end if;

  previous_config := jsonb_build_object(
    'configurationStatus', config_row.configuration_status,
    'activeSelectorKey', config_row.active_selector_key,
    'continuousPlanningEnabled', config_row.continuous_planning_enabled,
    'continuousDispatchEnabled', config_row.continuous_dispatch_enabled,
    'configurationVersion', config_row.configuration_version
  );
  planning_was_running := config_row.continuous_planning_enabled;

  if planning_was_running then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        continuous_planning_enabled = false,
        updated_at = now()
    where singleton;
  end if;

  capture_result := public.prepare_complete_power_outage_contact_selector_v1(
    requested_selector_key
  );

  update public.complete_power_outage_notification_email_production_config
  set active_selector_key = requested_selector_key,
      configuration_status = case when planning_was_running then 'ready' else 'paused' end,
      continuous_planning_enabled = planning_was_running,
      configuration_version = configuration_version + 1,
      last_configured_at = now(),
      last_configured_by = auth.uid(),
      metadata = metadata || jsonb_build_object(
        'selectorLockContract', 'complete-notification-email-selector-lock-v1',
        'selectorChangedAt', now(),
        'selectorChangedBy', auth.uid(),
        'plannerPreserved', planning_was_running,
        'sendingAttempted', false
      ),
      updated_at = now()
  where singleton
  returning * into config_row;

  update public.complete_power_outage_notification_email_state
  set runtime_mode = 'shadow',
      planning_enabled = planning_was_running,
      dispatch_enabled = false,
      active_selector_key = requested_selector_key,
      metadata = metadata || jsonb_build_object(
        'selectorLockContract', 'complete-notification-email-selector-lock-v1',
        'selectorChangedAt', now(),
        'sendingAttempted', false
      ),
      updated_at = now()
  where singleton;

  resulting_config := jsonb_build_object(
    'configurationStatus', config_row.configuration_status,
    'activeSelectorKey', config_row.active_selector_key,
    'continuousPlanningEnabled', config_row.continuous_planning_enabled,
    'continuousDispatchEnabled', config_row.continuous_dispatch_enabled,
    'configurationVersion', config_row.configuration_version
  );

  insert into public.complete_power_outage_notification_email_production_config_events (
    event_kind, configuration_version, actor_user_id,
    previous_configuration, resulting_configuration, reason, metadata
  ) values (
    'selector_changed', config_row.configuration_version, auth.uid(),
    previous_config, resulting_config,
    'Administrátor změnil zdrojový AI SELECT výběr při vypnutém odesílání.',
    jsonb_build_object(
      'contract', 'complete-notification-email-selector-lock-v1',
      'sendingAttempted', false,
      'dispatchEnabled', false,
      'marketEmailIsolation', true
    )
  );

  return capture_result || jsonb_build_object(
    'selectorKey', requested_selector_key,
    'productionEmailSelectorKey', requested_selector_key,
    'selectorLockedByEmailDispatch', false,
    'plannerPreserved', planning_was_running,
    'sendingAttempted', false
  );
end;
$$;

revoke all on function public.get_cpo_contact_selector_lock_v1()
  from public, anon;
revoke all on function public.prepare_complete_power_outage_contact_selector_v2(text)
  from public, anon;
grant execute on function public.get_cpo_contact_selector_lock_v1()
  to authenticated, service_role;
grant execute on function public.prepare_complete_power_outage_contact_selector_v2(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

with definitions as (
  select
    pg_get_functiondef(
      'public.prepare_complete_power_outage_contact_selector_v2(text)'::regprocedure
    ) as switch_definition,
    pg_get_functiondef(
      'public.get_cpo_contact_selector_lock_v1()'::regprocedure
    ) as lock_definition
), audit as (
  select 'FUNCTION'::text as check_type,
    'transactional production selector switch exists'::text as object_name,
    to_regprocedure('public.prepare_complete_power_outage_contact_selector_v2(text)') is not null as is_correct

  union all
  select 'FUNCTION', 'admin selector lock state exists',
    to_regprocedure('public.get_cpo_contact_selector_lock_v1()') is not null

  union all
  select 'GRANT', 'selector switch and lock state enforce administrator role',
    switch_definition ilike '%profile.role = ''admin''%'
      and lock_definition ilike '%profile.role = ''admin''%'
      and has_function_privilege('authenticated', 'public.prepare_complete_power_outage_contact_selector_v2(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.prepare_complete_power_outage_contact_selector_v2(text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.get_cpo_contact_selector_lock_v1()', 'EXECUTE')
  from definitions

  union all
  select 'TRIGGER', 'database selector lock covers contact planning and production state',
    (
      select count(*) = 3
      from pg_trigger trigger_row
      where not trigger_row.tgisinternal
        and trigger_row.tgname in (
          'cpo_contact_selector_dispatch_lock',
          'cpo_production_selector_dispatch_lock',
          'cpo_email_state_selector_dispatch_lock'
        )
        and trigger_row.tgfoid =
          'public.enforce_cpo_contact_selector_dispatch_lock_v1()'::regprocedure
    )

  union all
  select 'LOGIC', 'source selector is locked during production sending',
    switch_definition ilike '%configuration_status = ''live''%'
      and switch_definition ilike '%production_activation_enabled%'
      and switch_definition ilike '%continuous_dispatch_enabled%'
      and switch_definition ilike '%email_state.dispatch_enabled%'
  from definitions

  union all
  select 'LOGIC', 'contact planning and production selectors remain synchronized',
    switch_definition ilike '%active_selector_key = requested_selector_key%'
      and switch_definition ilike '%prepare_complete_power_outage_contact_selector_v1%'
  from definitions

  union all
  select 'LOGIC', 'continuous planner state is preserved across selector switch',
    switch_definition ilike '%planning_was_running%'
      and switch_definition ilike '%continuous_planning_enabled = planning_was_running%'
  from definitions

  union all
  select 'DATA', 'current contact and email source selectors are synchronized',
    contact_state.selected_selector_key = config.active_selector_key
      and email_state.active_selector_key = config.active_selector_key
  from public.complete_power_outage_contact_discovery_state contact_state
  cross join public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where contact_state.singleton and config.singleton and email_state.singleton

  union all
  select 'SAFETY', 'selector lock installation leaves production dispatch disabled',
    not config.production_activation_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.dispatch_enabled
      and email_state.runtime_mode <> 'live'
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton

  union all
  select 'SAFETY', 'selector switch performs no HTTP Brave or Resend request',
    switch_definition not ilike '%http_post%'
      and switch_definition not ilike '%brave_api%'
      and switch_definition not ilike '%resend.com%'
  from definitions

  union all
  select 'ISOLATION', 'selector lock does not reference MARKET email objects',
    switch_definition not ilike '%market_email%'
      and lock_definition not ilike '%market_email%'
  from definitions

  union all
  select 'STATE', 'source selector is currently editable while dispatch is disabled',
    not (
      config.configuration_status = 'live'
      or config.production_activation_enabled
      or config.continuous_dispatch_enabled
      or email_state.runtime_mode = 'live'
      or email_state.dispatch_enabled
    )
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
