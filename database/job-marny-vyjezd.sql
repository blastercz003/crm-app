alter table public.profiles
  add column if not exists skryt_marny_vyjezd boolean not null default false;

update public.profiles
set skryt_marny_vyjezd = true
where name in ('Bohunka', 'David');
