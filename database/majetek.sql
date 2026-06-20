alter table public.profiles
  add column if not exists majetek boolean not null default false;

update public.profiles
set majetek = true
where role = 'admin';
