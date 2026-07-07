create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

create or replace function public.nord_fjella_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.build_nord_fjella_guest_search_text(
  p_guest_type text,
  p_full_name text,
  p_company_name text,
  p_contact_name text,
  p_email text,
  p_phone text,
  p_ico text,
  p_dic text,
  p_city text,
  p_country text
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
            coalesce(p_guest_type, ''),
            coalesce(p_full_name, ''),
            coalesce(p_company_name, ''),
            coalesce(p_contact_name, ''),
            coalesce(p_email, ''),
            coalesce(p_phone, ''),
            coalesce(p_ico, ''),
            coalesce(p_dic, ''),
            coalesce(p_city, ''),
            coalesce(p_country, '')
          )
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

create table if not exists public.nord_fjella_settings (
  singleton_key text primary key default 'primary'
    check (singleton_key = 'primary'),
  object_name text not null default 'Nord Fjella',
  object_logo_path text,
  provider_company_name text not null default '',
  provider_company_id_number text not null default '',
  provider_vat_number text not null default '',
  provider_street text not null default '',
  provider_city text not null default '',
  provider_postal_code text not null default '',
  provider_country text not null default 'Česká republika',
  provider_email text not null default '',
  provider_phone text not null default '',
  provider_bank_account text not null default '',
  provider_iban text,
  provider_swift text,
  default_accommodation_vat_rate numeric(5, 2) not null default 12 check (default_accommodation_vat_rate >= 0),
  default_cleaning_fee numeric(12, 2) not null default 0 check (default_cleaning_fee >= 0),
  default_security_deposit numeric(12, 2) not null default 0 check (default_security_deposit >= 0),
  default_invoice_due_days integer not null default 7 check (default_invoice_due_days >= 0),
  public_note_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nord_fjella_guests (
  id uuid primary key default gen_random_uuid(),
  guest_type text not null
    check (guest_type in ('person', 'company')),
  full_name text,
  company_name text,
  contact_name text,
  email text not null default '',
  phone text not null default '',
  street text not null default '',
  city text not null default '',
  postal_code text not null default '',
  country text not null default 'Česká republika',
  birth_date date,
  identity_document_number text,
  ico text,
  dic text,
  note text,
  search_text text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nord_fjella_guests_person_name_check
    check (
      (guest_type = 'person' and coalesce(nullif(trim(full_name), ''), '') <> '')
      or guest_type = 'company'
    ),
  constraint nord_fjella_guests_company_name_check
    check (
      (guest_type = 'company' and coalesce(nullif(trim(company_name), ''), '') <> '')
      or guest_type = 'person'
    )
);

create table if not exists public.nord_fjella_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_number text not null unique,
  variable_symbol text not null unique,
  record_type text not null
    check (record_type in ('reservation', 'owner_block', 'technical_block')),
  reservation_status text
    check (reservation_status in ('inquiry', 'reserved', 'completed', 'cancelled')),
  settlement_status text not null default 'draft'
    check (settlement_status in ('draft', 'in_progress', 'closed')),
  payment_status text
    check (payment_status in ('unpaid', 'deposit_paid', 'partially_paid', 'paid', 'refund_or_overpayment')),
  guest_id uuid references public.nord_fjella_guests(id) on delete set null,
  guest_type text
    check (guest_type in ('person', 'company')),
  guest_full_name text,
  guest_company_name text,
  guest_contact_name text,
  guest_email text,
  guest_phone text,
  guest_street text,
  guest_city text,
  guest_postal_code text,
  guest_country text,
  guest_birth_date date,
  guest_identity_document_number text,
  guest_ico text,
  guest_dic text,
  stay_start_date date not null,
  stay_end_date date not null,
  adult_count integer not null default 0 check (adult_count >= 0),
  child_count integer not null default 0 check (child_count >= 0),
  accommodation_night_rate numeric(12, 2) not null default 0 check (accommodation_night_rate >= 0),
  accommodation_vat_rate numeric(5, 2) not null default 12 check (accommodation_vat_rate >= 0),
  city_tax_rate numeric(12, 2) not null default 0 check (city_tax_rate >= 0),
  city_tax_person_count integer not null default 0 check (city_tax_person_count >= 0),
  cleaning_fee numeric(12, 2) not null default 0 check (cleaning_fee >= 0),
  cleaning_fee_vat_rate numeric(5, 2) not null default 12 check (cleaning_fee_vat_rate >= 0),
  security_deposit_amount numeric(12, 2) not null default 0 check (security_deposit_amount >= 0),
  security_deposit_received boolean not null default false,
  security_deposit_received_at date,
  security_deposit_refunded_at date,
  security_deposit_refund_amount numeric(12, 2) check (security_deposit_refund_amount is null or security_deposit_refund_amount >= 0),
  security_deposit_withheld_amount numeric(12, 2) check (security_deposit_withheld_amount is null or security_deposit_withheld_amount >= 0),
  security_deposit_withheld_reason text,
  requested_deposit_amount numeric(12, 2) check (requested_deposit_amount is null or requested_deposit_amount >= 0),
  deposit_due_date date,
  deposit_paid_amount numeric(12, 2) check (deposit_paid_amount is null or deposit_paid_amount >= 0),
  deposit_paid_at date,
  deposit_payment_method text
    check (deposit_payment_method in ('bank_transfer', 'cash')),
  balance_paid_amount numeric(12, 2) check (balance_paid_amount is null or balance_paid_amount >= 0),
  balance_paid_at date,
  balance_payment_method text
    check (balance_payment_method in ('bank_transfer', 'cash')),
  cancellation_fee_amount numeric(12, 2) check (cancellation_fee_amount is null or cancellation_fee_amount >= 0),
  internal_note text,
  public_note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nord_fjella_reservations_date_range_check
    check (stay_end_date > stay_start_date),
  constraint nord_fjella_reservations_guest_presence_check
    check (
      record_type <> 'reservation'
      or coalesce(guest_email, '') <> ''
    ),
  constraint nord_fjella_reservations_status_by_type_check
    check (
      (record_type = 'reservation' and reservation_status is not null)
      or (record_type <> 'reservation' and reservation_status is null)
    )
);

create table if not exists public.nord_fjella_reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.nord_fjella_reservations(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  item_type text not null
    check (
      item_type in (
        'accommodation',
        'cleaning',
        'city_tax',
        'discount',
        'cancellation_fee',
        'manual_service'
      )
    ),
  label text not null,
  quantity numeric(12, 2) not null default 1 check (quantity >= 0),
  unit text not null default 'ks',
  unit_price numeric(12, 2) not null default 0,
  vat_mode text not null
    check (vat_mode in ('vat_12', 'vat_21', 'vat_exempt')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.sync_nord_fjella_guest_search_text()
returns trigger
language plpgsql
as $$
begin
  new.search_text := public.build_nord_fjella_guest_search_text(
    new.guest_type,
    new.full_name,
    new.company_name,
    new.contact_name,
    new.email,
    new.phone,
    new.ico,
    new.dic,
    new.city,
    new.country
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists nord_fjella_settings_set_updated_at on public.nord_fjella_settings;
create trigger nord_fjella_settings_set_updated_at
before update on public.nord_fjella_settings
for each row
execute function public.nord_fjella_set_updated_at();

drop trigger if exists nord_fjella_guests_sync_search_text on public.nord_fjella_guests;
create trigger nord_fjella_guests_sync_search_text
before insert or update on public.nord_fjella_guests
for each row
execute function public.sync_nord_fjella_guest_search_text();

drop trigger if exists nord_fjella_reservations_set_updated_at on public.nord_fjella_reservations;
create trigger nord_fjella_reservations_set_updated_at
before update on public.nord_fjella_reservations
for each row
execute function public.nord_fjella_set_updated_at();

drop trigger if exists nord_fjella_reservation_items_set_updated_at on public.nord_fjella_reservation_items;
create trigger nord_fjella_reservation_items_set_updated_at
before update on public.nord_fjella_reservation_items
for each row
execute function public.nord_fjella_set_updated_at();

update public.nord_fjella_guests
set search_text = public.build_nord_fjella_guest_search_text(
  guest_type,
  full_name,
  company_name,
  contact_name,
  email,
  phone,
  ico,
  dic,
  city,
  country
);

insert into public.nord_fjella_settings (singleton_key)
values ('primary')
on conflict (singleton_key) do nothing;

create index if not exists nord_fjella_guests_email_idx
  on public.nord_fjella_guests (email);

create index if not exists nord_fjella_guests_phone_idx
  on public.nord_fjella_guests (phone);

create index if not exists nord_fjella_guests_search_text_trgm_idx
  on public.nord_fjella_guests using gin (search_text gin_trgm_ops);

create index if not exists nord_fjella_reservations_date_idx
  on public.nord_fjella_reservations (stay_start_date, stay_end_date);

create index if not exists nord_fjella_reservations_record_status_idx
  on public.nord_fjella_reservations (record_type, reservation_status, settlement_status, payment_status);

create index if not exists nord_fjella_reservations_guest_id_idx
  on public.nord_fjella_reservations (guest_id, created_at desc);

create index if not exists nord_fjella_reservation_items_reservation_sort_idx
  on public.nord_fjella_reservation_items (reservation_id, sort_order, created_at asc);

alter table public.nord_fjella_settings enable row level security;
alter table public.nord_fjella_guests enable row level security;
alter table public.nord_fjella_reservations enable row level security;
alter table public.nord_fjella_reservation_items enable row level security;

drop policy if exists "Users can read Nord Fjella settings" on public.nord_fjella_settings;
create policy "Users can read Nord Fjella settings"
  on public.nord_fjella_settings
  for select
  using (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can manage Nord Fjella settings" on public.nord_fjella_settings;
create policy "Users can manage Nord Fjella settings"
  on public.nord_fjella_settings
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can read Nord Fjella guests" on public.nord_fjella_guests;
create policy "Users can read Nord Fjella guests"
  on public.nord_fjella_guests
  for select
  using (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can manage Nord Fjella guests" on public.nord_fjella_guests;
create policy "Users can manage Nord Fjella guests"
  on public.nord_fjella_guests
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can read Nord Fjella reservations" on public.nord_fjella_reservations;
create policy "Users can read Nord Fjella reservations"
  on public.nord_fjella_reservations
  for select
  using (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can manage Nord Fjella reservations" on public.nord_fjella_reservations;
create policy "Users can manage Nord Fjella reservations"
  on public.nord_fjella_reservations
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can read Nord Fjella reservation items" on public.nord_fjella_reservation_items;
create policy "Users can read Nord Fjella reservation items"
  on public.nord_fjella_reservation_items
  for select
  using (
    exists (
      select 1
      from public.nord_fjella_reservations
      where nord_fjella_reservations.id = nord_fjella_reservation_items.reservation_id
        and public.current_user_can_view_nord_fjella()
    )
  );

drop policy if exists "Users can manage Nord Fjella reservation items" on public.nord_fjella_reservation_items;
create policy "Users can manage Nord Fjella reservation items"
  on public.nord_fjella_reservation_items
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());
