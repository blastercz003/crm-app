-- Notifikace vytváří výhradně server aplikace pomocí service role.
-- Přihlášený klient smí své notifikace číst a aktualizovat, ale nesmí
-- přímo vytvářet notifikaci jinému uživateli.

drop policy if exists "Authenticated users can create notifications"
  on public.notifications;

revoke insert on table public.notifications from anon;
revoke insert on table public.notifications from authenticated;
grant insert on table public.notifications to service_role;

select
  'RLS' as check_type,
  'notifications has no authenticated INSERT policy' as object_name,
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'notifications'
      and cmd = 'INSERT'
      and ('authenticated' = any(roles) or 'public' = any(roles))
  ) as is_correct

union all

select
  'GRANT',
  'authenticated cannot INSERT notifications',
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT')

union all

select
  'GRANT',
  'service_role can INSERT notifications',
  has_table_privilege('service_role', 'public.notifications', 'INSERT');
