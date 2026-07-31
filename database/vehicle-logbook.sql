begin;

create extension if not exists "pgcrypto";

-- Knihy jízd jsou dostupné pouze administrátorům aplikace.
create or replace function public.current_user_is_vehicle_logbook_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
$$;

-- Trvalý registr vozidel. Řádek zůstane zachovaný i po odstranění vozidla
-- z Majetku; asset_id se pouze nastaví na null.
create table if not exists public.vehicle_logbook_vehicles (
  id uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null unique,
  asset_id uuid unique references public.assets(id) on delete set null,
  asset_name text not null,
  registration_plate text not null,
  vin text,
  brand text,
  model text,
  year_of_manufacture integer,
  insurance_expires_on date,
  stk_expires_on date,
  source_status text not null default 'active'
    check (source_status in ('active', 'sold', 'inactive', 'deleted', 'missing_details')),
  is_active boolean not null default true,
  initial_odometer_km integer
    check (initial_odometer_km is null or initial_odometer_km >= 0),
  initial_odometer_recorded_on date,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vehicle_logbook_vehicles_active_idx
  on public.vehicle_logbook_vehicles (is_active, asset_name, registration_plate);

create index if not exists vehicle_logbook_vehicles_registration_plate_idx
  on public.vehicle_logbook_vehicles (lower(registration_plate));

-- Jedna dávka reprezentuje jeden návrh automatické rekonstrukce.
create table if not exists public.vehicle_logbook_generation_batches (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null
    references public.vehicle_logbook_vehicles(id) on delete restrict,
  period_from date not null,
  period_to date not null,
  departure_city text not null,
  requested_odometer_start_km integer not null
    check (requested_odometer_start_km >= 0),
  requested_odometer_end_km integer not null
    check (requested_odometer_end_km >= requested_odometer_start_km),
  parameters jsonb not null default '{}'::jsonb
    check (jsonb_typeof(parameters) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'reverted')),
  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id) on delete set null,
  reverted_at timestamptz,
  reverted_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_logbook_generation_batches_period_check
    check (period_to >= period_from),
  constraint vehicle_logbook_generation_batches_status_dates_check
    check (
      (status = 'draft' and confirmed_at is null and reverted_at is null)
      or (status = 'confirmed' and confirmed_at is not null and reverted_at is null)
      or (status = 'reverted' and confirmed_at is not null and reverted_at is not null)
    )
);

create index if not exists vehicle_logbook_generation_batches_vehicle_period_idx
  on public.vehicle_logbook_generation_batches (vehicle_id, period_from desc, period_to desc);

create index if not exists vehicle_logbook_generation_batches_status_idx
  on public.vehicle_logbook_generation_batches (status, created_at desc);

-- Jednotlivé jízdy i denní souhrny používají stejnou tabulku.
create table if not exists public.vehicle_logbook_entries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null
    references public.vehicle_logbook_vehicles(id) on delete restrict,
  generation_batch_id uuid
    references public.vehicle_logbook_generation_batches(id) on delete restrict,
  entry_type text not null default 'trip'
    check (entry_type in ('trip', 'daily_summary')),
  usage_type text not null default 'business'
    check (usage_type in ('business', 'private', 'mixed')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'automatic_reconstruction')),
  trip_date date not null,
  day_sequence smallint not null default 1
    check (day_sequence >= 1),
  start_time time,
  end_time time,
  origin text not null,
  destination text not null,
  purpose text not null default 'Jednání / průzkum',
  odometer_start_km integer not null
    check (odometer_start_km >= 0),
  odometer_end_km integer not null
    check (odometer_end_km >= 0),
  business_km integer not null default 0
    check (business_km >= 0),
  private_km integer not null default 0
    check (private_km >= 0),
  distance_km integer generated always as (business_km + private_km) stored,
  calculated_route_km integer
    check (calculated_route_km is null or calculated_route_km >= 0),
  note text,
  vehicle_name_snapshot text not null,
  registration_plate_snapshot text not null,
  brand_snapshot text,
  model_snapshot text,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_logbook_entries_odometer_check
    check (odometer_end_km >= odometer_start_km),
  constraint vehicle_logbook_entries_distance_check
    check (business_km + private_km = odometer_end_km - odometer_start_km),
  constraint vehicle_logbook_entries_usage_check
    check (
      (usage_type = 'business' and business_km > 0 and private_km = 0)
      or (usage_type = 'private' and private_km > 0 and business_km = 0)
      or (
        usage_type = 'mixed'
        and entry_type = 'daily_summary'
        and business_km > 0
        and private_km > 0
      )
    ),
  constraint vehicle_logbook_entries_source_check
    check (
      (source_type = 'manual' and generation_batch_id is null)
      or (
        source_type = 'automatic_reconstruction'
        and generation_batch_id is not null
      )
    ),
  constraint vehicle_logbook_entries_route_check
    check (length(btrim(origin)) > 0 and length(btrim(destination)) > 0),
  constraint vehicle_logbook_entries_purpose_check
    check (length(btrim(purpose)) > 0),
  constraint vehicle_logbook_entries_deleted_check
    check (
      (deleted_at is null and deleted_by is null)
      or deleted_at is not null
    )
);

create unique index if not exists vehicle_logbook_entries_active_day_sequence_idx
  on public.vehicle_logbook_entries (vehicle_id, trip_date, day_sequence)
  where deleted_at is null;

create index if not exists vehicle_logbook_entries_vehicle_date_idx
  on public.vehicle_logbook_entries (vehicle_id, trip_date desc, day_sequence desc)
  where deleted_at is null;

create index if not exists vehicle_logbook_entries_generation_batch_idx
  on public.vehicle_logbook_entries (generation_batch_id)
  where generation_batch_id is not null;

create index if not exists vehicle_logbook_entries_deleted_idx
  on public.vehicle_logbook_entries (vehicle_id, deleted_at desc)
  where deleted_at is not null;

-- Tankování a nabíjení jsou samostatné, nepovinné záznamy.
create table if not exists public.vehicle_logbook_fuel_entries (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null
    references public.vehicle_logbook_vehicles(id) on delete restrict,
  fueled_on date not null,
  odometer_km integer not null
    check (odometer_km >= 0),
  energy_type text not null
    check (energy_type in ('petrol', 'diesel', 'electricity')),
  quantity numeric(12, 3) not null
    check (quantity > 0),
  unit text not null
    check (unit in ('litre', 'kwh')),
  gross_amount numeric(14, 2) not null
    check (gross_amount >= 0),
  vat_rate numeric(5, 2) not null default 21
    check (vat_rate >= 0 and vat_rate <= 100),
  net_amount numeric(14, 2)
    generated always as (
      round(gross_amount / (1 + vat_rate / 100), 2)
    ) stored,
  vat_amount numeric(14, 2)
    generated always as (
      gross_amount - round(gross_amount / (1 + vat_rate / 100), 2)
    ) stored,
  supplier text,
  document_number text,
  is_full_tank boolean not null default false,
  note text,
  vehicle_name_snapshot text not null,
  registration_plate_snapshot text not null,
  brand_snapshot text,
  model_snapshot text,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_logbook_fuel_entries_energy_unit_check
    check (
      (energy_type in ('petrol', 'diesel') and unit = 'litre')
      or (energy_type = 'electricity' and unit = 'kwh')
    ),
  constraint vehicle_logbook_fuel_entries_deleted_check
    check (
      (deleted_at is null and deleted_by is null)
      or deleted_at is not null
    )
);

create index if not exists vehicle_logbook_fuel_entries_vehicle_date_idx
  on public.vehicle_logbook_fuel_entries (vehicle_id, fueled_on desc)
  where deleted_at is null;

create index if not exists vehicle_logbook_fuel_entries_deleted_idx
  on public.vehicle_logbook_fuel_entries (vehicle_id, deleted_at desc)
  where deleted_at is not null;

create table if not exists public.vehicle_logbook_fuel_attachments (
  id uuid primary key default gen_random_uuid(),
  fuel_entry_id uuid not null
    references public.vehicle_logbook_fuel_entries(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint
    check (file_size_bytes is null or file_size_bytes >= 0),
  deleted_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint vehicle_logbook_fuel_attachments_deleted_check
    check (
      (deleted_at is null and deleted_by is null)
      or deleted_at is not null
    )
);

create index if not exists vehicle_logbook_fuel_attachments_entry_idx
  on public.vehicle_logbook_fuel_attachments (fuel_entry_id, created_at desc)
  where deleted_at is null;

-- Uzávěrka je kontrolní snapshot. Pozdější změny ji nezamknou, pouze
-- nastaví changed_after_closure na true.
create table if not exists public.vehicle_logbook_monthly_closures (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null
    references public.vehicle_logbook_vehicles(id) on delete restrict,
  period_year integer not null
    check (period_year between 2000 and 2200),
  period_month integer not null
    check (period_month between 1 and 12),
  opening_odometer_km integer
    check (opening_odometer_km is null or opening_odometer_km >= 0),
  closing_odometer_km integer
    check (closing_odometer_km is null or closing_odometer_km >= 0),
  business_km integer not null default 0
    check (business_km >= 0),
  private_km integer not null default 0
    check (private_km >= 0),
  total_km integer generated always as (business_km + private_km) stored,
  trip_count integer not null default 0
    check (trip_count >= 0),
  fuel_entry_count integer not null default 0
    check (fuel_entry_count >= 0),
  fuel_net_amount numeric(14, 2) not null default 0
    check (fuel_net_amount >= 0),
  fuel_vat_amount numeric(14, 2) not null default 0
    check (fuel_vat_amount >= 0),
  fuel_gross_amount numeric(14, 2) not null default 0
    check (fuel_gross_amount >= 0),
  changed_after_closure boolean not null default false,
  calculated_at timestamptz not null default now(),
  calculated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_logbook_monthly_closures_vehicle_period_key
    unique (vehicle_id, period_year, period_month),
  constraint vehicle_logbook_monthly_closures_odometer_check
    check (
      opening_odometer_km is null
      or closing_odometer_km is null
      or closing_odometer_km >= opening_odometer_km
    ),
  constraint vehicle_logbook_monthly_closures_fuel_total_check
    check (fuel_net_amount + fuel_vat_amount = fuel_gross_amount)
);

create index if not exists vehicle_logbook_monthly_closures_period_idx
  on public.vehicle_logbook_monthly_closures (period_year desc, period_month desc, vehicle_id);

-- Neměnná historie vložení, změn a případných fyzických smazání.
create table if not exists public.vehicle_logbook_audit (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  vehicle_id uuid references public.vehicle_logbook_vehicles(id) on delete set null,
  operation text not null
    check (operation in ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists vehicle_logbook_audit_record_idx
  on public.vehicle_logbook_audit (table_name, record_id, changed_at desc);

create index if not exists vehicle_logbook_audit_vehicle_idx
  on public.vehicle_logbook_audit (vehicle_id, changed_at desc);

create or replace function public.vehicle_logbook_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function public.vehicle_logbook_fill_vehicle_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_row public.vehicle_logbook_vehicles%rowtype;
begin
  if tg_op = 'UPDATE' and new.vehicle_id = old.vehicle_id then
    new.vehicle_name_snapshot := old.vehicle_name_snapshot;
    new.registration_plate_snapshot := old.registration_plate_snapshot;
    new.brand_snapshot := old.brand_snapshot;
    new.model_snapshot := old.model_snapshot;
    return new;
  end if;

  select *
  into vehicle_row
  from public.vehicle_logbook_vehicles
  where id = new.vehicle_id;

  if not found then
    raise exception 'Vybrané vozidlo knihy jízd neexistuje.';
  end if;

  new.vehicle_name_snapshot := vehicle_row.asset_name;
  new.registration_plate_snapshot := vehicle_row.registration_plate;
  new.brand_snapshot := vehicle_row.brand;
  new.model_snapshot := vehicle_row.model;
  return new;
end;
$$;

create or replace function public.audit_vehicle_logbook_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_json jsonb;
  new_json jsonb;
  resolved_record_id uuid;
  resolved_vehicle_id uuid;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  resolved_record_id := coalesce(
    nullif(new_json ->> 'id', '')::uuid,
    nullif(old_json ->> 'id', '')::uuid
  );
  resolved_vehicle_id := coalesce(
    nullif(new_json ->> 'vehicle_id', '')::uuid,
    nullif(old_json ->> 'vehicle_id', '')::uuid
  );

  insert into public.vehicle_logbook_audit (
    table_name,
    record_id,
    vehicle_id,
    operation,
    old_data,
    new_data,
    changed_by
  )
  values (
    tg_table_name,
    resolved_record_id,
    resolved_vehicle_id,
    lower(tg_op),
    old_json,
    new_json,
    auth.uid()
  );

  return coalesce(new, old);
end;
$$;

-- Synchronizuje jeden osobní vůz z Majetku do trvalého registru.
create or replace function public.sync_vehicle_logbook_vehicle(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source_row record;
begin
  select
    asset.id as asset_id,
    asset.name as asset_name,
    asset.status as asset_status,
    category.icon_key,
    category.name as category_name,
    detail.registration_plate,
    detail.vin,
    detail.brand,
    detail.model,
    detail.year_of_manufacture,
    detail.mileage_km,
    detail.insurance_expires_on,
    detail.stk_expires_on
  into source_row
  from public.assets asset
  join public.asset_categories category on category.id = asset.category_id
  left join public.asset_vehicle_details detail on detail.asset_id = asset.id
  where asset.id = p_asset_id;

  if not found then
    update public.vehicle_logbook_vehicles
    set
      source_status = 'deleted',
      is_active = false,
      updated_at = now()
    where source_asset_id = p_asset_id;
    return;
  end if;

  if not (
    source_row.icon_key = 'car'
    or lower(source_row.category_name) = 'osobní vozy'
  ) then
    update public.vehicle_logbook_vehicles
    set
      asset_name = source_row.asset_name,
      source_status = 'inactive',
      is_active = false,
      updated_at = now()
    where source_asset_id = p_asset_id;
    return;
  end if;

  if source_row.registration_plate is null then
    update public.vehicle_logbook_vehicles
    set
      asset_name = source_row.asset_name,
      source_status = 'missing_details',
      is_active = false,
      updated_at = now()
    where source_asset_id = p_asset_id;
    return;
  end if;

  insert into public.vehicle_logbook_vehicles (
    source_asset_id,
    asset_id,
    asset_name,
    registration_plate,
    vin,
    brand,
    model,
    year_of_manufacture,
    insurance_expires_on,
    stk_expires_on,
    source_status,
    is_active,
    initial_odometer_km,
    initial_odometer_recorded_on
  )
  values (
    source_row.asset_id,
    source_row.asset_id,
    source_row.asset_name,
    source_row.registration_plate,
    source_row.vin,
    source_row.brand,
    source_row.model,
    source_row.year_of_manufacture,
    source_row.insurance_expires_on,
    source_row.stk_expires_on,
    case when source_row.asset_status = 'active' then 'active' else 'sold' end,
    source_row.asset_status = 'active',
    source_row.mileage_km,
    case when source_row.mileage_km is not null then current_date end
  )
  on conflict (source_asset_id) do update
  set
    asset_id = excluded.asset_id,
    asset_name = excluded.asset_name,
    registration_plate = excluded.registration_plate,
    vin = excluded.vin,
    brand = excluded.brand,
    model = excluded.model,
    year_of_manufacture = excluded.year_of_manufacture,
    insurance_expires_on = excluded.insurance_expires_on,
    stk_expires_on = excluded.stk_expires_on,
    source_status = excluded.source_status,
    is_active = excluded.is_active,
    initial_odometer_km = coalesce(
      public.vehicle_logbook_vehicles.initial_odometer_km,
      excluded.initial_odometer_km
    ),
    initial_odometer_recorded_on = coalesce(
      public.vehicle_logbook_vehicles.initial_odometer_recorded_on,
      excluded.initial_odometer_recorded_on
    ),
    updated_at = now();
end;
$$;

create or replace function public.sync_vehicle_logbook_vehicle_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'assets' then
    if tg_op = 'DELETE' then
      update public.vehicle_logbook_vehicles
      set
        asset_name = old.name,
      source_status = 'deleted',
      is_active = false,
      updated_at = now()
      where source_asset_id = old.id;
      return old;
    end if;

    perform public.sync_vehicle_logbook_vehicle(new.id);
    return new;
  end if;

  perform public.sync_vehicle_logbook_vehicle(
    case when tg_op = 'DELETE' then old.asset_id else new.asset_id end
  );
  return coalesce(new, old);
end;
$$;

-- Každá změna jízdy nebo tankování po uzávěrce označí daný měsíc
-- jako změněný. Při přesunu do jiného měsíce se označí oba měsíce.
create or replace function public.mark_vehicle_logbook_closure_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_vehicle_id uuid;
  new_vehicle_id uuid;
  old_record_date date;
  new_record_date date;
begin
  if tg_table_name = 'vehicle_logbook_entries' then
    old_vehicle_id := case when tg_op in ('UPDATE', 'DELETE') then old.vehicle_id end;
    new_vehicle_id := case when tg_op in ('INSERT', 'UPDATE') then new.vehicle_id end;
    old_record_date := case when tg_op in ('UPDATE', 'DELETE') then old.trip_date end;
    new_record_date := case when tg_op in ('INSERT', 'UPDATE') then new.trip_date end;
  else
    old_vehicle_id := case when tg_op in ('UPDATE', 'DELETE') then old.vehicle_id end;
    new_vehicle_id := case when tg_op in ('INSERT', 'UPDATE') then new.vehicle_id end;
    old_record_date := case when tg_op in ('UPDATE', 'DELETE') then old.fueled_on end;
    new_record_date := case when tg_op in ('INSERT', 'UPDATE') then new.fueled_on end;
  end if;

  if old_vehicle_id is not null and old_record_date is not null then
    update public.vehicle_logbook_monthly_closures
    set
      changed_after_closure = true,
      updated_by = auth.uid(),
      updated_at = now()
    where vehicle_id = old_vehicle_id
      and period_year = extract(year from old_record_date)::integer
      and period_month = extract(month from old_record_date)::integer;
  end if;

  if new_vehicle_id is not null and new_record_date is not null then
    update public.vehicle_logbook_monthly_closures
    set
      changed_after_closure = true,
      updated_by = auth.uid(),
      updated_at = now()
    where vehicle_id = new_vehicle_id
      and period_year = extract(year from new_record_date)::integer
      and period_month = extract(month from new_record_date)::integer;
  end if;

  return coalesce(new, old);
end;
$$;

-- Vytvoří nebo přepočítá měsíční uzávěrku přímo nad aktuálními daty.
create or replace function public.recalculate_vehicle_logbook_monthly_closure(
  p_vehicle_id uuid,
  p_period_year integer,
  p_period_month integer
)
returns public.vehicle_logbook_monthly_closures
language plpgsql
security definer
set search_path = public
as $$
declare
  period_start date;
  period_end date;
  result_row public.vehicle_logbook_monthly_closures%rowtype;
  first_odometer integer;
  last_odometer integer;
  total_business_km integer;
  total_private_km integer;
  total_trip_count integer;
  total_fuel_count integer;
  total_fuel_net numeric(14, 2);
  total_fuel_vat numeric(14, 2);
  total_fuel_gross numeric(14, 2);
begin
  if not public.current_user_is_vehicle_logbook_admin() then
    raise exception 'Nemáte oprávnění spravovat Knihy jízd.';
  end if;

  if p_period_year not between 2000 and 2200
    or p_period_month not between 1 and 12 then
    raise exception 'Neplatný měsíc uzávěrky.';
  end if;

  if not exists (
    select 1
    from public.vehicle_logbook_vehicles
    where id = p_vehicle_id
  ) then
    raise exception 'Vybrané vozidlo neexistuje.';
  end if;

  period_start := make_date(p_period_year, p_period_month, 1);
  period_end := (period_start + interval '1 month')::date;

  select entry.odometer_start_km
  into first_odometer
  from public.vehicle_logbook_entries entry
  where entry.vehicle_id = p_vehicle_id
    and entry.deleted_at is null
    and entry.trip_date >= period_start
    and entry.trip_date < period_end
  order by entry.trip_date asc, entry.day_sequence asc, entry.created_at asc
  limit 1;

  select entry.odometer_end_km
  into last_odometer
  from public.vehicle_logbook_entries entry
  where entry.vehicle_id = p_vehicle_id
    and entry.deleted_at is null
    and entry.trip_date >= period_start
    and entry.trip_date < period_end
  order by entry.trip_date desc, entry.day_sequence desc, entry.created_at desc
  limit 1;

  select
    coalesce(sum(entry.business_km), 0)::integer,
    coalesce(sum(entry.private_km), 0)::integer,
    count(*)::integer
  into
    total_business_km,
    total_private_km,
    total_trip_count
  from public.vehicle_logbook_entries entry
  where entry.vehicle_id = p_vehicle_id
    and entry.deleted_at is null
    and entry.trip_date >= period_start
    and entry.trip_date < period_end;

  select
    count(*)::integer,
    coalesce(sum(fuel.net_amount), 0)::numeric(14, 2),
    coalesce(sum(fuel.vat_amount), 0)::numeric(14, 2),
    coalesce(sum(fuel.gross_amount), 0)::numeric(14, 2)
  into
    total_fuel_count,
    total_fuel_net,
    total_fuel_vat,
    total_fuel_gross
  from public.vehicle_logbook_fuel_entries fuel
  where fuel.vehicle_id = p_vehicle_id
    and fuel.deleted_at is null
    and fuel.fueled_on >= period_start
    and fuel.fueled_on < period_end;

  insert into public.vehicle_logbook_monthly_closures (
    vehicle_id,
    period_year,
    period_month,
    opening_odometer_km,
    closing_odometer_km,
    business_km,
    private_km,
    trip_count,
    fuel_entry_count,
    fuel_net_amount,
    fuel_vat_amount,
    fuel_gross_amount,
    changed_after_closure,
    calculated_at,
    calculated_by
  )
  values (
    p_vehicle_id,
    p_period_year,
    p_period_month,
    first_odometer,
    last_odometer,
    total_business_km,
    total_private_km,
    total_trip_count,
    total_fuel_count,
    total_fuel_net,
    total_fuel_vat,
    total_fuel_gross,
    false,
    now(),
    auth.uid()
  )
  on conflict (vehicle_id, period_year, period_month) do update
  set
    opening_odometer_km = excluded.opening_odometer_km,
    closing_odometer_km = excluded.closing_odometer_km,
    business_km = excluded.business_km,
    private_km = excluded.private_km,
    trip_count = excluded.trip_count,
    fuel_entry_count = excluded.fuel_entry_count,
    fuel_net_amount = excluded.fuel_net_amount,
    fuel_vat_amount = excluded.fuel_vat_amount,
    fuel_gross_amount = excluded.fuel_gross_amount,
    changed_after_closure = false,
    calculated_at = now(),
    calculated_by = auth.uid(),
    updated_by = auth.uid(),
    updated_at = now()
  returning * into result_row;

  return result_row;
end;
$$;

-- Potvrdí celý návrh Automatické knihy jízd v jediné transakci.
-- Při jakékoli chybě se neuloží ani počáteční tachometr, dávka, ani jízdy.
create or replace function public.confirm_vehicle_logbook_automatic_trips(
  p_vehicle_id uuid,
  p_period_from date,
  p_period_to date,
  p_departure_city text,
  p_odometer_start_km integer,
  p_odometer_end_km integer,
  p_destinations jsonb,
  p_rows jsonb
)
returns table (created_trips integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  vehicle_row public.vehicle_logbook_vehicles%rowtype;
  previous_odometer integer;
  next_odometer integer;
  generation_batch_id uuid;
  row_item jsonb;
  row_date date;
  row_city text;
  outbound_map_km numeric;
  return_map_km numeric;
  outbound_km integer;
  return_km integer;
  running_odometer integer;
  outbound_end integer;
  return_end integer;
  assigned_total integer := 0;
  inserted_count integer := 0;
  used_dates date[] := array[]::date[];
begin
  if not public.current_user_is_vehicle_logbook_admin() then
    raise exception 'Nemáte oprávnění spravovat Knihy jízd.';
  end if;

  if p_period_from is null
    or p_period_to is null
    or p_period_to < p_period_from
    or p_period_to > timezone('Europe/Prague', now())::date then
    raise exception 'Období automatických jízd není platné.';
  end if;

  if p_departure_city is null
    or length(btrim(p_departure_city)) = 0
    or length(btrim(p_departure_city)) > 120 then
    raise exception 'Výjezdové místo není platné.';
  end if;

  if p_odometer_start_km is null
    or p_odometer_end_km is null
    or p_odometer_start_km < 0
    or p_odometer_end_km <= p_odometer_start_km then
    raise exception 'Stavy tachometru nejsou platné.';
  end if;

  if p_destinations is null
    or p_rows is null
    or jsonb_typeof(p_destinations) <> 'array'
    or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_destinations) > 15
    or jsonb_array_length(p_rows) = 0
    or jsonb_array_length(p_rows) > 50 then
    raise exception 'Návrh automatických jízd není platný.';
  end if;

  select *
  into vehicle_row
  from public.vehicle_logbook_vehicles
  where id = p_vehicle_id
    and is_active = true
  for update;

  if not found then
    raise exception 'Vybrané aktivní vozidlo neexistuje.';
  end if;

  if exists (
    select 1
    from public.vehicle_logbook_entries entry
    where entry.vehicle_id = p_vehicle_id
      and entry.deleted_at is null
      and entry.trip_date between p_period_from and p_period_to
  ) then
    raise exception 'Ve zvoleném období už existují jízdy.';
  end if;

  select entry.odometer_end_km
  into previous_odometer
  from public.vehicle_logbook_entries entry
  where entry.vehicle_id = p_vehicle_id
    and entry.deleted_at is null
    and entry.trip_date < p_period_from
  order by entry.trip_date desc, entry.day_sequence desc, entry.created_at desc
  limit 1;

  if previous_odometer is not null
    and previous_odometer <> p_odometer_start_km then
    raise exception
      'Počáteční stav musí navazovat na předchozích % km.',
      previous_odometer;
  end if;

  select entry.odometer_start_km
  into next_odometer
  from public.vehicle_logbook_entries entry
  where entry.vehicle_id = p_vehicle_id
    and entry.deleted_at is null
    and entry.trip_date > p_period_to
  order by entry.trip_date asc, entry.day_sequence asc, entry.created_at asc
  limit 1;

  if next_odometer is not null
    and next_odometer <> p_odometer_end_km then
    raise exception
      'Konečný stav musí navazovat na následujících % km.',
      next_odometer;
  end if;

  for row_item in
    select value
    from jsonb_array_elements(p_rows)
  loop
    begin
      row_date := (row_item ->> 'date')::date;
      row_city := btrim(row_item ->> 'city');
      outbound_map_km := (row_item ->> 'outbound_map_km')::numeric;
      return_map_km := (row_item ->> 'return_map_km')::numeric;
      outbound_km := (row_item ->> 'outbound_km')::integer;
      return_km := (row_item ->> 'return_km')::integer;
    exception
      when others then
        raise exception 'Návrh obsahuje neplatný řádek.';
    end;

    if row_date is null
      or row_city is null
      or outbound_map_km is null
      or return_map_km is null
      or outbound_km is null
      or return_km is null
      or row_date < p_period_from
      or row_date > p_period_to
      or extract(isodow from row_date) not between 1 and 5
      or row_date = any(used_dates)
      or length(row_city) = 0
      or length(row_city) > 120
      or outbound_map_km < 1
      or return_map_km < 1
      or outbound_km < 1
      or return_km < 1 then
      raise exception 'Návrh obsahuje neplatnou nebo duplicitní jízdu.';
    end if;

    used_dates := array_append(used_dates, row_date);
    assigned_total := assigned_total + outbound_km + return_km;
  end loop;

  if assigned_total <> p_odometer_end_km - p_odometer_start_km then
    raise exception 'Kilometry návrhu neodpovídají stavům tachometru.';
  end if;

  if previous_odometer is null then
    update public.vehicle_logbook_vehicles
    set
      initial_odometer_km = p_odometer_start_km,
      initial_odometer_recorded_on = p_period_from,
      updated_by = auth.uid()
    where id = p_vehicle_id;
  end if;

  insert into public.vehicle_logbook_generation_batches (
    vehicle_id,
    period_from,
    period_to,
    departure_city,
    requested_odometer_start_km,
    requested_odometer_end_km,
    parameters,
    status,
    confirmed_at,
    confirmed_by,
    created_by,
    updated_by
  )
  values (
    p_vehicle_id,
    p_period_from,
    p_period_to,
    btrim(p_departure_city),
    p_odometer_start_km,
    p_odometer_end_km,
    jsonb_build_object(
      'destinations', p_destinations,
      'rows', p_rows,
      'routing', 'fastest',
      'map_data', 'OpenStreetMap',
      'geocoding', 'Nominatim',
      'routing_engine', 'OSRM'
    ),
    'confirmed',
    now(),
    auth.uid(),
    auth.uid(),
    auth.uid()
  )
  returning id into generation_batch_id;

  running_odometer := p_odometer_start_km;
  for row_item in
    select value
    from jsonb_array_elements(p_rows)
    order by value ->> 'date'
  loop
    row_date := (row_item ->> 'date')::date;
    row_city := btrim(row_item ->> 'city');
    outbound_map_km := (row_item ->> 'outbound_map_km')::numeric;
    return_map_km := (row_item ->> 'return_map_km')::numeric;
    outbound_km := (row_item ->> 'outbound_km')::integer;
    return_km := (row_item ->> 'return_km')::integer;
    outbound_end := running_odometer + outbound_km;
    return_end := outbound_end + return_km;

    insert into public.vehicle_logbook_entries (
      vehicle_id,
      generation_batch_id,
      entry_type,
      usage_type,
      source_type,
      trip_date,
      day_sequence,
      origin,
      destination,
      purpose,
      odometer_start_km,
      odometer_end_km,
      business_km,
      private_km,
      calculated_route_km,
      note,
      created_by,
      updated_by
    )
    values
      (
        p_vehicle_id,
        generation_batch_id,
        'trip',
        'business',
        'automatic_reconstruction',
        row_date,
        1,
        btrim(p_departure_city),
        row_city,
        'Služební, jednání / průzkum',
        running_odometer,
        outbound_end,
        outbound_km,
        0,
        round(outbound_map_km)::integer,
        null,
        auth.uid(),
        auth.uid()
      ),
      (
        p_vehicle_id,
        generation_batch_id,
        'trip',
        'business',
        'automatic_reconstruction',
        row_date,
        2,
        row_city,
        btrim(p_departure_city),
        'Služební, jednání / průzkum',
        outbound_end,
        return_end,
        return_km,
        0,
        round(return_map_km)::integer,
        null,
        auth.uid(),
        auth.uid()
      );

    running_odometer := return_end;
    inserted_count := inserted_count + 2;
  end loop;

  return query select inserted_count;
end;
$$;

-- Timestamp triggery.
drop trigger if exists vehicle_logbook_vehicles_touch_updated_at
  on public.vehicle_logbook_vehicles;
create trigger vehicle_logbook_vehicles_touch_updated_at
before update on public.vehicle_logbook_vehicles
for each row execute function public.vehicle_logbook_touch_updated_at();

drop trigger if exists vehicle_logbook_generation_batches_touch_updated_at
  on public.vehicle_logbook_generation_batches;
create trigger vehicle_logbook_generation_batches_touch_updated_at
before update on public.vehicle_logbook_generation_batches
for each row execute function public.vehicle_logbook_touch_updated_at();

drop trigger if exists vehicle_logbook_entries_touch_updated_at
  on public.vehicle_logbook_entries;
create trigger vehicle_logbook_entries_touch_updated_at
before update on public.vehicle_logbook_entries
for each row execute function public.vehicle_logbook_touch_updated_at();

drop trigger if exists vehicle_logbook_fuel_entries_touch_updated_at
  on public.vehicle_logbook_fuel_entries;
create trigger vehicle_logbook_fuel_entries_touch_updated_at
before update on public.vehicle_logbook_fuel_entries
for each row execute function public.vehicle_logbook_touch_updated_at();

drop trigger if exists vehicle_logbook_monthly_closures_touch_updated_at
  on public.vehicle_logbook_monthly_closures;
create trigger vehicle_logbook_monthly_closures_touch_updated_at
before update on public.vehicle_logbook_monthly_closures
for each row execute function public.vehicle_logbook_touch_updated_at();

-- Snapshoty vozidla na jednotlivých účetních záznamech.
drop trigger if exists vehicle_logbook_entries_fill_vehicle_snapshot
  on public.vehicle_logbook_entries;
create trigger vehicle_logbook_entries_fill_vehicle_snapshot
before insert or update on public.vehicle_logbook_entries
for each row execute function public.vehicle_logbook_fill_vehicle_snapshot();

drop trigger if exists vehicle_logbook_fuel_entries_fill_vehicle_snapshot
  on public.vehicle_logbook_fuel_entries;
create trigger vehicle_logbook_fuel_entries_fill_vehicle_snapshot
before insert or update on public.vehicle_logbook_fuel_entries
for each row execute function public.vehicle_logbook_fill_vehicle_snapshot();

-- Synchronizace s Majetkem.
drop trigger if exists assets_sync_vehicle_logbook
  on public.assets;
create trigger assets_sync_vehicle_logbook
after insert or update or delete on public.assets
for each row execute function public.sync_vehicle_logbook_vehicle_trigger();

drop trigger if exists asset_vehicle_details_sync_vehicle_logbook
  on public.asset_vehicle_details;
create trigger asset_vehicle_details_sync_vehicle_logbook
after insert or update or delete on public.asset_vehicle_details
for each row execute function public.sync_vehicle_logbook_vehicle_trigger();

-- Audit.
drop trigger if exists vehicle_logbook_vehicles_audit
  on public.vehicle_logbook_vehicles;
create trigger vehicle_logbook_vehicles_audit
after insert or update or delete on public.vehicle_logbook_vehicles
for each row execute function public.audit_vehicle_logbook_record();

drop trigger if exists vehicle_logbook_generation_batches_audit
  on public.vehicle_logbook_generation_batches;
create trigger vehicle_logbook_generation_batches_audit
after insert or update or delete on public.vehicle_logbook_generation_batches
for each row execute function public.audit_vehicle_logbook_record();

drop trigger if exists vehicle_logbook_entries_audit
  on public.vehicle_logbook_entries;
create trigger vehicle_logbook_entries_audit
after insert or update or delete on public.vehicle_logbook_entries
for each row execute function public.audit_vehicle_logbook_record();

drop trigger if exists vehicle_logbook_fuel_entries_audit
  on public.vehicle_logbook_fuel_entries;
create trigger vehicle_logbook_fuel_entries_audit
after insert or update or delete on public.vehicle_logbook_fuel_entries
for each row execute function public.audit_vehicle_logbook_record();

drop trigger if exists vehicle_logbook_fuel_attachments_audit
  on public.vehicle_logbook_fuel_attachments;
create trigger vehicle_logbook_fuel_attachments_audit
after insert or update or delete on public.vehicle_logbook_fuel_attachments
for each row execute function public.audit_vehicle_logbook_record();

drop trigger if exists vehicle_logbook_monthly_closures_audit
  on public.vehicle_logbook_monthly_closures;
create trigger vehicle_logbook_monthly_closures_audit
after insert or update or delete on public.vehicle_logbook_monthly_closures
for each row execute function public.audit_vehicle_logbook_record();

-- Označení uzávěrky po změně zdrojových dat.
drop trigger if exists vehicle_logbook_entries_mark_closure_changed
  on public.vehicle_logbook_entries;
create trigger vehicle_logbook_entries_mark_closure_changed
after insert or update or delete on public.vehicle_logbook_entries
for each row execute function public.mark_vehicle_logbook_closure_changed();

drop trigger if exists vehicle_logbook_fuel_entries_mark_closure_changed
  on public.vehicle_logbook_fuel_entries;
create trigger vehicle_logbook_fuel_entries_mark_closure_changed
after insert or update or delete on public.vehicle_logbook_fuel_entries
for each row execute function public.mark_vehicle_logbook_closure_changed();

-- Prvotní načtení již existujících osobních vozů.
insert into public.vehicle_logbook_vehicles (
  source_asset_id,
  asset_id,
  asset_name,
  registration_plate,
  vin,
  brand,
  model,
  year_of_manufacture,
  insurance_expires_on,
  stk_expires_on,
  source_status,
  is_active,
  initial_odometer_km,
  initial_odometer_recorded_on
)
select
  asset.id,
  asset.id,
  asset.name,
  detail.registration_plate,
  detail.vin,
  detail.brand,
  detail.model,
  detail.year_of_manufacture,
  detail.insurance_expires_on,
  detail.stk_expires_on,
  case when asset.status = 'active' then 'active' else 'sold' end,
  asset.status = 'active',
  detail.mileage_km,
  case when detail.mileage_km is not null then current_date end
from public.assets asset
join public.asset_categories category on category.id = asset.category_id
join public.asset_vehicle_details detail on detail.asset_id = asset.id
where category.icon_key = 'car'
  or lower(category.name) = 'osobní vozy'
on conflict (source_asset_id) do update
set
  asset_id = excluded.asset_id,
  asset_name = excluded.asset_name,
  registration_plate = excluded.registration_plate,
  vin = excluded.vin,
  brand = excluded.brand,
  model = excluded.model,
  year_of_manufacture = excluded.year_of_manufacture,
  insurance_expires_on = excluded.insurance_expires_on,
  stk_expires_on = excluded.stk_expires_on,
  source_status = excluded.source_status,
  is_active = excluded.is_active,
  initial_odometer_km = coalesce(
    public.vehicle_logbook_vehicles.initial_odometer_km,
    excluded.initial_odometer_km
  ),
  initial_odometer_recorded_on = coalesce(
    public.vehicle_logbook_vehicles.initial_odometer_recorded_on,
    excluded.initial_odometer_recorded_on
  ),
  updated_at = now();

-- RLS: přímé fyzické mazání účetních záznamů není povolené.
alter table public.vehicle_logbook_vehicles enable row level security;
alter table public.vehicle_logbook_generation_batches enable row level security;
alter table public.vehicle_logbook_entries enable row level security;
alter table public.vehicle_logbook_fuel_entries enable row level security;
alter table public.vehicle_logbook_fuel_attachments enable row level security;
alter table public.vehicle_logbook_monthly_closures enable row level security;
alter table public.vehicle_logbook_audit enable row level security;

drop policy if exists "Admins can read vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles;
create policy "Admins can read vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles;
create policy "Admins can insert vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles for insert
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can update vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles;
create policy "Admins can update vehicle logbook vehicles"
  on public.vehicle_logbook_vehicles for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook batches"
  on public.vehicle_logbook_generation_batches;
create policy "Admins can read vehicle logbook batches"
  on public.vehicle_logbook_generation_batches for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook batches"
  on public.vehicle_logbook_generation_batches;
create policy "Admins can insert vehicle logbook batches"
  on public.vehicle_logbook_generation_batches for insert
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can update vehicle logbook batches"
  on public.vehicle_logbook_generation_batches;
create policy "Admins can update vehicle logbook batches"
  on public.vehicle_logbook_generation_batches for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook entries"
  on public.vehicle_logbook_entries;
create policy "Admins can read vehicle logbook entries"
  on public.vehicle_logbook_entries for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook entries"
  on public.vehicle_logbook_entries;
create policy "Admins can insert vehicle logbook entries"
  on public.vehicle_logbook_entries for insert
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can update vehicle logbook entries"
  on public.vehicle_logbook_entries;
create policy "Admins can update vehicle logbook entries"
  on public.vehicle_logbook_entries for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries;
create policy "Admins can read vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries;
create policy "Admins can insert vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries for insert
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can update vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries;
create policy "Admins can update vehicle logbook fuel entries"
  on public.vehicle_logbook_fuel_entries for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments;
create policy "Admins can read vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments;
create policy "Admins can insert vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments for insert
  with check (
    public.current_user_is_vehicle_logbook_admin()
    and uploaded_by = auth.uid()
  );

drop policy if exists "Admins can update vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments;
create policy "Admins can update vehicle logbook fuel attachments"
  on public.vehicle_logbook_fuel_attachments for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures;
create policy "Admins can read vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures for select
  using (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can insert vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures;
create policy "Admins can insert vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures for insert
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can update vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures;
create policy "Admins can update vehicle logbook closures"
  on public.vehicle_logbook_monthly_closures for update
  using (public.current_user_is_vehicle_logbook_admin())
  with check (public.current_user_is_vehicle_logbook_admin());

drop policy if exists "Admins can read vehicle logbook audit"
  on public.vehicle_logbook_audit;
create policy "Admins can read vehicle logbook audit"
  on public.vehicle_logbook_audit for select
  using (public.current_user_is_vehicle_logbook_admin());

grant select, insert, update
  on public.vehicle_logbook_vehicles,
     public.vehicle_logbook_generation_batches,
     public.vehicle_logbook_entries,
     public.vehicle_logbook_fuel_entries,
     public.vehicle_logbook_fuel_attachments,
     public.vehicle_logbook_monthly_closures
  to authenticated;

grant select on public.vehicle_logbook_audit to authenticated;

revoke delete
  on public.vehicle_logbook_vehicles,
     public.vehicle_logbook_generation_batches,
     public.vehicle_logbook_entries,
     public.vehicle_logbook_fuel_entries,
     public.vehicle_logbook_fuel_attachments,
     public.vehicle_logbook_monthly_closures
  from anon, authenticated;

revoke insert, update, delete
  on public.vehicle_logbook_audit
  from anon, authenticated;

revoke all on function public.sync_vehicle_logbook_vehicle(uuid)
  from public, anon, authenticated;

revoke all on function public.recalculate_vehicle_logbook_monthly_closure(uuid, integer, integer)
  from public, anon;
grant execute on function public.recalculate_vehicle_logbook_monthly_closure(uuid, integer, integer)
  to authenticated;

revoke all on function public.confirm_vehicle_logbook_automatic_trips(
  uuid, date, date, text, integer, integer, jsonb, jsonb
) from public, anon;
grant execute on function public.confirm_vehicle_logbook_automatic_trips(
  uuid, date, date, text, integer, integer, jsonb, jsonb
) to authenticated;

-- Soukromý bucket pro účtenky a daňové doklady k tankování.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'vehicle-logbook-files',
  'vehicle-logbook-files',
  false,
  26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read vehicle logbook files"
  on storage.objects;
create policy "Admins can read vehicle logbook files"
  on storage.objects for select
  using (
    bucket_id = 'vehicle-logbook-files'
    and split_part(name, '/', 1) = 'knihy-jizd'
    and public.current_user_is_vehicle_logbook_admin()
  );

drop policy if exists "Admins can upload vehicle logbook files"
  on storage.objects;
create policy "Admins can upload vehicle logbook files"
  on storage.objects for insert
  with check (
    bucket_id = 'vehicle-logbook-files'
    and split_part(name, '/', 1) = 'knihy-jizd'
    and public.current_user_is_vehicle_logbook_admin()
  );

drop policy if exists "Admins can update vehicle logbook files"
  on storage.objects;
create policy "Admins can update vehicle logbook files"
  on storage.objects for update
  using (
    bucket_id = 'vehicle-logbook-files'
    and split_part(name, '/', 1) = 'knihy-jizd'
    and public.current_user_is_vehicle_logbook_admin()
  )
  with check (
    bucket_id = 'vehicle-logbook-files'
    and split_part(name, '/', 1) = 'knihy-jizd'
    and public.current_user_is_vehicle_logbook_admin()
  );

drop policy if exists "Admins can delete vehicle logbook files"
  on storage.objects;
create policy "Admins can delete vehicle logbook files"
  on storage.objects for delete
  using (
    bucket_id = 'vehicle-logbook-files'
    and split_part(name, '/', 1) = 'knihy-jizd'
    and public.current_user_is_vehicle_logbook_admin()
  );

commit;
