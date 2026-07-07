alter table public.profiles
  add column if not exists can_view_nord_fjella boolean not null default false;

update public.profiles
set can_view_nord_fjella = true
where role = 'admin';

create or replace function public.current_user_can_view_nord_fjella()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and (
        profiles.role = 'admin'
        or profiles.can_view_nord_fjella = true
      )
  )
$$;

revoke all on function public.current_user_can_view_nord_fjella() from public;
revoke all on function public.current_user_can_view_nord_fjella() from anon;
grant execute on function public.current_user_can_view_nord_fjella() to authenticated;
