create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists can_view_offers boolean not null default false,
  add column if not exists offer_prepared_by_name text,
  add column if not exists offer_prepared_by_phone text,
  add column if not exists offer_prepared_by_email text;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  offer_number text not null unique,
  client_id uuid not null references public.clients(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  last_edited_by uuid references public.profiles(id) on delete set null,
  approver_user_id uuid references public.profiles(id) on delete set null,
  title text not null,
  offer_type text not null default 'classic' check (
    offer_type in ('classic', 'bsafe24')
  ),
  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'changes_requested', 'approved', 'ordered', 'rejected')
  ),
  current_version integer not null default 1,
  submitted_version integer,
  approved_version integer,
  currency text not null default 'CZK',
  valid_until date,
  intro_note text,
  internal_note text,
  rejection_comment text,
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offers
  add column if not exists project_name text,
  add column if not exists offer_type text not null default 'classic',
  add column if not exists realization_address text,
  add column if not exists realization_starts_at timestamptz,
  add column if not exists realization_ends_at timestamptz,
  add column if not exists contact_person text,
  add column if not exists prepared_by_name text,
  add column if not exists prepared_by_phone text,
  add column if not exists prepared_by_email text,
  add column if not exists terms_note text;

do $$
begin
  alter table public.offers
    drop constraint if exists offers_status_check;

  alter table public.offers
    add constraint offers_status_check
    check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'ordered', 'rejected'));
end $$;

do $$
begin
  alter table public.offers
    drop constraint if exists offers_offer_type_check;

  alter table public.offers
    add constraint offers_offer_type_check
    check (offer_type in ('classic', 'bsafe24'));
end $$;

create table if not exists public.offer_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  position integer not null default 0,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit text not null default 'ks',
  unit_price_without_vat numeric(12, 2) not null default 0,
  discount_percent numeric(5, 2) not null default 0,
  vat_rate numeric(5, 2) not null default 21,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offer_items
  add column if not exists specification text,
  add column if not exists item_section text not null default 'main';

create table if not exists public.offer_service_items (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers(id) on delete cascade,
  position integer not null default 0,
  service_name text not null,
  specification text,
  operation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offers_client_idx on public.offers (client_id, created_at desc);
create index if not exists offers_created_by_idx on public.offers (created_by, created_at desc);
create index if not exists offers_status_idx on public.offers (status, created_at desc);
create index if not exists offer_items_offer_idx on public.offer_items (offer_id, position asc);
create index if not exists offer_service_items_offer_idx on public.offer_service_items (offer_id, position asc);

create table if not exists public.offer_number_sequences (
  year integer primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

revoke all on table public.offer_number_sequences from public;
revoke all on table public.offer_number_sequences from anon;
revoke all on table public.offer_number_sequences from authenticated;

create or replace function public.next_offer_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year integer := extract(year from now())::integer;
  next_number integer;
begin
  insert into public.offer_number_sequences as sequences (year, last_number, updated_at)
  values (current_year, 1, now())
  on conflict (year)
  do update set
    last_number = sequences.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  return 'NAB-' || current_year || '-' || lpad(next_number::text, 4, '0');
end;
$$;

revoke execute on function public.next_offer_number() from public;
revoke execute on function public.next_offer_number() from anon;
grant execute on function public.next_offer_number() to authenticated;

create table if not exists public.fuel_price_cache (
  fuel_type text primary key,
  source_price_with_vat numeric(12, 3) not null,
  display_price_without_vat numeric(12, 3) not null,
  source text not null,
  source_url text not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_price_cache enable row level security;

drop policy if exists "Authenticated users can read fuel price cache" on public.fuel_price_cache;
create policy "Authenticated users can read fuel price cache"
  on public.fuel_price_cache
  for select
  using (auth.uid() is not null);

drop policy if exists "Authenticated users can create fuel price cache" on public.fuel_price_cache;
create policy "Authenticated users can create fuel price cache"
  on public.fuel_price_cache
  for insert
  with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update fuel price cache" on public.fuel_price_cache;
create policy "Authenticated users can update fuel price cache"
  on public.fuel_price_cache
  for update
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

alter table public.offers enable row level security;
alter table public.offer_items enable row level security;
alter table public.offer_service_items enable row level security;

drop policy if exists "Users can read their offers and admins all offers" on public.offers;
create policy "Users can read their offers and admins all offers"
  on public.offers
  for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Allowed users can create offers" on public.offers;
create policy "Allowed users can create offers"
  on public.offers
  for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and (profiles.can_view_offers = true or profiles.role = 'admin')
    )
  );

drop policy if exists "Users can update their offers and admins all offers" on public.offers;
create policy "Users can update their offers and admins all offers"
  on public.offers
  for update
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can delete offers" on public.offers;
drop policy if exists "Users can delete their offers and admins all offers" on public.offers;
create policy "Users can delete their offers and admins all offers"
  on public.offers
  for delete
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Users can read offer items through offers" on public.offer_items;
create policy "Users can read offer items through offers"
  on public.offer_items
  for select
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can create offer items through offers" on public.offer_items;
create policy "Users can create offer items through offers"
  on public.offer_items
  for insert
  with check (
    exists (
      select 1 from public.offers
      where offers.id = offer_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can update offer items through offers" on public.offer_items;
create policy "Users can update offer items through offers"
  on public.offer_items
  for update
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.offers
      where offers.id = offer_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can delete offer items through offers" on public.offer_items;
create policy "Users can delete offer items through offers"
  on public.offer_items
  for delete
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can read offer service items through offers" on public.offer_service_items;
create policy "Users can read offer service items through offers"
  on public.offer_service_items
  for select
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_service_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can create offer service items through offers" on public.offer_service_items;
create policy "Users can create offer service items through offers"
  on public.offer_service_items
  for insert
  with check (
    exists (
      select 1 from public.offers
      where offers.id = offer_service_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can update offer service items through offers" on public.offer_service_items;
create policy "Users can update offer service items through offers"
  on public.offer_service_items
  for update
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_service_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.offers
      where offers.id = offer_service_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );

drop policy if exists "Users can delete offer service items through offers" on public.offer_service_items;
create policy "Users can delete offer service items through offers"
  on public.offer_service_items
  for delete
  using (
    exists (
      select 1 from public.offers
      where offers.id = offer_service_items.offer_id
        and (
          offers.created_by = auth.uid()
          or exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
              and profiles.role = 'admin'
          )
        )
    )
  );
