begin;

-- Ostry provoz KOMPLETNI, krok 2: admin-only sprava konfigurace.
-- Nastaveni lze menit pouze pri pozastavenem odesilani. Produkcni planovani,
-- aktivace i dispatch zustavaji timto krokem zakazane.
do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config_events') is null
    or to_regprocedure('public.get_cpo_notification_email_management_v1(integer)') is null then
    raise exception 'Chybi zavislosti pro admin spravu produkcni konfigurace KOMPLETNI.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
      and (state_row.runtime_mode = 'live' or state_row.dispatch_enabled)
  ) then
    raise exception 'Pred instalaci spravy konfigurace musi byt odesilani KOMPLETNI pozastaveno.';
  end if;
end
$$;

alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step1_activation_check;
alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step2_activation_check;

update public.complete_power_outage_notification_email_production_config
set configuration_status = 'ready',
    settings_ui_enabled = true,
    production_activation_enabled = false,
    continuous_planning_enabled = false,
    continuous_dispatch_enabled = false,
    metadata = metadata || jsonb_build_object(
      'settingsUiContract', 'complete-notification-email-production-settings-v1',
      'settingsUiEnabledAt', now(),
      'productionActivationAvailable', false,
      'sendingChanged', false
    ),
    updated_at = now()
where singleton;

alter table public.complete_power_outage_notification_email_production_config
  add constraint cpo_notification_email_production_step2_activation_check check (
    configuration_status in ('draft', 'ready')
    and settings_ui_enabled
    and not production_activation_enabled
    and not continuous_planning_enabled
    and not continuous_dispatch_enabled
  );

create or replace function public.get_cpo_notification_email_production_config_v1()
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
    select 1
    from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Produkční nastavení e-mailů je dostupné pouze administrátorům.';
  end if;

  select jsonb_build_object(
    'configurationStatus', config.configuration_status,
    'settingsUiEnabled', config.settings_ui_enabled,
    'productionActivationEnabled', config.production_activation_enabled,
    'continuousPlanningEnabled', config.continuous_planning_enabled,
    'continuousDispatchEnabled', config.continuous_dispatch_enabled,
    'activeSelectorKey', config.active_selector_key,
    'selectorChangeRequiresPausedDispatch', config.selector_change_requires_paused_dispatch,
    'recipientMode', config.recipient_mode,
    'dailySendLimit', config.daily_send_limit,
    'hardDailySendLimit', config.hard_daily_send_limit,
    'monthlySendLimit', config.monthly_send_limit,
    'hardMonthlySendLimit', config.hard_monthly_send_limit,
    'minimumIntervalSeconds', config.minimum_interval_seconds,
    'reservationLeaseSeconds', config.reservation_lease_seconds,
    'accountingTimezone', config.accounting_timezone,
    'sendWindowStart', to_char(config.send_window_start, 'HH24:MI'),
    'sendWindowEnd', to_char(config.send_window_end, 'HH24:MI'),
    'sendWeekdays', to_jsonb(config.send_weekdays),
    'maximumOutageHorizonDays', config.maximum_outage_horizon_days,
    'minimumOutageLeadMinutes', config.minimum_outage_lead_minutes,
    'configurationVersion', config.configuration_version,
    'lastConfiguredAt', config.last_configured_at,
    'canEditNow', email_state.runtime_mode <> 'live'
      and not email_state.dispatch_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
  ) into result
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.set_cpo_notification_email_production_config_v1(
  requested_daily_send_limit integer,
  requested_monthly_send_limit integer,
  requested_minimum_interval_seconds integer,
  requested_send_window_start time without time zone,
  requested_send_window_end time without time zone,
  requested_send_weekdays smallint[],
  requested_maximum_outage_horizon_days integer,
  requested_minimum_outage_lead_minutes integer,
  requested_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '15s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  previous_config jsonb;
  resulting_config jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Produkční nastavení e-mailů může měnit pouze administrátor.';
  end if;

  if requested_reason is null
    or char_length(btrim(requested_reason)) < 3
    or char_length(btrim(requested_reason)) > 500 then
    raise exception 'Důvod změny musí mít 3 až 500 znaků.';
  end if;
  if requested_daily_send_limit not between 1 and 100 then
    raise exception 'Denní limit musí být mezi 1 a 100.';
  end if;
  if requested_monthly_send_limit < requested_daily_send_limit
    or requested_monthly_send_limit > 2500 then
    raise exception 'Měsíční limit musí být nejméně denní limit a nejvýše 2500.';
  end if;
  if requested_minimum_interval_seconds not between 60 and 3600 then
    raise exception 'Minimální rozestup musí být mezi 1 a 60 minutami.';
  end if;
  if requested_send_window_start is null
    or requested_send_window_end is null
    or requested_send_window_start >= requested_send_window_end then
    raise exception 'Odesílací okno nemá platný začátek a konec.';
  end if;
  if requested_send_weekdays is null
    or cardinality(requested_send_weekdays) not between 1 and 7
    or not requested_send_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
    or cardinality(requested_send_weekdays) <> (
      select count(distinct weekday)::integer
      from unnest(requested_send_weekdays) weekday
    ) then
    raise exception 'Vyberte jeden až sedm různých dnů v týdnu.';
  end if;
  if requested_maximum_outage_horizon_days not between 1 and 30 then
    raise exception 'Časový horizont odstávky musí být mezi 1 a 30 dny.';
  end if;
  if requested_minimum_outage_lead_minutes not between 0 and 4320 then
    raise exception 'Minimální předstih musí být mezi 0 a 72 hodinami.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('complete-notification-email-production-config-v1')
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
    raise exception 'Chybí stav produkční konfigurace e-mailů.';
  end if;
  if email_state.runtime_mode = 'live'
    or email_state.dispatch_enabled
    or config_row.continuous_planning_enabled
    or config_row.continuous_dispatch_enabled then
    raise exception 'Před změnou nastavení nejprve pozastavte ostré odesílání.';
  end if;
  if not config_row.settings_ui_enabled
    or config_row.production_activation_enabled then
    raise exception 'Produkční konfigurace není v bezpečném editačním režimu.';
  end if;

  previous_config := jsonb_build_object(
    'dailySendLimit', config_row.daily_send_limit,
    'monthlySendLimit', config_row.monthly_send_limit,
    'minimumIntervalSeconds', config_row.minimum_interval_seconds,
    'sendWindowStart', config_row.send_window_start,
    'sendWindowEnd', config_row.send_window_end,
    'sendWeekdays', config_row.send_weekdays,
    'maximumOutageHorizonDays', config_row.maximum_outage_horizon_days,
    'minimumOutageLeadMinutes', config_row.minimum_outage_lead_minutes,
    'activeSelectorKey', config_row.active_selector_key,
    'configurationVersion', config_row.configuration_version
  );

  update public.complete_power_outage_notification_email_production_config
  set daily_send_limit = requested_daily_send_limit,
      monthly_send_limit = requested_monthly_send_limit,
      minimum_interval_seconds = requested_minimum_interval_seconds,
      send_window_start = requested_send_window_start,
      send_window_end = requested_send_window_end,
      send_weekdays = requested_send_weekdays,
      maximum_outage_horizon_days = requested_maximum_outage_horizon_days,
      minimum_outage_lead_minutes = requested_minimum_outage_lead_minutes,
      configuration_version = configuration_version + 1,
      last_configured_at = now(),
      last_configured_by = auth.uid(),
      metadata = metadata || jsonb_build_object(
        'lastSettingsChangeAt', now(),
        'lastSettingsChangeBy', auth.uid(),
        'sendingChanged', false
      ),
      updated_at = now()
  where singleton
  returning * into config_row;

  resulting_config := jsonb_build_object(
    'dailySendLimit', config_row.daily_send_limit,
    'hardDailySendLimit', config_row.hard_daily_send_limit,
    'monthlySendLimit', config_row.monthly_send_limit,
    'hardMonthlySendLimit', config_row.hard_monthly_send_limit,
    'minimumIntervalSeconds', config_row.minimum_interval_seconds,
    'sendWindowStart', config_row.send_window_start,
    'sendWindowEnd', config_row.send_window_end,
    'sendWeekdays', config_row.send_weekdays,
    'maximumOutageHorizonDays', config_row.maximum_outage_horizon_days,
    'minimumOutageLeadMinutes', config_row.minimum_outage_lead_minutes,
    'activeSelectorKey', config_row.active_selector_key,
    'configurationVersion', config_row.configuration_version
  );

  insert into public.complete_power_outage_notification_email_production_config_events (
    event_kind,
    configuration_version,
    actor_user_id,
    previous_configuration,
    resulting_configuration,
    reason,
    metadata
  ) values (
    'settings_changed',
    config_row.configuration_version,
    auth.uid(),
    previous_config,
    resulting_config,
    btrim(requested_reason),
    jsonb_build_object(
      'contract', 'complete-notification-email-production-settings-v1',
      'sendingAttempted', false,
      'productionActivationChanged', false,
      'marketEmailIsolation', true
    )
  );

  return public.get_cpo_notification_email_production_config_v1();
end;
$$;

create or replace function public.get_cpo_notification_email_management_v2(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
begin
  return public.get_cpo_notification_email_management_v1(requested_limit)
    || jsonb_build_object(
      'contract', 'complete-notification-email-production-settings-ui-v1',
      'productionConfiguration',
        public.get_cpo_notification_email_production_config_v1(),
      'liveActivationAvailable', false
    );
end;
$$;

revoke all on function public.get_cpo_notification_email_production_config_v1()
  from public, anon;
revoke all on function public.set_cpo_notification_email_production_config_v1(
  integer,integer,integer,time without time zone,time without time zone,
  smallint[],integer,integer,text
) from public, anon;
revoke all on function public.get_cpo_notification_email_management_v2(integer)
  from public, anon;

grant execute on function public.get_cpo_notification_email_production_config_v1()
  to authenticated, service_role;
grant execute on function public.set_cpo_notification_email_production_config_v1(
  integer,integer,integer,time without time zone,time without time zone,
  smallint[],integer,integer,text
) to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_management_v2(integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

with definitions as (
  select
    pg_get_functiondef(
      'public.set_cpo_notification_email_production_config_v1(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)'::regprocedure
    ) as setter_definition,
    pg_get_functiondef(
      'public.get_cpo_notification_email_management_v2(integer)'::regprocedure
    ) as management_definition
), audit as (
  select 'FUNCTION'::text as check_type,
    'admin COMPLETE production email settings exist'::text as object_name,
    to_regprocedure(
      'public.set_cpo_notification_email_production_config_v1(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)'
    ) is not null as is_correct

  union all
  select 'FUNCTION', 'email management workspace contains production settings',
    management_definition ilike '%productionConfiguration%'
  from definitions

  union all
  select 'GRANT', 'production settings operations enforce administrator role',
    setter_definition ilike '%profile.role = ''admin''%'
      and not has_function_privilege(
        'anon',
        'public.set_cpo_notification_email_production_config_v1(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)',
        'EXECUTE'
      )
  from definitions

  union all
  select 'LOGIC', 'production settings can change only while dispatch is paused',
    setter_definition ilike '%email_state.runtime_mode = ''live''%'
      and setter_definition ilike '%email_state.dispatch_enabled%'
      and setter_definition ilike '%continuous_dispatch_enabled%'
  from definitions

  union all
  select 'LOGIC', 'admin limits remain bounded by immutable database ceilings',
    config.hard_daily_send_limit = 100
      and config.daily_send_limit <= config.hard_daily_send_limit
      and config.hard_monthly_send_limit = 2500
      and config.monthly_send_limit <= config.hard_monthly_send_limit
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'LOGIC', 'every settings change creates immutable audit evidence',
    setter_definition ilike '%production_config_events%'
      and setter_definition ilike '%previous_config%'
      and setter_definition ilike '%resulting_config%'
  from definitions

  union all
  select 'SAFETY', 'settings function cannot activate planning or dispatch',
    setter_definition not ilike '%production_activation_enabled =%'
      and setter_definition not ilike '%continuous_planning_enabled =%'
      and setter_definition not ilike '%continuous_dispatch_enabled =%'
      and setter_definition not ilike '%dispatch_enabled = true%'
  from definitions

  union all
  select 'SAFETY', 'step two leaves production activation unavailable',
    config.settings_ui_enabled
      and not config.production_activation_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'SAFETY', 'step two creates no sending schedule',
    not exists (
      select 1
      from cron.job job
      where job.jobname ilike '%complete%production%email%'
        or job.command ilike '%notification_email_production%send%'
    )

  union all
  select 'ISOLATION', 'production settings do not reference MARKET email objects',
    setter_definition not ilike '%power_outage_client_email_%'
  from definitions

  union all
  select 'STATE', 'existing COMPLETE dispatch remains disabled after settings install',
    email_state.runtime_mode <> 'live'
      and not email_state.dispatch_enabled
  from public.complete_power_outage_notification_email_state email_state
  where email_state.singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
