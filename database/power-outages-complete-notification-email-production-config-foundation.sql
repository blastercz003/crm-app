begin;

-- Ostry provoz KOMPLETNI, krok 1: pouze konfiguracni zaklad.
-- Tento soubor nevytvari worker ani cron, neposkytuje admin operaci pro zmenu
-- nastaveni a neumoznuje planovani ani odesilani produkcnich zprav.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'COMPLETE email state');
  end if;
  if to_regclass('public.complete_power_outage_contact_discovery_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'contact discovery state');
  end if;
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null then
    missing_dependencies := array_append(missing_dependencies, 'contact selector registry');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_rate_limit_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'audited pilot rate limiter');
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    missing_dependencies := array_append(missing_dependencies, 'updated_at trigger');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro produkcni konfiguraci e-mailu KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;

  if exists (
    select 1
    from public.complete_power_outage_notification_email_state state_row
    where state_row.singleton
      and (state_row.runtime_mode = 'live' or state_row.dispatch_enabled)
  ) then
    raise exception 'Pred instalaci produkcni konfigurace musi byt odesilani KOMPLETNI pozastaveno.';
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_production_config (
  singleton boolean primary key default true check (singleton),
  configuration_status text not null default 'draft',
  settings_ui_enabled boolean not null default false,
  production_activation_enabled boolean not null default false,
  continuous_planning_enabled boolean not null default false,
  continuous_dispatch_enabled boolean not null default false,
  active_selector_key text not null
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  selector_change_requires_paused_dispatch boolean not null default true,
  recipient_mode text not null default 'automatic_eligible_primary',
  daily_send_limit integer not null default 10,
  hard_daily_send_limit integer not null default 100,
  monthly_send_limit integer not null default 300,
  hard_monthly_send_limit integer not null default 2500,
  minimum_interval_seconds integer not null default 300,
  reservation_lease_seconds integer not null default 120,
  accounting_timezone text not null default 'Europe/Prague',
  send_window_start time without time zone not null default time '07:00',
  send_window_end time without time zone not null default time '18:00',
  send_weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  maximum_outage_horizon_days integer not null default 30,
  minimum_outage_lead_minutes integer not null default 0,
  configuration_version integer not null default 1,
  last_configured_at timestamptz,
  last_configured_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_notification_email_production_status_check check (
    configuration_status in ('draft', 'ready', 'paused', 'live')
  ),
  constraint cpo_notification_email_production_step1_activation_check check (
    configuration_status = 'draft'
    and not settings_ui_enabled
    and not production_activation_enabled
    and not continuous_planning_enabled
    and not continuous_dispatch_enabled
  ),
  constraint cpo_notification_email_production_selector_lock_check check (
    selector_change_requires_paused_dispatch
  ),
  constraint cpo_notification_email_production_recipient_check check (
    recipient_mode = 'automatic_eligible_primary'
  ),
  constraint cpo_notification_email_production_daily_limit_check check (
    daily_send_limit between 1 and hard_daily_send_limit
    and hard_daily_send_limit = 100
  ),
  constraint cpo_notification_email_production_monthly_limit_check check (
    monthly_send_limit between daily_send_limit and hard_monthly_send_limit
    and hard_monthly_send_limit = 2500
  ),
  constraint cpo_notification_email_production_interval_check check (
    minimum_interval_seconds between 60 and 3600
  ),
  constraint cpo_notification_email_production_lease_check check (
    reservation_lease_seconds between 30 and 300
  ),
  constraint cpo_notification_email_production_timezone_check check (
    accounting_timezone = 'Europe/Prague'
  ),
  constraint cpo_notification_email_production_window_check check (
    send_window_start < send_window_end
  ),
  constraint cpo_notification_email_production_weekdays_check check (
    cardinality(send_weekdays) between 1 and 7
    and send_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint cpo_notification_email_production_horizon_check check (
    maximum_outage_horizon_days between 1 and 30
    and minimum_outage_lead_minutes between 0 and 4320
  ),
  constraint cpo_notification_email_production_version_check check (
    configuration_version > 0
  ),
  constraint cpo_notification_email_production_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

insert into public.complete_power_outage_notification_email_production_config (
  singleton,
  active_selector_key,
  metadata
)
select
  true,
  contact_state.selected_selector_key,
  jsonb_build_object(
    'contract', 'complete-notification-email-production-config-v1',
    'foundationOnly', true,
    'adminMutationAvailable', false,
    'productionActivationAvailable', false,
    'marketEmailIsolation', true,
    'defaultDailySendLimit', 10,
    'hardDailySendLimit', 100,
    'defaultMonthlySendLimit', 300,
    'hardMonthlySendLimit', 2500,
    'installedAt', now()
  )
from public.complete_power_outage_contact_discovery_state contact_state
where contact_state.singleton
on conflict (singleton) do nothing;

drop trigger if exists cpo_notification_email_production_config_set_updated_at
  on public.complete_power_outage_notification_email_production_config;
create trigger cpo_notification_email_production_config_set_updated_at
before update on public.complete_power_outage_notification_email_production_config
for each row execute function public.set_power_outage_updated_at();

create table if not exists public.complete_power_outage_notification_email_production_config_events (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null,
  configuration_version integer not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  previous_configuration jsonb,
  resulting_configuration jsonb not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_notification_email_production_event_kind_check check (
    event_kind in ('foundation_installed', 'settings_changed', 'selector_changed')
  ),
  constraint cpo_notification_email_production_event_version_check check (
    configuration_version > 0
  ),
  constraint cpo_notification_email_production_event_previous_check check (
    previous_configuration is null
    or jsonb_typeof(previous_configuration) = 'object'
  ),
  constraint cpo_notification_email_production_event_result_check check (
    jsonb_typeof(resulting_configuration) = 'object'
  ),
  constraint cpo_notification_email_production_event_reason_check check (
    btrim(reason) <> ''
  ),
  constraint cpo_notification_email_production_event_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create or replace function public.prevent_cpo_notification_email_production_config_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie produkcni konfigurace e-mailu KOMPLETNI je nemenna.';
end;
$$;

drop trigger if exists cpo_notification_email_production_config_events_immutable
  on public.complete_power_outage_notification_email_production_config_events;
create trigger cpo_notification_email_production_config_events_immutable
before update or delete
on public.complete_power_outage_notification_email_production_config_events
for each row execute function public.prevent_cpo_notification_email_production_config_event_mutation();

insert into public.complete_power_outage_notification_email_production_config_events (
  event_kind,
  configuration_version,
  resulting_configuration,
  reason,
  metadata
)
select
  'foundation_installed',
  config.configuration_version,
  jsonb_build_object(
    'configurationStatus', config.configuration_status,
    'activeSelectorKey', config.active_selector_key,
    'recipientMode', config.recipient_mode,
    'dailySendLimit', config.daily_send_limit,
    'hardDailySendLimit', config.hard_daily_send_limit,
    'monthlySendLimit', config.monthly_send_limit,
    'hardMonthlySendLimit', config.hard_monthly_send_limit,
    'minimumIntervalSeconds', config.minimum_interval_seconds,
    'accountingTimezone', config.accounting_timezone,
    'sendWindowStart', config.send_window_start,
    'sendWindowEnd', config.send_window_end,
    'sendWeekdays', config.send_weekdays,
    'maximumOutageHorizonDays', config.maximum_outage_horizon_days,
    'minimumOutageLeadMinutes', config.minimum_outage_lead_minutes,
    'productionActivationEnabled', config.production_activation_enabled,
    'continuousPlanningEnabled', config.continuous_planning_enabled,
    'continuousDispatchEnabled', config.continuous_dispatch_enabled
  ),
  'Instalace konfiguracniho zakladu bez aktivace odesilani.',
  jsonb_build_object(
    'contract', 'complete-notification-email-production-config-v1',
    'foundationOnly', true,
    'sendingAttempted', false,
    'marketEmailIsolation', true
  )
from public.complete_power_outage_notification_email_production_config config
where config.singleton
  and not exists (
    select 1
    from public.complete_power_outage_notification_email_production_config_events event
    where event.event_kind = 'foundation_installed'
      and event.metadata ->> 'contract' = 'complete-notification-email-production-config-v1'
  );

alter table public.complete_power_outage_notification_email_production_config
  enable row level security;
alter table public.complete_power_outage_notification_email_production_config_events
  enable row level security;

revoke all on table public.complete_power_outage_notification_email_production_config
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_production_config_events
  from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_production_config
  to service_role;
grant all on table public.complete_power_outage_notification_email_production_config_events
  to service_role;

revoke all on function public.prevent_cpo_notification_email_production_config_event_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_cpo_notification_email_production_config_event_mutation()
  to service_role;

notify pgrst, 'reload schema';
commit;

with audit as (
  select
    'TABLE'::text as check_type,
    'independent COMPLETE production email configuration exists'::text as object_name,
    to_regclass('public.complete_power_outage_notification_email_production_config') is not null
      as is_correct

  union all
  select 'TABLE', 'append only COMPLETE production configuration history exists',
    to_regclass('public.complete_power_outage_notification_email_production_config_events') is not null
      and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid =
          'public.complete_power_outage_notification_email_production_config_events'::regclass
          and trigger_row.tgname =
            'cpo_notification_email_production_config_events_immutable'
          and not trigger_row.tgisinternal
      )

  union all
  select 'RLS', 'COMPLETE production configuration tables have RLS',
    bool_and(table_row.relrowsecurity)
  from pg_class table_row
  where table_row.oid in (
    'public.complete_power_outage_notification_email_production_config'::regclass,
    'public.complete_power_outage_notification_email_production_config_events'::regclass
  )

  union all
  select 'GRANT', 'authenticated cannot inspect or mutate production email configuration',
    not has_table_privilege(
      'authenticated',
      'public.complete_power_outage_notification_email_production_config',
      'SELECT'
    )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_notification_email_production_config',
        'UPDATE'
      )
      and not has_table_privilege(
        'authenticated',
        'public.complete_power_outage_notification_email_production_config_events',
        'SELECT'
      )

  union all
  select 'DATA', 'production configuration starts with conservative limits',
    config.daily_send_limit = 10
      and config.monthly_send_limit = 300
      and config.minimum_interval_seconds = 300
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'LOGIC', 'database hard ceilings are independent from future admin settings',
    config.hard_daily_send_limit = 100
      and config.daily_send_limit <= config.hard_daily_send_limit
      and config.hard_monthly_send_limit = 2500
      and config.monthly_send_limit <= config.hard_monthly_send_limit
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'LOGIC', 'production accounting and send window use Prague time',
    config.accounting_timezone = 'Europe/Prague'
      and config.send_window_start = time '07:00'
      and config.send_window_end = time '18:00'
      and config.send_weekdays = array[1,2,3,4,5]::smallint[]
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'LOGIC', 'production source starts on the prepared contact selector',
    config.active_selector_key = contact_state.selected_selector_key
      and config.selector_change_requires_paused_dispatch
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_contact_discovery_state contact_state
  where config.singleton and contact_state.singleton

  union all
  select 'ISOLATION', 'production configuration is independent from MARKET email objects',
    pg_get_functiondef(
      'public.prevent_cpo_notification_email_production_config_event_mutation()'::regprocedure
    ) not ilike '%market%'

  union all
  select 'SAFETY', 'production email activation and continuous processing remain disabled',
    config.configuration_status = 'draft'
      and not config.settings_ui_enabled
      and not config.production_activation_enabled
      and not config.continuous_planning_enabled
      and not config.continuous_dispatch_enabled
  from public.complete_power_outage_notification_email_production_config config
  where config.singleton

  union all
  select 'SAFETY', 'existing COMPLETE dispatch remains disabled',
    state_row.runtime_mode <> 'live'
      and not state_row.dispatch_enabled
  from public.complete_power_outage_notification_email_state state_row
  where state_row.singleton

  union all
  select 'SAFETY', 'step one creates no production sending schedule',
    not exists (
      select 1
      from cron.job job
      where job.jobname ilike '%complete%production%email%'
        or job.command ilike '%notification_email_production%send%'
    )

  union all
  select 'SAFETY', 'foundation event records no sending attempt',
    count(*) = 1
      and bool_and(event.metadata ->> 'sendingAttempted' = 'false')
  from public.complete_power_outage_notification_email_production_config_events event
  where event.event_kind = 'foundation_installed'
    and event.metadata ->> 'contract' = 'complete-notification-email-production-config-v1'
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
