create or replace function public.current_user_is_majetek_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
      and coalesce(profiles.majetek, false) = true
  )
$$;

alter table public.asset_categories enable row level security;
alter table public.asset_document_types enable row level security;
alter table public.assets enable row level security;
alter table public.asset_vehicle_details enable row level security;
alter table public.asset_real_estate_details enable row level security;
alter table public.asset_rentals enable row level security;
alter table public.asset_rental_service_advance_history enable row level security;
alter table public.asset_insurance_details enable row level security;
alter table public.asset_rental_service_settlement_custom_items enable row level security;
alter table public.asset_electricity_details enable row level security;
alter table public.asset_electronics_details enable row level security;
alter table public.asset_documents enable row level security;
alter table public.asset_photos enable row level security;
alter table public.asset_notes enable row level security;

drop policy if exists "Admins can read asset categories" on public.asset_categories;
create policy "Admins can read asset categories"
  on public.asset_categories
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset categories" on public.asset_categories;
create policy "Admins can insert asset categories"
  on public.asset_categories
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset categories" on public.asset_categories;
create policy "Admins can update asset categories"
  on public.asset_categories
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete unused asset categories" on public.asset_categories;
create policy "Admins can delete unused asset categories"
  on public.asset_categories
  for delete
  using (
    public.current_user_is_majetek_admin()
    and not exists (
      select 1
      from public.assets
      where assets.category_id = asset_categories.id
    )
  );

drop policy if exists "Admins can read asset document types" on public.asset_document_types;
create policy "Admins can read asset document types"
  on public.asset_document_types
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset document types" on public.asset_document_types;
create policy "Admins can insert asset document types"
  on public.asset_document_types
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset document types" on public.asset_document_types;
create policy "Admins can update asset document types"
  on public.asset_document_types
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete unused asset document types" on public.asset_document_types;
create policy "Admins can delete unused asset document types"
  on public.asset_document_types
  for delete
  using (
    public.current_user_is_majetek_admin()
    and not exists (
      select 1
      from public.asset_documents
      where asset_documents.document_type_id = asset_document_types.id
    )
  );

drop policy if exists "Admins can read assets" on public.assets;
create policy "Admins can read assets"
  on public.assets
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert assets" on public.assets;
create policy "Admins can insert assets"
  on public.assets
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update assets" on public.assets;
create policy "Admins can update assets"
  on public.assets
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete assets" on public.assets;
create policy "Admins can delete assets"
  on public.assets
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset vehicle details" on public.asset_vehicle_details;
create policy "Admins can read asset vehicle details"
  on public.asset_vehicle_details
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset vehicle details" on public.asset_vehicle_details;
create policy "Admins can insert asset vehicle details"
  on public.asset_vehicle_details
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset vehicle details" on public.asset_vehicle_details;
create policy "Admins can update asset vehicle details"
  on public.asset_vehicle_details
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset vehicle details" on public.asset_vehicle_details;
create policy "Admins can delete asset vehicle details"
  on public.asset_vehicle_details
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset insurance details" on public.asset_insurance_details;
create policy "Admins can read asset insurance details"
  on public.asset_insurance_details
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset insurance details" on public.asset_insurance_details;
create policy "Admins can insert asset insurance details"
  on public.asset_insurance_details
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset insurance details" on public.asset_insurance_details;
create policy "Admins can update asset insurance details"
  on public.asset_insurance_details
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset insurance details" on public.asset_insurance_details;
create policy "Admins can delete asset insurance details"
  on public.asset_insurance_details
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset real estate details" on public.asset_real_estate_details;
create policy "Admins can read asset real estate details"
  on public.asset_real_estate_details
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset real estate details" on public.asset_real_estate_details;
create policy "Admins can insert asset real estate details"
  on public.asset_real_estate_details
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset real estate details" on public.asset_real_estate_details;
create policy "Admins can update asset real estate details"
  on public.asset_real_estate_details
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset real estate details" on public.asset_real_estate_details;
create policy "Admins can delete asset real estate details"
  on public.asset_real_estate_details
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset rentals" on public.asset_rentals;
create policy "Admins can read asset rentals"
  on public.asset_rentals
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset rentals" on public.asset_rentals;
create policy "Admins can insert asset rentals"
  on public.asset_rentals
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset rentals" on public.asset_rentals;
create policy "Admins can update asset rentals"
  on public.asset_rentals
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset rentals" on public.asset_rentals;
create policy "Admins can delete asset rentals"
  on public.asset_rentals
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read rental service advances" on public.asset_rental_service_advance_history;
create policy "Admins can read rental service advances"
  on public.asset_rental_service_advance_history
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert rental service advances" on public.asset_rental_service_advance_history;
create policy "Admins can insert rental service advances"
  on public.asset_rental_service_advance_history
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update rental service advances" on public.asset_rental_service_advance_history;
create policy "Admins can update rental service advances"
  on public.asset_rental_service_advance_history
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete rental service advances" on public.asset_rental_service_advance_history;
create policy "Admins can delete rental service advances"
  on public.asset_rental_service_advance_history
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read settlement custom items" on public.asset_rental_service_settlement_custom_items;
create policy "Admins can read settlement custom items"
  on public.asset_rental_service_settlement_custom_items
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert settlement custom items" on public.asset_rental_service_settlement_custom_items;
create policy "Admins can insert settlement custom items"
  on public.asset_rental_service_settlement_custom_items
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update settlement custom items" on public.asset_rental_service_settlement_custom_items;
create policy "Admins can update settlement custom items"
  on public.asset_rental_service_settlement_custom_items
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete settlement custom items" on public.asset_rental_service_settlement_custom_items;
create policy "Admins can delete settlement custom items"
  on public.asset_rental_service_settlement_custom_items
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset electricity details" on public.asset_electricity_details;
create policy "Admins can read asset electricity details"
  on public.asset_electricity_details
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset electricity details" on public.asset_electricity_details;
create policy "Admins can insert asset electricity details"
  on public.asset_electricity_details
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset electricity details" on public.asset_electricity_details;
create policy "Admins can update asset electricity details"
  on public.asset_electricity_details
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset electricity details" on public.asset_electricity_details;
create policy "Admins can delete asset electricity details"
  on public.asset_electricity_details
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset electronics details" on public.asset_electronics_details;
create policy "Admins can read asset electronics details"
  on public.asset_electronics_details
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset electronics details" on public.asset_electronics_details;
create policy "Admins can insert asset electronics details"
  on public.asset_electronics_details
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update asset electronics details" on public.asset_electronics_details;
create policy "Admins can update asset electronics details"
  on public.asset_electronics_details
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset electronics details" on public.asset_electronics_details;
create policy "Admins can delete asset electronics details"
  on public.asset_electronics_details
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset documents" on public.asset_documents;
create policy "Admins can read asset documents"
  on public.asset_documents
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset documents" on public.asset_documents;
create policy "Admins can insert asset documents"
  on public.asset_documents
  for insert
  with check (public.current_user_is_majetek_admin() and uploaded_by = auth.uid());

drop policy if exists "Admins can update asset documents" on public.asset_documents;
create policy "Admins can update asset documents"
  on public.asset_documents
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset documents" on public.asset_documents;
create policy "Admins can delete asset documents"
  on public.asset_documents
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset photos" on public.asset_photos;
create policy "Admins can read asset photos"
  on public.asset_photos
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset photos" on public.asset_photos;
create policy "Admins can insert asset photos"
  on public.asset_photos
  for insert
  with check (public.current_user_is_majetek_admin() and uploaded_by = auth.uid());

drop policy if exists "Admins can update asset photos" on public.asset_photos;
create policy "Admins can update asset photos"
  on public.asset_photos
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset photos" on public.asset_photos;
create policy "Admins can delete asset photos"
  on public.asset_photos
  for delete
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can read asset notes" on public.asset_notes;
create policy "Admins can read asset notes"
  on public.asset_notes
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert asset notes" on public.asset_notes;
create policy "Admins can insert asset notes"
  on public.asset_notes
  for insert
  with check (public.current_user_is_majetek_admin() and created_by = auth.uid());

drop policy if exists "Admins can update asset notes" on public.asset_notes;
create policy "Admins can update asset notes"
  on public.asset_notes
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete asset notes" on public.asset_notes;
create policy "Admins can delete asset notes"
  on public.asset_notes
  for delete
  using (public.current_user_is_majetek_admin());

alter table public.assets
  drop constraint if exists assets_status_sale_date_check;

alter table public.assets
  add constraint assets_status_sale_date_check
  check (status <> 'sold' or sale_date is not null);
