create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists can_view_bsafe24 boolean not null default false;

update public.profiles
set can_view_bsafe24 = true
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

create or replace function public.current_user_can_view_bsafe24()
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
        or profiles.can_view_bsafe24 = true
      )
  )
$$;

create or replace function public.current_user_bsafe24_sales_owner()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case upper(trim(coalesce(profiles.name, '')))
    when 'JIŘÍ' then 'JIŘÍ'
    when 'MICHAL' then 'MICHAL'
    when 'LÍDA' then 'LÍDA'
    else null
  end
  from public.profiles
  where profiles.id = auth.uid()
  limit 1
$$;

create or replace function public.current_user_can_read_bsafe24_contract(
  p_sales_owner text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.current_user_can_view_bsafe24()
    and (
      public.current_user_is_admin()
      or public.current_user_bsafe24_sales_owner() = p_sales_owner
    )
$$;

revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_is_admin() from anon;
grant execute on function public.current_user_is_admin() to authenticated;

revoke all on function public.current_user_can_view_bsafe24() from public;
revoke all on function public.current_user_can_view_bsafe24() from anon;
grant execute on function public.current_user_can_view_bsafe24() to authenticated;

revoke all on function public.current_user_bsafe24_sales_owner() from public;
revoke all on function public.current_user_bsafe24_sales_owner() from anon;
grant execute on function public.current_user_bsafe24_sales_owner() to authenticated;

revoke all on function public.current_user_can_read_bsafe24_contract(text) from public;
revoke all on function public.current_user_can_read_bsafe24_contract(text) from anon;
grant execute on function public.current_user_can_read_bsafe24_contract(text) to authenticated;

create or replace function public.bsafe24_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.bsafe24_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_contact_id uuid references public.client_contacts(id) on delete set null,
  client_name text not null,
  contact_person text,
  client_address text not null default '',
  sales_owner text not null,
  monthly_fee numeric(12, 2) not null default 0 check (monthly_fee >= 0),
  is_active boolean not null default true,
  internal_note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsafe24_contracts_contract_number_unique unique (contract_number),
  constraint bsafe24_contracts_client_unique unique (client_id),
  constraint bsafe24_contracts_sales_owner_check
    check (sales_owner in ('JIŘÍ', 'MICHAL', 'LÍDA'))
);

create table if not exists public.bsafe24_backup_addresses (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.bsafe24_contracts(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  address text not null,
  contact_person text,
  generator_power text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bsafe24_files (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.bsafe24_contracts(id) on delete cascade,
  file_type text not null,
  file_name text not null,
  display_name text not null,
  storage_bucket text not null default 'bsafe24-files',
  storage_path text not null unique,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes >= 0 and file_size_bytes <= 10485760),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bsafe24_files_type_check
    check (file_type in ('offer_pdf', 'contract_pdf', 'other'))
);

create unique index if not exists bsafe24_files_singleton_type_idx
  on public.bsafe24_files (contract_id, file_type)
  where file_type in ('offer_pdf', 'contract_pdf');

create index if not exists bsafe24_contracts_sales_owner_active_idx
  on public.bsafe24_contracts (sales_owner, is_active, created_at desc);

create index if not exists bsafe24_contracts_client_name_idx
  on public.bsafe24_contracts (client_name);

create index if not exists bsafe24_contracts_created_by_idx
  on public.bsafe24_contracts (created_by, created_at desc);

create index if not exists bsafe24_backup_addresses_contract_sort_idx
  on public.bsafe24_backup_addresses (contract_id, sort_order, created_at asc);

create index if not exists bsafe24_files_contract_created_at_idx
  on public.bsafe24_files (contract_id, created_at desc);

drop trigger if exists bsafe24_contracts_set_updated_at on public.bsafe24_contracts;
create trigger bsafe24_contracts_set_updated_at
before update on public.bsafe24_contracts
for each row
execute function public.bsafe24_set_updated_at();

drop trigger if exists bsafe24_backup_addresses_set_updated_at on public.bsafe24_backup_addresses;
create trigger bsafe24_backup_addresses_set_updated_at
before update on public.bsafe24_backup_addresses
for each row
execute function public.bsafe24_set_updated_at();

drop trigger if exists bsafe24_files_set_updated_at on public.bsafe24_files;
create trigger bsafe24_files_set_updated_at
before update on public.bsafe24_files
for each row
execute function public.bsafe24_set_updated_at();

alter table public.bsafe24_contracts enable row level security;
alter table public.bsafe24_backup_addresses enable row level security;
alter table public.bsafe24_files enable row level security;

drop policy if exists "Users can read visible bsafe24 contracts" on public.bsafe24_contracts;
create policy "Users can read visible bsafe24 contracts"
  on public.bsafe24_contracts
  for select
  using (public.current_user_can_read_bsafe24_contract(sales_owner));

drop policy if exists "Admins can insert bsafe24 contracts" on public.bsafe24_contracts;
create policy "Admins can insert bsafe24 contracts"
  on public.bsafe24_contracts
  for insert
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update bsafe24 contracts" on public.bsafe24_contracts;
create policy "Admins can update bsafe24 contracts"
  on public.bsafe24_contracts
  for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete bsafe24 contracts" on public.bsafe24_contracts;
create policy "Admins can delete bsafe24 contracts"
  on public.bsafe24_contracts
  for delete
  using (public.current_user_is_admin());

drop policy if exists "Users can read visible bsafe24 backup addresses" on public.bsafe24_backup_addresses;
create policy "Users can read visible bsafe24 backup addresses"
  on public.bsafe24_backup_addresses
  for select
  using (
    exists (
      select 1
      from public.bsafe24_contracts
      where bsafe24_contracts.id = bsafe24_backup_addresses.contract_id
        and public.current_user_can_read_bsafe24_contract(bsafe24_contracts.sales_owner)
    )
  );

drop policy if exists "Admins can insert bsafe24 backup addresses" on public.bsafe24_backup_addresses;
create policy "Admins can insert bsafe24 backup addresses"
  on public.bsafe24_backup_addresses
  for insert
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update bsafe24 backup addresses" on public.bsafe24_backup_addresses;
create policy "Admins can update bsafe24 backup addresses"
  on public.bsafe24_backup_addresses
  for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete bsafe24 backup addresses" on public.bsafe24_backup_addresses;
create policy "Admins can delete bsafe24 backup addresses"
  on public.bsafe24_backup_addresses
  for delete
  using (public.current_user_is_admin());

drop policy if exists "Users can read visible bsafe24 files" on public.bsafe24_files;
create policy "Users can read visible bsafe24 files"
  on public.bsafe24_files
  for select
  using (
    exists (
      select 1
      from public.bsafe24_contracts
      where bsafe24_contracts.id = bsafe24_files.contract_id
        and public.current_user_can_read_bsafe24_contract(bsafe24_contracts.sales_owner)
    )
  );

drop policy if exists "Admins can insert bsafe24 files" on public.bsafe24_files;
create policy "Admins can insert bsafe24 files"
  on public.bsafe24_files
  for insert
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update bsafe24 files" on public.bsafe24_files;
create policy "Admins can update bsafe24 files"
  on public.bsafe24_files
  for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete bsafe24 files" on public.bsafe24_files;
create policy "Admins can delete bsafe24 files"
  on public.bsafe24_files
  for delete
  using (public.current_user_is_admin());
