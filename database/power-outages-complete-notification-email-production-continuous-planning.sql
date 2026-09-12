begin;

-- Ostry provoz KOMPLETNI, krok 3: nepretrzite produkcni planovani.
-- Planner pouze udrzuje pripravenou frontu. Neumi rezervovat odesilaci slot,
-- volat Resend ani zapnout produkcni dispatch.
do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config_events') is null
    or to_regclass('public.complete_power_outage_notification_email_plans') is null
    or to_regprocedure('public.refresh_complete_power_outage_notification_email_plans_v1(integer)') is null
    or to_regprocedure('public.set_cpo_notification_email_production_config_v1(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)') is null then
    raise exception 'Chybi zavislosti pro nepretrzite planovani e-mailu KOMPLETNI.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
      and (state_row.runtime_mode = 'live' or state_row.dispatch_enabled)
  ) then
    raise exception 'Pred instalaci produkcniho planneru musi byt odesilani KOMPLETNI vypnute.';
  end if;
end
$$;

alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step2_activation_check;
alter table public.complete_power_outage_notification_email_production_config
  drop constraint if exists cpo_notification_email_production_step3_activation_check;

alter table public.complete_power_outage_notification_email_production_config_events
  drop constraint if exists cpo_notification_email_production_event_kind_check;
alter table public.complete_power_outage_notification_email_production_config_events
  add constraint cpo_notification_email_production_event_kind_check check (
    event_kind in (
      'foundation_installed', 'settings_changed', 'selector_changed',
      'planning_started', 'planning_paused'
    )
  );

do $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  previous_config jsonb;
  resulting_config jsonb;
begin
  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton
  for update;

  if config_row.singleton is null then
    raise exception 'Chybi produkcni konfigurace e-mailu KOMPLETNI.';
  end if;

  if not config_row.settings_ui_enabled
    or config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled then
    raise exception 'Produkční konfigurace neni v bezpecnem stavu pro zapnuti planneru.';
  end if;

  if not config_row.continuous_planning_enabled then
    previous_config := jsonb_build_object(
      'configurationStatus', config_row.configuration_status,
      'continuousPlanningEnabled', config_row.continuous_planning_enabled,
      'continuousDispatchEnabled', config_row.continuous_dispatch_enabled,
      'configurationVersion', config_row.configuration_version
    );

    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'ready',
        continuous_planning_enabled = true,
        continuous_dispatch_enabled = false,
        configuration_version = configuration_version + 1,
        metadata = metadata || jsonb_build_object(
          'continuousPlanningContract',
            'complete-notification-email-production-planning-v1',
          'continuousPlanningEnabledAt', now(),
          'sendingAttempted', false,
          'dispatchChanged', false
        ),
        updated_at = now()
    where singleton
    returning * into config_row;

    resulting_config := jsonb_build_object(
      'configurationStatus', config_row.configuration_status,
      'continuousPlanningEnabled', config_row.continuous_planning_enabled,
      'continuousDispatchEnabled', config_row.continuous_dispatch_enabled,
      'configurationVersion', config_row.configuration_version
    );

    insert into public.complete_power_outage_notification_email_production_config_events (
      event_kind, configuration_version, previous_configuration,
      resulting_configuration, reason, metadata
    ) values (
      'planning_started', config_row.configuration_version, previous_config,
      resulting_config,
      'Aktivace nepretrziteho produkcniho planovani bez odesilani.',
      jsonb_build_object(
        'contract', 'complete-notification-email-production-planning-v1',
        'sendingAttempted', false,
        'dispatchEnabled', false,
        'marketEmailIsolation', true
      )
    );
  end if;
end
$$;

alter table public.complete_power_outage_notification_email_production_config
  add constraint cpo_notification_email_production_step3_activation_check check (
    settings_ui_enabled
    and not production_activation_enabled
    and not continuous_dispatch_enabled
    and (
      (configuration_status = 'ready' and continuous_planning_enabled)
      or (configuration_status = 'paused' and not continuous_planning_enabled)
    )
  );

-- Aktivni planner sam o sobe nebrani zmene limitu. Odesilani vsak musi byt
-- stale vypnute a produkcni dispatch nesmi byt aktivni.
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
      and not config.continuous_dispatch_enabled
  ) into result
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

create or replace function public.set_cpo_notification_email_production_config_v2(
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
set statement_timeout = '20s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  planning_was_running boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Produkční nastavení e-mailů může měnit pouze administrátor.';
  end if;

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
    raise exception 'Chybí stav produkční konfigurace e-mailů.';
  end if;
  if email_state.runtime_mode = 'live'
    or email_state.dispatch_enabled
    or config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled then
    raise exception 'Před změnou nastavení nejprve pozastavte ostré odesílání.';
  end if;

  planning_was_running := config_row.continuous_planning_enabled;
  if planning_was_running then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        continuous_planning_enabled = false,
        updated_at = now()
    where singleton;
  end if;

  perform public.set_cpo_notification_email_production_config_v1(
    requested_daily_send_limit,
    requested_monthly_send_limit,
    requested_minimum_interval_seconds,
    requested_send_window_start,
    requested_send_window_end,
    requested_send_weekdays,
    requested_maximum_outage_horizon_days,
    requested_minimum_outage_lead_minutes,
    requested_reason
  );

  if planning_was_running then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'ready',
        continuous_planning_enabled = true,
        metadata = metadata || jsonb_build_object(
          'plannerResumedAfterSettingsChangeAt', now(),
          'sendingAttempted', false
        ),
        updated_at = now()
    where singleton;
  end if;

  return public.get_cpo_notification_email_production_config_v1();
end;
$$;

revoke all on function public.set_cpo_notification_email_production_config_v2(
  integer,integer,integer,time without time zone,time without time zone,
  smallint[],integer,integer,text
) from public, anon;
grant execute on function public.set_cpo_notification_email_production_config_v2(
  integer,integer,integer,time without time zone,time without time zone,
  smallint[],integer,integer,text
) to authenticated, service_role;

-- Scope se vynucuje primo pri kazdem INSERT/UPDATE planu. Stary planner tak
-- zustava jedinym zdrojem deduplikace, ale mimo nastaveny produkcni horizont
-- nikdy nevytvori odeslatelny plan.
create or replace function public.enforce_cpo_notification_email_production_plan_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  lower_boundary timestamptz;
  upper_boundary timestamptz;
begin
  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton;

  if config_row.singleton is null or not config_row.continuous_planning_enabled then
    return new;
  end if;

  lower_boundary := now()
    + make_interval(mins => config_row.minimum_outage_lead_minutes);
  upper_boundary := now()
    + make_interval(days => config_row.maximum_outage_horizon_days);

  if new.plan_status in ('shadow_ready', 'suppressed') and (
    new.selector_key <> config_row.active_selector_key
    or new.starts_at_snapshot < lower_boundary
    or new.starts_at_snapshot > upper_boundary
  ) then
    new.plan_status := 'out_of_scope';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'productionScopeApplied', true,
      'productionScopeContract',
        'complete-notification-email-production-planning-v1',
      'sendingAttempted', false
    );
  elsif new.plan_status in ('shadow_ready', 'suppressed') then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'productionScopeApplied', true,
      'productionScopeContract',
        'complete-notification-email-production-planning-v1',
      'sendingAttempted', false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_notification_email_production_plan_scope
  on public.complete_power_outage_notification_email_plans;
create trigger cpo_notification_email_production_plan_scope
before insert or update
on public.complete_power_outage_notification_email_plans
for each row execute function
  public.enforce_cpo_notification_email_production_plan_scope_v1();

revoke all on function
  public.enforce_cpo_notification_email_production_plan_scope_v1()
  from public, anon, authenticated;
grant execute on function
  public.enforce_cpo_notification_email_production_plan_scope_v1()
  to service_role;

create or replace function public.run_cpo_notification_email_production_planner_v1(
  requested_limit integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '45s'
as $$
declare
  config_row public.complete_power_outage_notification_email_production_config%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  contact_state public.complete_power_outage_contact_discovery_state%rowtype;
  planner_result jsonb;
begin
  if requested_limit < 1 or requested_limit > 5000 then
    raise exception 'Velikost planovaci davky musi byt mezi 1 a 5000.';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_production_planner_v1', 0)
  ) then
    return jsonb_build_object(
      'status', 'skipped', 'reason', 'already_running',
      'sendingAttempted', false
    );
  end if;

  select * into config_row
  from public.complete_power_outage_notification_email_production_config
  where singleton;
  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;
  select * into contact_state
  from public.complete_power_outage_contact_discovery_state
  where singleton;

  if config_row.singleton is null
    or not config_row.continuous_planning_enabled
    or config_row.configuration_status <> 'ready' then
    return jsonb_build_object(
      'status', 'paused', 'plannedCount', 0,
      'sendingAttempted', false
    );
  end if;

  if config_row.production_activation_enabled
    or config_row.continuous_dispatch_enabled
    or email_state.runtime_mode <> 'shadow'
    or not email_state.planning_enabled
    or email_state.dispatch_enabled then
    raise exception 'Produkční planner odmitl nebezpecnou kombinaci runtime stavu.';
  end if;

  if contact_state.singleton is null
    or config_row.active_selector_key <> contact_state.selected_selector_key
    or email_state.active_selector_key <> config_row.active_selector_key then
    raise exception 'Zdrojovy filtr planneru neni synchronizovan s pripravenym vyberem kontaktu.';
  end if;

  planner_result :=
    public.refresh_complete_power_outage_notification_email_plans_v1(requested_limit);

  -- Existujici aktualni plany se pri prvnim behu okamzite srovnaji podle
  -- nastaveneho zdroje a casoveho rozsahu. Trigger hlida vsechny dalsi zapisy.
  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'out_of_scope',
      metadata = plan.metadata || jsonb_build_object(
        'productionScopeApplied', true,
        'productionScopeContract',
          'complete-notification-email-production-planning-v1',
        'sendingAttempted', false
      )
  where plan.plan_status in ('shadow_ready', 'suppressed')
    and (
      plan.selector_key <> config_row.active_selector_key
      or plan.starts_at_snapshot < now()
        + make_interval(mins => config_row.minimum_outage_lead_minutes)
      or plan.starts_at_snapshot > now()
        + make_interval(days => config_row.maximum_outage_horizon_days)
    );

  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;

  if coalesce(planner_result ->> 'status', '') = 'failed'
    or email_state.runtime_mode = 'paused'
    or not email_state.planning_enabled then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        continuous_planning_enabled = false,
        metadata = metadata || jsonb_build_object(
          'continuousPlanningPausedAt', now(),
          'continuousPlanningPauseReason',
            coalesce(planner_result ->> 'errorCode', 'planner_runtime_paused'),
          'sendingAttempted', false
        ),
        updated_at = now()
    where singleton;
  end if;

  return planner_result || jsonb_build_object(
    'productionPlanning', true,
    'productionDispatchEnabled', false,
    'sendingAttempted', false
  );
exception
  when others then
    update public.complete_power_outage_notification_email_production_config
    set configuration_status = 'paused',
        continuous_planning_enabled = false,
        metadata = metadata || jsonb_build_object(
          'continuousPlanningPausedAt', now(),
          'continuousPlanningPauseReason', left(sqlerrm, 1000),
          'sendingAttempted', false
        ),
        updated_at = now()
    where singleton;

    return jsonb_build_object(
      'status', 'failed',
      'errorCode', 'COMPLETE_PRODUCTION_PLANNER_FAILED',
      'errorMessage', sqlerrm,
      'productionDispatchEnabled', false,
      'sendingAttempted', false
    );
end;
$$;

revoke all on function
  public.run_cpo_notification_email_production_planner_v1(integer)
  from public, anon, authenticated;
grant execute on function
  public.run_cpo_notification_email_production_planner_v1(integer)
  to service_role;

-- Stav pilotu po jeho dokonceni zustava SHADOW; produkcni planner smi pouze
-- doplnovat plany. Dispatch ani rezervace se timto krokem nezapnou.
update public.complete_power_outage_notification_email_state as email_state
set runtime_mode = 'shadow',
    planning_enabled = true,
    dispatch_enabled = false,
    active_selector_key = production_config.active_selector_key,
    metadata = email_state.metadata || jsonb_build_object(
      'continuousProductionPlanningContract',
        'complete-notification-email-production-planning-v1',
      'continuousProductionPlanningEnabledAt', now(),
      'sendingAttempted', false
    ),
    updated_at = now()
from public.complete_power_outage_notification_email_production_config
  production_config
where email_state.singleton
  and production_config.singleton;

do $$
declare existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in (
      'complete_notification_email_shadow_planning_every_minute',
      'complete_notification_email_production_planning_every_minute'
    )
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'complete_notification_email_production_planning_every_minute',
    '* * * * *',
    $job$select public.run_cpo_notification_email_production_planner_v1(1000);$job$
  );
end
$$;

select public.run_cpo_notification_email_production_planner_v1(1000);

notify pgrst, 'reload schema';
commit;

with definitions as (
  select
    pg_get_functiondef(
      'public.run_cpo_notification_email_production_planner_v1(integer)'::regprocedure
    ) as planner_definition,
    pg_get_functiondef(
      'public.enforce_cpo_notification_email_production_plan_scope_v1()'::regprocedure
    ) as scope_definition,
    pg_get_functiondef(
      'public.set_cpo_notification_email_production_config_v2(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)'::regprocedure
    ) as setter_definition
), audit as (
  select 'FUNCTION'::text as check_type,
    'continuous COMPLETE production planner exists'::text as object_name,
    to_regprocedure(
      'public.run_cpo_notification_email_production_planner_v1(integer)'
    ) is not null as is_correct

  union all
  select 'FUNCTION', 'production planning scope guard exists',
    to_regprocedure(
      'public.enforce_cpo_notification_email_production_plan_scope_v1()'
    ) is not null

  union all
  select 'FUNCTION', 'admin settings remain editable while only planning runs',
    to_regprocedure(
      'public.set_cpo_notification_email_production_config_v2(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)'
    ) is not null

  union all
  select 'GRANT', 'production planning settings remain administrator guarded',
    setter_definition ilike '%profile.role = ''admin''%'
      and not has_function_privilege(
        'anon',
        'public.set_cpo_notification_email_production_config_v2(integer,integer,integer,time without time zone,time without time zone,smallint[],integer,integer,text)',
        'EXECUTE'
      )
  from definitions

  union all
  select 'CRON', 'continuous COMPLETE production planning runs every minute',
    count(*) = 1
      and bool_and(job.schedule = '* * * * *')
      and bool_and(job.command ilike
        '%run_cpo_notification_email_production_planner_v1%')
  from cron.job job
  where job.jobname =
    'complete_notification_email_production_planning_every_minute'

  union all
  select 'CRON', 'obsolete COMPLETE SHADOW planning schedule is absent',
    not exists (
      select 1 from cron.job job
      where job.jobname =
        'complete_notification_email_shadow_planning_every_minute'
    )

  union all
  select 'GRANT', 'authenticated cannot run production planner',
    not has_function_privilege(
      'authenticated',
      'public.run_cpo_notification_email_production_planner_v1(integer)',
      'EXECUTE'
    )

  union all
  select 'ISOLATION', 'production planner does not reference MARKET email objects',
    planner_definition not ilike '%power_outage_client_email_%'
  from definitions

  union all
  select 'LOGIC', 'production planner enforces configured selector and horizon',
    planner_definition ilike '%active_selector_key%'
      and scope_definition ilike '%minimum_outage_lead_minutes%'
      and scope_definition ilike '%maximum_outage_horizon_days%'
  from definitions

  union all
  select 'LOGIC', 'production planner pauses safely after runtime failure',
    planner_definition ilike '%continuous_planning_enabled = false%'
      and planner_definition ilike '%configuration_status = ''paused''%'
  from definitions

  union all
  select 'LOGIC', 'settings changes pause and resume planner atomically',
    setter_definition ilike '%planning_was_running%'
      and setter_definition ilike '%configuration_status = ''paused''%'
      and setter_definition ilike '%configuration_status = ''ready''%'
  from definitions

  union all
  select 'DATA', 'ready production plans stay inside configured scope',
    not exists (
      select 1
      from public.complete_power_outage_notification_email_plans plan
      cross join public.complete_power_outage_notification_email_production_config config
      where config.singleton
        and plan.plan_status = 'shadow_ready'
        and (
          plan.selector_key <> config.active_selector_key
          or plan.starts_at_snapshot < now()
            + make_interval(mins => config.minimum_outage_lead_minutes)
          or plan.starts_at_snapshot > now()
            + make_interval(days => config.maximum_outage_horizon_days)
        )
    )

  union all
  select 'SAFETY', 'continuous planner cannot enable or invoke dispatch',
    planner_definition not ilike '%dispatch_enabled = true%'
      and planner_definition not ilike '%reserve_complete%'
      and planner_definition not ilike '%resend%'
      and planner_definition not ilike '%http%'
  from definitions

  union all
  select 'SAFETY', 'production dispatcher remains disabled',
    not config.production_activation_enabled
      and not config.continuous_dispatch_enabled
      and not email_state.dispatch_enabled
      and email_state.runtime_mode = 'shadow'
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton

  union all
  select 'STATE', 'continuous production planning is active without sending',
    config.configuration_status = 'ready'
      and config.continuous_planning_enabled
      and email_state.planning_enabled
      and not email_state.dispatch_enabled
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
