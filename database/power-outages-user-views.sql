begin;

create table if not exists public.power_outage_match_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  match_id uuid not null references public.power_outage_store_matches(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  primary key (user_id, match_id)
);

create index if not exists power_outage_match_views_match_idx
  on public.power_outage_match_views (match_id);

alter table public.power_outage_match_views enable row level security;

drop policy if exists power_outage_match_views_own_read
  on public.power_outage_match_views;
create policy power_outage_match_views_own_read
  on public.power_outage_match_views
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_can_view_power_outages()
  );

drop policy if exists power_outage_match_views_own_insert
  on public.power_outage_match_views;
create policy power_outage_match_views_own_insert
  on public.power_outage_match_views
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.current_user_can_view_power_outages()
  );

revoke all on table public.power_outage_match_views
  from public, anon, authenticated;
grant select, insert on table public.power_outage_match_views to authenticated;
grant all on table public.power_outage_match_views to service_role;

commit;

select 'TABLE' as check_type,
  'power_outage_match_views' as object_name,
  to_regclass('public.power_outage_match_views') is not null as is_correct
union all
select 'RLS',
  'power_outage_match_views',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.power_outage_match_views'::regclass
  ), false)
union all
select 'POLICY',
  'power_outage_match_views own policies',
  (
    select count(*) = 2
    from pg_policies
    where schemaname = 'public'
      and tablename = 'power_outage_match_views'
      and policyname in (
        'power_outage_match_views_own_read',
        'power_outage_match_views_own_insert'
      )
  )
union all
select 'INDEX',
  'power_outage_match_views_match_idx',
  to_regclass('public.power_outage_match_views_match_idx') is not null
order by check_type, object_name;
