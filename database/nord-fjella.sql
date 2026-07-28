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
  object_city text not null default 'Harrachov',
  default_city_tax_rate numeric(12, 2) not null default 30 check (default_city_tax_rate >= 0),
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
  price_basis text not null default 'excluding_vat'
    check (price_basis = 'excluding_vat'),
  taxable_supply_date date,
  balance_due_date date,
  external_document_number text,
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
  cancellation_fee_vat_rate numeric(5, 2) not null default 12 check (cancellation_fee_vat_rate >= 0),
  payment_refund_amount numeric(12, 2) check (payment_refund_amount is null or payment_refund_amount >= 0),
  payment_refund_at date,
  payment_refund_method text
    check (payment_refund_method in ('bank_transfer', 'cash')),
  security_deposit_withheld_at date,
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

alter table public.nord_fjella_settings
  add column if not exists object_city text not null default 'Harrachov',
  add column if not exists default_city_tax_rate numeric(12, 2) not null default 30;

update public.nord_fjella_settings
set object_city = 'Harrachov',
    default_city_tax_rate = 30
where singleton_key = 'primary'
  and (
    coalesce(nullif(trim(object_city), ''), '') = ''
    or default_city_tax_rate = 0
  );

alter table public.nord_fjella_reservations
  add column if not exists price_basis text not null default 'excluding_vat',
  add column if not exists taxable_supply_date date,
  add column if not exists balance_due_date date,
  add column if not exists external_document_number text,
  add column if not exists cancellation_fee_vat_rate numeric(5, 2) not null default 12,
  add column if not exists payment_refund_amount numeric(12, 2),
  add column if not exists payment_refund_at date,
  add column if not exists payment_refund_method text,
  add column if not exists security_deposit_withheld_at date;

alter table public.nord_fjella_reservations
  drop constraint if exists nord_fjella_reservations_price_basis_check,
  add constraint nord_fjella_reservations_price_basis_check
    check (price_basis = 'excluding_vat'),
  drop constraint if exists nord_fjella_reservations_cancellation_fee_vat_rate_check,
  add constraint nord_fjella_reservations_cancellation_fee_vat_rate_check
    check (cancellation_fee_vat_rate >= 0),
  drop constraint if exists nord_fjella_reservations_payment_refund_amount_check,
  add constraint nord_fjella_reservations_payment_refund_amount_check
    check (payment_refund_amount is null or payment_refund_amount >= 0),
  drop constraint if exists nord_fjella_reservations_payment_refund_method_check,
  add constraint nord_fjella_reservations_payment_refund_method_check
    check (payment_refund_method in ('bank_transfer', 'cash'));

alter table public.nord_fjella_reservation_items
  drop constraint if exists nord_fjella_reservation_items_vat_mode_check,
  add constraint nord_fjella_reservation_items_vat_mode_check
    check (vat_mode in ('vat_12', 'vat_21', 'vat_exempt', 'outside_vat'));

create table if not exists public.nord_fjella_payments (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.nord_fjella_reservations(id) on delete cascade,
  source_key text,
  transaction_type text not null
    check (
      transaction_type in (
        'deposit',
        'balance',
        'refund',
        'security_deposit_received',
        'security_deposit_refund',
        'security_deposit_withheld'
      )
    ),
  direction text not null
    check (direction in ('in', 'out', 'internal')),
  amount numeric(12, 2) not null check (amount > 0),
  transaction_date date not null,
  payment_method text
    check (payment_method in ('bank_transfer', 'cash')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nord_fjella_stay_guests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.nord_fjella_reservations(id) on delete cascade,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_primary boolean not null default false,
  guest_category text not null default 'adult'
    check (guest_category in ('adult', 'child')),
  first_name text not null,
  last_name text not null,
  birth_date date not null,
  citizenship_code text not null default 'CZ'
    check (citizenship_code = 'CZ'),
  street text not null,
  city text not null,
  postal_code text not null,
  country text not null default 'Česká republika',
  identity_document_type text not null default 'id_card'
    check (identity_document_type in ('id_card', 'passport', 'other')),
  identity_document_number text not null,
  stay_start_date date not null,
  stay_end_date date not null,
  city_tax_status text not null default 'liable'
    check (city_tax_status in ('liable', 'exempt', 'not_applicable')),
  city_tax_exemption_reason text,
  city_tax_rate numeric(12, 2) not null default 30 check (city_tax_rate >= 0),
  city_tax_nights integer not null default 0 check (city_tax_nights >= 0),
  city_tax_amount numeric(12, 2) not null default 0 check (city_tax_amount >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nord_fjella_stay_guests_name_check
    check (trim(first_name) <> '' and trim(last_name) <> ''),
  constraint nord_fjella_stay_guests_date_range_check
    check (stay_end_date > stay_start_date),
  constraint nord_fjella_stay_guests_exemption_reason_check
    check (
      city_tax_status <> 'exempt'
      or coalesce(nullif(trim(city_tax_exemption_reason), ''), '') <> ''
    )
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

drop trigger if exists nord_fjella_stay_guests_set_updated_at on public.nord_fjella_stay_guests;
create trigger nord_fjella_stay_guests_set_updated_at
before update on public.nord_fjella_stay_guests
for each row
execute function public.nord_fjella_set_updated_at();

drop trigger if exists nord_fjella_payments_set_updated_at on public.nord_fjella_payments;
create trigger nord_fjella_payments_set_updated_at
before update on public.nord_fjella_payments
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

create index if not exists nord_fjella_stay_guests_reservation_sort_idx
  on public.nord_fjella_stay_guests (reservation_id, sort_order, created_at asc);

create index if not exists nord_fjella_stay_guests_stay_dates_idx
  on public.nord_fjella_stay_guests (stay_start_date, stay_end_date);

create unique index if not exists nord_fjella_stay_guests_one_primary_idx
  on public.nord_fjella_stay_guests (reservation_id)
  where is_primary;

create index if not exists nord_fjella_payments_reservation_date_idx
  on public.nord_fjella_payments (reservation_id, transaction_date, created_at);

create index if not exists nord_fjella_payments_date_type_idx
  on public.nord_fjella_payments (transaction_date, transaction_type);

create unique index if not exists nord_fjella_payments_source_key_idx
  on public.nord_fjella_payments (reservation_id, source_key)
  where source_key is not null;

insert into public.nord_fjella_stay_guests (
  reservation_id,
  sort_order,
  is_primary,
  guest_category,
  first_name,
  last_name,
  birth_date,
  street,
  city,
  postal_code,
  country,
  identity_document_type,
  identity_document_number,
  stay_start_date,
  stay_end_date,
  city_tax_status,
  city_tax_rate,
  city_tax_nights,
  city_tax_amount,
  created_by,
  updated_by
)
select
  reservation.id,
  0,
  true,
  'adult',
  split_part(trim(coalesce(reservation.guest_full_name, reservation.guest_contact_name, '')), ' ', 1),
  regexp_replace(trim(coalesce(reservation.guest_full_name, reservation.guest_contact_name, '')), '^[^ ]+\s+', ''),
  reservation.guest_birth_date,
  coalesce(reservation.guest_street, ''),
  coalesce(reservation.guest_city, ''),
  coalesce(reservation.guest_postal_code, ''),
  coalesce(reservation.guest_country, 'Česká republika'),
  'id_card',
  coalesce(reservation.guest_identity_document_number, ''),
  reservation.stay_start_date,
  reservation.stay_end_date,
  case when reservation.city_tax_person_count > 0 then 'liable' else 'not_applicable' end,
  reservation.city_tax_rate,
  case
    when reservation.city_tax_person_count > 0
      then greatest(reservation.stay_end_date - reservation.stay_start_date, 0)
    else 0
  end,
  case
    when reservation.city_tax_person_count > 0
      then reservation.city_tax_rate * greatest(reservation.stay_end_date - reservation.stay_start_date, 0)
    else 0
  end,
  reservation.created_by,
  reservation.updated_by
from public.nord_fjella_reservations reservation
where reservation.record_type = 'reservation'
  and reservation.guest_birth_date is not null
  and coalesce(nullif(trim(reservation.guest_identity_document_number), ''), '') <> ''
  and coalesce(nullif(trim(coalesce(reservation.guest_full_name, reservation.guest_contact_name)), ''), '') <> ''
  and position(' ' in trim(coalesce(reservation.guest_full_name, reservation.guest_contact_name, ''))) > 0
  and not exists (
    select 1
    from public.nord_fjella_stay_guests stay_guest
    where stay_guest.reservation_id = reservation.id
  );

alter table public.nord_fjella_settings enable row level security;
alter table public.nord_fjella_guests enable row level security;
alter table public.nord_fjella_reservations enable row level security;
alter table public.nord_fjella_reservation_items enable row level security;
alter table public.nord_fjella_stay_guests enable row level security;
alter table public.nord_fjella_payments enable row level security;

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

drop policy if exists "Users can read Nord Fjella stay guests" on public.nord_fjella_stay_guests;
create policy "Users can read Nord Fjella stay guests"
  on public.nord_fjella_stay_guests
  for select
  using (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can manage Nord Fjella stay guests" on public.nord_fjella_stay_guests;
create policy "Users can manage Nord Fjella stay guests"
  on public.nord_fjella_stay_guests
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can read Nord Fjella payments" on public.nord_fjella_payments;
create policy "Users can read Nord Fjella payments"
  on public.nord_fjella_payments
  for select
  using (public.current_user_can_view_nord_fjella());

drop policy if exists "Users can manage Nord Fjella payments" on public.nord_fjella_payments;
create policy "Users can manage Nord Fjella payments"
  on public.nord_fjella_payments
  for all
  using (public.current_user_can_view_nord_fjella())
  with check (public.current_user_can_view_nord_fjella());
