alter table public.asset_rental_service_settlements
  add column if not exists settled_on date;

alter table public.asset_rental_service_settlements
  add column if not exists settled_by uuid references public.profiles(id) on delete set null;

alter table public.asset_rental_service_settlements
  add column if not exists settled_note text;
