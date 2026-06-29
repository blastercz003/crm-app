create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

alter table public.profiles
  add column if not exists can_view_stores boolean not null default false;

update public.profiles
set can_view_stores = true
where role = 'admin';

create or replace function public.current_user_is_admin()
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
      and profiles.role = 'admin'
  )
$$;

create or replace function public.current_user_can_view_stores()
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
        or profiles.can_view_stores = true
      )
  )
$$;

revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_is_admin() from anon;
grant execute on function public.current_user_is_admin() to authenticated;

revoke all on function public.current_user_can_view_stores() from public;
revoke all on function public.current_user_can_view_stores() from anon;
grant execute on function public.current_user_can_view_stores() to authenticated;

create or replace function public.build_store_search_text(
  p_chain_name text,
  p_store_number text,
  p_city text,
  p_address text,
  p_phone_1 text,
  p_phone_2 text,
  p_phone_3 text
)
returns text
language sql
stable
as $$
  select trim(
    regexp_replace(
      lower(
        unaccent(
          concat_ws(
            ' ',
            coalesce(p_chain_name, ''),
            coalesce(p_store_number, ''),
            coalesce(p_city, ''),
            coalesce(p_address, ''),
            coalesce(p_phone_1, ''),
            coalesce(p_phone_2, ''),
            coalesce(p_phone_3, '')
          )
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  chain_name text not null,
  store_number text not null,
  city text not null default '',
  address text not null default '',
  phone_1 text not null,
  phone_2 text,
  phone_3 text,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_chain_name_check
    check (chain_name in ('PENNY MARKET', 'LIDL', 'ALBERT', 'BILLA')),
  constraint stores_chain_store_number_unique
    unique (chain_name, store_number)
);

create or replace function public.sync_store_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := public.build_store_search_text(
    new.chain_name,
    new.store_number,
    new.city,
    new.address,
    new.phone_1,
    new.phone_2,
    new.phone_3
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stores_sync_search_text on public.stores;
create trigger stores_sync_search_text
before insert or update on public.stores
for each row
execute function public.sync_store_search_text();

update public.stores
set search_text = public.build_store_search_text(
  chain_name,
  store_number,
  city,
  address,
  phone_1,
  phone_2,
  phone_3
);

create index if not exists stores_chain_name_idx
  on public.stores (chain_name);

create index if not exists stores_search_text_trgm_idx
  on public.stores using gin (search_text gin_trgm_ops);

alter table public.stores enable row level security;

drop policy if exists "Users can read visible stores" on public.stores;
create policy "Users can read visible stores"
  on public.stores
  for select
  using (public.current_user_can_view_stores());

drop policy if exists "Admins can insert stores" on public.stores;
create policy "Admins can insert stores"
  on public.stores
  for insert
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update stores" on public.stores;
create policy "Admins can update stores"
  on public.stores
  for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete stores" on public.stores;
create policy "Admins can delete stores"
  on public.stores
  for delete
  using (public.current_user_is_admin());
