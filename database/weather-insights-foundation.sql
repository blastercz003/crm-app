begin;

create extension if not exists pgcrypto;

create table if not exists public.weather_feed_state (
  feed_key text primary key,
  source text not null default 'chmi',
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_change_at timestamptz,
  latest_source_ref text,
  latest_payload_sha256 text,
  consecutive_failure_count integer not null default 0,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  data_version bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weather_feed_state_feed_key_check
    check (feed_key in ('radar', 'observations', 'forecast')),
  constraint weather_feed_state_failure_count_check
    check (consecutive_failure_count >= 0),
  constraint weather_feed_state_data_version_check
    check (data_version >= 0),
  constraint weather_feed_state_payload_hash_check
    check (
      latest_payload_sha256 is null
      or latest_payload_sha256 ~ '^[a-f0-9]{64}$'
    )
);

comment on table public.weather_feed_state is
  'Nezávislý provozní stav doplňkových datových kanálů ČHMÚ.';

insert into public.weather_feed_state (feed_key)
values ('radar'), ('observations'), ('forecast')
on conflict (feed_key) do nothing;

create table if not exists public.weather_radar_frames (
  id uuid primary key default gen_random_uuid(),
  product_key text not null default 'pseudocappi_2km',
  frame_kind text not null,
  source_file_name text not null,
  source_url text not null,
  source_timestamp timestamptz not null,
  valid_at timestamptz not null,
  lead_minutes integer not null default 0,
  storage_bucket text not null default 'weather-radar',
  storage_path text not null,
  content_type text not null,
  payload_sha256 text not null,
  byte_size integer not null,
  width_px integer,
  height_px integer,
  projection text not null default 'EPSG:3857',
  bounds jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint weather_radar_frames_kind_check
    check (frame_kind in ('observation', 'forecast')),
  constraint weather_radar_frames_lead_check
    check (
      (frame_kind = 'observation' and lead_minutes = 0)
      or (frame_kind = 'forecast' and lead_minutes between 1 and 180)
    ),
  constraint weather_radar_frames_content_type_check
    check (content_type in ('image/png', 'image/webp')),
  constraint weather_radar_frames_payload_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint weather_radar_frames_byte_size_check
    check (byte_size > 0 and byte_size <= 8388608),
  constraint weather_radar_frames_dimensions_check
    check (
      (width_px is null and height_px is null)
      or (width_px > 0 and height_px > 0)
    ),
  constraint weather_radar_frames_bounds_check
    check (jsonb_typeof(bounds) = 'object'),
  constraint weather_radar_frames_source_unique
    unique (product_key, source_file_name),
  constraint weather_radar_frames_storage_unique
    unique (storage_bucket, storage_path)
);

comment on table public.weather_radar_frames is
  'Metadata bezpečně uložených měřených a krátkodobě předpovědních radarových snímků ČHMÚ.';

create index if not exists weather_radar_frames_timeline_idx
  on public.weather_radar_frames (valid_at desc, frame_kind);

create index if not exists weather_radar_frames_created_idx
  on public.weather_radar_frames (created_at desc);

create table if not exists public.weather_observation_extremes (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null,
  period_start_at timestamptz,
  period_end_at timestamptz,
  metric_key text not null,
  extremum_kind text not null,
  rank_position smallint not null default 1,
  station_code text not null,
  station_name text not null,
  region_name text,
  latitude double precision,
  longitude double precision,
  value double precision not null,
  unit text not null,
  source_file_name text not null,
  source_url text not null,
  payload_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint weather_observation_extremes_metric_check
    check (metric_key in (
      'temperature_max',
      'temperature_min',
      'wind_gust_max',
      'precipitation_max'
    )),
  constraint weather_observation_extremes_kind_check
    check (extremum_kind in ('maximum', 'minimum')),
  constraint weather_observation_extremes_rank_check
    check (rank_position between 1 and 10),
  constraint weather_observation_extremes_period_check
    check (
      period_start_at is null
      or period_end_at is null
      or period_end_at >= period_start_at
    ),
  constraint weather_observation_extremes_coordinates_check
    check (
      (latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180)
    ),
  constraint weather_observation_extremes_payload_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint weather_observation_extremes_snapshot_unique
    unique (snapshot_at, metric_key, extremum_kind, rank_position)
);

comment on table public.weather_observation_extremes is
  'Agregované extrémy na sledovaných profesionálních stanicích ČHMÚ.';

create index if not exists weather_observation_extremes_snapshot_idx
  on public.weather_observation_extremes (snapshot_at desc, metric_key, rank_position);

create table if not exists public.weather_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  issued_at timestamptz not null,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  scope_type text not null,
  region_code text not null default 'CZ',
  region_name text not null default 'Česká republika',
  period_key text not null,
  headline text,
  text_weather text,
  text_wind text,
  dangerous_phenomena jsonb not null default '[]'::jsonb,
  relevant_phenomena jsonb not null default '[]'::jsonb,
  source_file_name text not null,
  source_url text not null,
  payload_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint weather_forecast_snapshots_scope_check
    check (scope_type in ('national', 'regional')),
  constraint weather_forecast_snapshots_period_check
    check (valid_to > valid_from),
  constraint weather_forecast_snapshots_phenomena_check
    check (
      jsonb_typeof(dangerous_phenomena) = 'array'
      and jsonb_typeof(relevant_phenomena) = 'array'
    ),
  constraint weather_forecast_snapshots_payload_hash_check
    check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  constraint weather_forecast_snapshots_source_unique
    unique (payload_sha256, scope_type, region_code, period_key)
);

comment on table public.weather_forecast_snapshots is
  'Strukturovaný krátkodobý výhled nebezpečných jevů z předpovědních dat ČHMÚ.';

create index if not exists weather_forecast_snapshots_validity_idx
  on public.weather_forecast_snapshots (valid_from, valid_to, issued_at desc);

create index if not exists weather_forecast_snapshots_region_idx
  on public.weather_forecast_snapshots (scope_type, region_code, issued_at desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'weather-radar',
  'weather-radar',
  false,
  8388608,
  array['image/png', 'image/webp']
)
on conflict (id) do nothing;

alter table public.weather_feed_state enable row level security;
alter table public.weather_radar_frames enable row level security;
alter table public.weather_observation_extremes enable row level security;
alter table public.weather_forecast_snapshots enable row level security;

drop policy if exists weather_feed_state_authorized_read
  on public.weather_feed_state;
create policy weather_feed_state_authorized_read
  on public.weather_feed_state
  for select
  to authenticated
  using (public.current_user_can_view_weather_alerts());

drop policy if exists weather_radar_frames_authorized_read
  on public.weather_radar_frames;
create policy weather_radar_frames_authorized_read
  on public.weather_radar_frames
  for select
  to authenticated
  using (public.current_user_can_view_weather_alerts());

drop policy if exists weather_observation_extremes_authorized_read
  on public.weather_observation_extremes;
create policy weather_observation_extremes_authorized_read
  on public.weather_observation_extremes
  for select
  to authenticated
  using (public.current_user_can_view_weather_alerts());

drop policy if exists weather_forecast_snapshots_authorized_read
  on public.weather_forecast_snapshots;
create policy weather_forecast_snapshots_authorized_read
  on public.weather_forecast_snapshots
  for select
  to authenticated
  using (public.current_user_can_view_weather_alerts());

revoke all on table public.weather_feed_state from public, anon, authenticated;
revoke all on table public.weather_radar_frames from public, anon, authenticated;
revoke all on table public.weather_observation_extremes from public, anon, authenticated;
revoke all on table public.weather_forecast_snapshots from public, anon, authenticated;

grant select on table public.weather_feed_state to authenticated;
grant select on table public.weather_radar_frames to authenticated;
grant select on table public.weather_observation_extremes to authenticated;
grant select on table public.weather_forecast_snapshots to authenticated;

grant all on table public.weather_feed_state to service_role;
grant all on table public.weather_radar_frames to service_role;
grant all on table public.weather_observation_extremes to service_role;
grant all on table public.weather_forecast_snapshots to service_role;

create or replace function public.purge_weather_insight_history(
  radar_before timestamptz default now() - interval '2 hours',
  observations_before timestamptz default now() - interval '7 days',
  forecast_before timestamptz default now() - interval '7 days'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_radar integer;
  deleted_observations integer;
  deleted_forecasts integer;
begin
  delete from public.weather_radar_frames
  where valid_at < radar_before;
  get diagnostics deleted_radar = row_count;

  delete from public.weather_observation_extremes
  where snapshot_at < observations_before;
  get diagnostics deleted_observations = row_count;

  delete from public.weather_forecast_snapshots
  where valid_to < forecast_before;
  get diagnostics deleted_forecasts = row_count;

  return jsonb_build_object(
    'radar', deleted_radar,
    'observations', deleted_observations,
    'forecast', deleted_forecasts
  );
end;
$$;

comment on function public.purge_weather_insight_history(timestamptz, timestamptz, timestamptz) is
  'Odstraní stará metadata doplňkových dat ČHMÚ. Soubory ve Storage uklízí serverová synchronizace.';

revoke all on function public.purge_weather_insight_history(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.purge_weather_insight_history(timestamptz, timestamptz, timestamptz)
  to service_role;

commit;

-- Ověřovací dotaz po spuštění migrace:
select 'TABLE' as check_type, object_name,
  to_regclass('public.' || object_name) is not null as is_correct
from unnest(array[
  'weather_feed_state',
  'weather_radar_frames',
  'weather_observation_extremes',
  'weather_forecast_snapshots'
]) as object_name
union all
select 'STATE', 'all supplemental weather feeds initialized',
  (select count(*) = 3 from public.weather_feed_state
    where feed_key in ('radar', 'observations', 'forecast'))
union all
select 'BUCKET', 'weather-radar is private',
  exists (
    select 1 from storage.buckets
    where id = 'weather-radar' and public = false
  )
union all
select 'RLS', object_name,
  coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = object_name
  ), false)
from unnest(array[
  'weather_feed_state',
  'weather_radar_frames',
  'weather_observation_extremes',
  'weather_forecast_snapshots'
]) as object_name
order by check_type, object_name;
