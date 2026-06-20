create extension if not exists "pgcrypto";

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.asset_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null,
  icon_key text not null,
  sort_order integer not null default 0,
  tabs_config jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_categories_tabs_config_is_array
    check (jsonb_typeof(tabs_config) = 'array')
);

create index if not exists asset_categories_sort_order_idx
  on public.asset_categories (sort_order asc, name asc);

create table if not exists public.asset_document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0,
  tabs_config jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_document_types_tabs_config_is_array
    check (jsonb_typeof(tabs_config) = 'array')
);

create index if not exists asset_document_types_sort_order_idx
  on public.asset_document_types (sort_order asc, name asc);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.asset_categories(id) on delete restrict,
  name text not null,
  status text not null default 'active' check (status in ('active', 'sold')),
  purchase_date date,
  sale_date date,
  purchase_price numeric(14,2) check (purchase_price is null or purchase_price >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assets_category_id_name_idx
  on public.assets (category_id, name asc);

create index if not exists assets_status_idx
  on public.assets (status, updated_at desc);

create index if not exists assets_purchase_date_idx
  on public.assets (purchase_date desc);

create index if not exists assets_sale_date_idx
  on public.assets (sale_date desc);

create index if not exists assets_name_search_idx
  on public.assets (lower(name));

create table if not exists public.asset_vehicle_details (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  registration_plate text not null,
  vin text,
  brand text,
  model text,
  year_of_manufacture integer,
  mileage_km integer check (mileage_km is null or mileage_km >= 0),
  insurance_expires_on date,
  stk_expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_insurance_details (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  insurance_type text,
  provider_name text,
  policy_number text,
  start_date date,
  end_date date,
  annual_premium numeric(14,2) check (annual_premium is null or annual_premium >= 0),
  deductible numeric(14,2) check (deductible is null or deductible >= 0),
  insured_amount numeric(14,2) check (insured_amount is null or insured_amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_insurance_details_asset_id_created_at_idx
  on public.asset_insurance_details (asset_id, created_at desc);

create table if not exists public.asset_real_estate_details (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  address text,
  cadastral_area text,
  land_registry_number text,
  parcel_number text,
  unit_number text,
  floor_area_sqm numeric(12,2) check (floor_area_sqm is null or floor_area_sqm >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_rentals (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  tenant_name text,
  tenant_contact text,
  start_date date,
  end_date date,
  monthly_rent numeric(14,2) check (monthly_rent is null or monthly_rent >= 0),
  deposit_amount numeric(14,2) check (deposit_amount is null or deposit_amount >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_rentals_asset_id_start_date_idx
  on public.asset_rentals (asset_id, start_date desc, created_at desc);

create table if not exists public.asset_electricity_details (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  billing_year integer not null check (billing_year >= 1900),
  provider_name text,
  ean text,
  meter_number text,
  period_start date,
  period_end date,
  consumption_kwh numeric(12,2) check (consumption_kwh is null or consumption_kwh >= 0),
  total_amount numeric(14,2) check (total_amount is null or total_amount >= 0),
  advance_payments numeric(14,2) check (advance_payments is null or advance_payments >= 0),
  balance_amount numeric(14,2),
  billed_on date,
  due_date date,
  paid_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_electricity_details_asset_id_billing_year_idx
  on public.asset_electricity_details (asset_id, billing_year desc, created_at desc);

create table if not exists public.asset_electronics_details (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  serial_number text,
  inventory_number text,
  brand text,
  model text,
  warranty_until date,
  location text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_documents (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  document_type_id uuid not null references public.asset_document_types(id) on delete restrict,
  title text not null,
  file_name text not null,
  storage_bucket text not null default 'asset-files',
  storage_path text not null unique,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_documents_asset_id_created_at_idx
  on public.asset_documents (asset_id, created_at desc);

create index if not exists asset_documents_document_type_id_created_at_idx
  on public.asset_documents (document_type_id, created_at desc);

create index if not exists asset_documents_uploaded_by_created_at_idx
  on public.asset_documents (uploaded_by, created_at desc);

create table if not exists public.asset_photos (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  title text not null,
  file_name text not null,
  storage_bucket text not null default 'asset-files',
  storage_path text not null unique,
  mime_type text,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_photos_asset_id_created_at_idx
  on public.asset_photos (asset_id, created_at desc);

create index if not exists asset_photos_uploaded_by_created_at_idx
  on public.asset_photos (uploaded_by, created_at desc);

create table if not exists public.asset_notes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_notes_asset_id_created_at_idx
  on public.asset_notes (asset_id, created_at desc);

drop trigger if exists asset_categories_touch_updated_at on public.asset_categories;
create trigger asset_categories_touch_updated_at
before update on public.asset_categories
for each row execute function public.touch_updated_at();

drop trigger if exists asset_document_types_touch_updated_at on public.asset_document_types;
create trigger asset_document_types_touch_updated_at
before update on public.asset_document_types
for each row execute function public.touch_updated_at();

drop trigger if exists assets_touch_updated_at on public.assets;
create trigger assets_touch_updated_at
before update on public.assets
for each row execute function public.touch_updated_at();

drop trigger if exists asset_vehicle_details_touch_updated_at on public.asset_vehicle_details;
create trigger asset_vehicle_details_touch_updated_at
before update on public.asset_vehicle_details
for each row execute function public.touch_updated_at();

drop trigger if exists asset_insurance_details_touch_updated_at on public.asset_insurance_details;
create trigger asset_insurance_details_touch_updated_at
before update on public.asset_insurance_details
for each row execute function public.touch_updated_at();

drop trigger if exists asset_real_estate_details_touch_updated_at on public.asset_real_estate_details;
create trigger asset_real_estate_details_touch_updated_at
before update on public.asset_real_estate_details
for each row execute function public.touch_updated_at();

drop trigger if exists asset_rentals_touch_updated_at on public.asset_rentals;
create trigger asset_rentals_touch_updated_at
before update on public.asset_rentals
for each row execute function public.touch_updated_at();

drop trigger if exists asset_electricity_details_touch_updated_at on public.asset_electricity_details;
create trigger asset_electricity_details_touch_updated_at
before update on public.asset_electricity_details
for each row execute function public.touch_updated_at();

drop trigger if exists asset_electronics_details_touch_updated_at on public.asset_electronics_details;
create trigger asset_electronics_details_touch_updated_at
before update on public.asset_electronics_details
for each row execute function public.touch_updated_at();

drop trigger if exists asset_documents_touch_updated_at on public.asset_documents;
create trigger asset_documents_touch_updated_at
before update on public.asset_documents
for each row execute function public.touch_updated_at();

drop trigger if exists asset_photos_touch_updated_at on public.asset_photos;
create trigger asset_photos_touch_updated_at
before update on public.asset_photos
for each row execute function public.touch_updated_at();

drop trigger if exists asset_notes_touch_updated_at on public.asset_notes;
create trigger asset_notes_touch_updated_at
before update on public.asset_notes
for each row execute function public.touch_updated_at();

insert into public.asset_categories (name, color, icon_key, sort_order, tabs_config)
values
  ('Osobní vozy', '#2f77af', 'car', 1, '["overview","insurance","stk","service","repairs","documents","photos"]'::jsonb),
  ('Domy', '#4f92cb', 'house', 2, '["overview","insurance","rent","electricity","documents","photos","repairs"]'::jsonb),
  ('Byty', '#5f9dca', 'building', 3, '["overview","insurance","rent","electricity","documents","photos","repairs"]'::jsonb),
  ('Elektronika', '#3a7eb8', 'cpu', 4, '["overview","insurance","service","repairs","documents","photos"]'::jsonb)
on conflict (name) do update
set
  color = excluded.color,
  icon_key = excluded.icon_key,
  sort_order = excluded.sort_order,
  tabs_config = excluded.tabs_config;

insert into public.asset_document_types (name, sort_order, tabs_config)
values
  ('Kupní smlouva', 1, '[]'::jsonb),
  ('Pojistná smlouva', 2, '["insurance"]'::jsonb),
  ('STK', 3, '["stk"]'::jsonb),
  ('Servis', 4, '["service"]'::jsonb),
  ('Revize', 5, '["service"]'::jsonb),
  ('Nájemní smlouva', 6, '["rent"]'::jsonb),
  ('Faktura', 7, '["service"]'::jsonb),
  ('Fotodokumentace', 8, '["photos"]'::jsonb),
  ('Vyúčtování elektřiny', 9, '["electricity"]'::jsonb),
  ('Záloha elektřiny', 10, '["electricity"]'::jsonb),
  ('Smlouva o dodávce elektřiny', 11, '["electricity"]'::jsonb),
  ('Jiné', 12, '[]'::jsonb)
on conflict (name) do update
set
  sort_order = excluded.sort_order,
  tabs_config = excluded.tabs_config;
