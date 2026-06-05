alter table public.profiles
  add column if not exists theme_mode text not null default 'light';

do $$
begin
  alter table public.profiles
    drop constraint if exists profiles_theme_mode_check;

  alter table public.profiles
    add constraint profiles_theme_mode_check
    check (theme_mode in ('light', 'dark'));
end $$;
