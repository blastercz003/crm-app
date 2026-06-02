alter table public.jobs
add column if not exists info_alert_enabled boolean not null default false;
