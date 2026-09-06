begin;

-- Ostré interní/PWA notifikace pro MARKETY. Tato migrace sama žádnou
-- notifikaci nevytváří ani neodesílá a nemění přístup uživatelů k odstávkám.

create table if not exists public.power_outage_notification_recipient_scopes (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  scope_kind text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_notification_recipient_scopes_kind_check
    check (scope_kind in ('all', 'albert'))
);

insert into public.power_outage_notification_recipient_scopes (
  user_id,
  scope_kind,
  is_active
)
values (
  '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid,
  'albert',
  true
)
on conflict (user_id) do update
set scope_kind = excluded.scope_kind,
    is_active = excluded.is_active,
    updated_at = now();

alter table public.power_outage_notification_recipient_scopes enable row level security;

drop policy if exists power_outage_notification_recipient_scopes_read
  on public.power_outage_notification_recipient_scopes;
create policy power_outage_notification_recipient_scopes_read
  on public.power_outage_notification_recipient_scopes
  for select to authenticated
  using (user_id = auth.uid() or public.current_user_is_admin());

revoke all on table public.power_outage_notification_recipient_scopes
  from public, anon, authenticated;
grant select on table public.power_outage_notification_recipient_scopes to authenticated;
grant all on table public.power_outage_notification_recipient_scopes to service_role;

create or replace function public.user_can_receive_power_outage_notifications(
  requested_user_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = requested_user_id
      and profile.role = 'admin'
  ) or exists (
    select 1
    from public.power_outage_notification_recipient_scopes as scope
    where scope.user_id = requested_user_id
      and scope.is_active
  )
$$;

revoke all on function public.user_can_receive_power_outage_notifications(uuid)
  from public, anon;
grant execute on function public.user_can_receive_power_outage_notifications(uuid)
  to authenticated, service_role;

drop policy if exists power_outage_notification_preferences_own_insert
  on public.power_outage_notification_preferences;
create policy power_outage_notification_preferences_own_insert
  on public.power_outage_notification_preferences
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      not notifications_enabled
      or public.user_can_receive_power_outage_notifications(auth.uid())
    )
  );

drop policy if exists power_outage_notification_preferences_own_update
  on public.power_outage_notification_preferences;
create policy power_outage_notification_preferences_own_update
  on public.power_outage_notification_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      not notifications_enabled
      or public.user_can_receive_power_outage_notifications(auth.uid())
    )
  );

create or replace function public.enforce_power_outage_notification_preference_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.notifications_enabled
     and not public.user_can_receive_power_outage_notifications(new.user_id) then
    raise exception 'Upozornění na odstávky může zapnout pouze administrátor nebo pověřený uživatel.';
  end if;
  new.reminder_24h_enabled := false;
  return new;
end;
$$;

revoke all on function public.enforce_power_outage_notification_preference_scope()
  from public, anon, authenticated;

drop trigger if exists power_outage_notification_preferences_enforce_scope
  on public.power_outage_notification_preferences;
create trigger power_outage_notification_preferences_enforce_scope
before insert or update on public.power_outage_notification_preferences
for each row execute function public.enforce_power_outage_notification_preference_scope();

alter table public.power_outage_notification_deliveries
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

alter table public.power_outage_notification_deliveries
  drop constraint if exists power_outage_notification_deliveries_attempt_check;
alter table public.power_outage_notification_deliveries
  add constraint power_outage_notification_deliveries_attempt_check
  check (attempt_count between 0 and 5);

create index if not exists power_outage_notification_deliveries_retry_idx
  on public.power_outage_notification_deliveries (
    delivery_status,
    next_attempt_at,
    attempt_count,
    created_at
  )
  where delivery_status in ('planned', 'failed');

-- Staré stínové kandidáty se po nasazení nesmějí změnit na skutečné zprávy.
update public.power_outage_notification_deliveries
set delivery_status = 'skipped',
    next_attempt_at = null,
    error_message = 'Historický dry-run kandidát byl před ostrou aktivací bezpečně přeskočen.'
where delivery_status in ('planned', 'failed')
  and push_delivery ->> 'dryRun' = 'true';

create or replace function public.stop_pending_power_outage_notifications_on_disable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.notifications_enabled and not new.notifications_enabled then
    update public.power_outage_notification_deliveries
    set delivery_status = 'skipped',
        next_attempt_at = null,
        error_message = 'Uživatel vypnul upozornění před dokončením doručení.'
    where user_id = new.user_id
      and delivery_status in ('planned', 'failed');
  end if;
  return new;
end;
$$;

revoke all on function public.stop_pending_power_outage_notifications_on_disable()
  from public, anon, authenticated;

drop trigger if exists power_outage_notification_preferences_stop_pending
  on public.power_outage_notification_preferences;
create trigger power_outage_notification_preferences_stop_pending
after update on public.power_outage_notification_preferences
for each row execute function public.stop_pending_power_outage_notifications_on_disable();

-- Samostatná kategorie v centru notifikací; zachovává všechny dosavadní typy.
alter table public.notifications
  drop constraint if exists notifications_category_check;
alter table public.notifications
  add constraint notifications_category_check
  check (category in (
    'assets',
    'tasks',
    'meetings',
    'offers',
    'jobs',
    'activities',
    'weather',
    'power_outages',
    'system'
  ));

comment on column public.notifications.category is
  'Kategorie interní notifikace; power_outages označuje uživatelská upozornění z tabu MARKETY.';

commit;

select 'CATEGORY' as check_type, 'power outage notification category' as object_name,
  pg_get_constraintdef(oid) like '%power_outages%' as is_correct
from pg_constraint
where conrelid = 'public.notifications'::regclass
  and conname = 'notifications_category_check'
union all
select 'DATA', 'historical dry-run deliveries are skipped',
  not exists (
    select 1
    from public.power_outage_notification_deliveries
    where delivery_status in ('planned', 'failed')
      and push_delivery ->> 'dryRun' = 'true'
  )
union all
select 'FUNCTION', 'notification recipient permission',
  to_regprocedure('public.user_can_receive_power_outage_notifications(uuid)') is not null
union all
select 'RLS', 'notification recipient scopes have RLS',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.power_outage_notification_recipient_scopes'::regclass
  ), false)
union all
select 'GRANT', 'authenticated cannot mutate recipient scopes',
  not has_table_privilege('authenticated', 'public.power_outage_notification_recipient_scopes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.power_outage_notification_recipient_scopes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.power_outage_notification_recipient_scopes', 'DELETE')
union all
select 'SAFETY', 'notification functions do not mutate profiles',
  pg_get_functiondef('public.enforce_power_outage_notification_preference_scope()'::regprocedure)
    not ilike '%update public.profiles%'
  and pg_get_functiondef('public.stop_pending_power_outage_notifications_on_disable()'::regprocedure)
    not ilike '%update public.profiles%'
union all
select 'SCOPE', 'Michal receives ALBERT only',
  exists (
    select 1
    from public.power_outage_notification_recipient_scopes
    where user_id = '46c40df2-04d7-41e9-ad6d-51cc2ee76019'::uuid
      and scope_kind = 'albert'
      and is_active
  )
union all
select 'STATE', 'no user notification preference was enabled by migration',
  not exists (
    select 1
    from public.power_outage_notification_preferences
    where notifications_enabled
  )
union all
select 'TRIGGER', 'disabling notifications stops pending delivery',
  exists (
    select 1 from pg_trigger
    where tgname = 'power_outage_notification_preferences_stop_pending'
      and not tgisinternal
  )
order by check_type, object_name;
