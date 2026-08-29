begin;

alter table public.weather_notification_preferences
  add column if not exists extended_notifications_enabled boolean not null default false;

alter table public.weather_notification_preferences
  drop constraint if exists weather_notification_preferences_extended_requires_enabled;

alter table public.weather_notification_preferences
  add constraint weather_notification_preferences_extended_requires_enabled
  check (not extended_notifications_enabled or notifications_enabled);

comment on column public.weather_notification_preferences.extended_notifications_enabled is
  'Zapíná strukturované signály z výhledu ČHMÚ a denní meteorologický přehled v 09:00 Europe/Prague.';

create table if not exists public.weather_insight_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null,
  phenomenon_key text,
  source_key text not null,
  dedupe_key text not null,
  delivery_status text not null,
  notification_id uuid references public.notifications(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weather_insight_notification_deliveries_signal_check
    check (signal_type in ('forecast', 'daily_summary')),
  constraint weather_insight_notification_deliveries_status_check
    check (delivery_status in ('created', 'deduplicated', 'failed')),
  constraint weather_insight_notification_deliveries_dedupe_unique
    unique (dedupe_key)
);

comment on table public.weather_insight_notification_deliveries is
  'Audit rozšířených meteorologických upozornění odeslaných běžným notifikačním kanálem aplikace a PWA.';

create index if not exists weather_insight_notification_deliveries_user_idx
  on public.weather_insight_notification_deliveries
  (user_id, signal_type, created_at desc);

create index if not exists weather_insight_notification_deliveries_cooldown_idx
  on public.weather_insight_notification_deliveries
  (user_id, phenomenon_key, created_at desc)
  where signal_type = 'forecast';

alter table public.weather_insight_notification_deliveries enable row level security;

drop policy if exists weather_insight_notification_deliveries_authorized_read
  on public.weather_insight_notification_deliveries;

create policy weather_insight_notification_deliveries_authorized_read
  on public.weather_insight_notification_deliveries
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

revoke all on table public.weather_insight_notification_deliveries
  from public, anon, authenticated;
grant select on table public.weather_insight_notification_deliveries
  to authenticated;
grant all on table public.weather_insight_notification_deliveries
  to service_role;

do $$
begin
  if exists (
    select 1
    from pg_extension
    where extname = 'pg_cron'
  ) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'weather_insights_observations_every_ten_minutes';

    perform cron.schedule(
      'weather_insights_observations_every_ten_minutes',
      '0-59/10 * * * *',
      $job$select public.request_weather_insights_endpoint('/api/weather-insights/observations/sync');$job$
    );
  end if;
end
$$;

commit;

select
  'COLUMN' as check_type,
  'weather_notification_preferences.extended_notifications_enabled' as object_name,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weather_notification_preferences'
      and column_name = 'extended_notifications_enabled'
  ) as is_correct
union all
select
  'TABLE',
  'weather_insight_notification_deliveries',
  to_regclass('public.weather_insight_notification_deliveries') is not null
union all
select
  'RLS',
  'weather_insight_notification_deliveries',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.weather_insight_notification_deliveries'::regclass
  ), false)
union all
select
  'CRON',
  'weather_insights_observations_every_ten_minutes at minute 00',
  coalesce((
    select active and schedule = '0-59/10 * * * *'
    from cron.job
    where jobname = 'weather_insights_observations_every_ten_minutes'
    limit 1
  ), false)
order by check_type, object_name;
