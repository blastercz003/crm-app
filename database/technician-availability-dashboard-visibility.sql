alter table public.profiles
  add column if not exists show_technician_availability_on_dashboard boolean not null default true;

comment on column public.profiles.show_technician_availability_on_dashboard is
  'Controls only visibility of the POH A VOLNO launcher on the dashboard for role TECHNIK.';
