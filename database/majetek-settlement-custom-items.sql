create table if not exists public.asset_rental_service_settlement_custom_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.asset_rental_service_settlements(id) on delete cascade,
  title text not null,
  amount numeric(14,2) not null check (amount >= 0),
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asset_rental_service_settlement_custom_items_settlement_id_sort_order_idx
  on public.asset_rental_service_settlement_custom_items (settlement_id, sort_order asc, created_at asc);

drop trigger if exists asset_rental_service_settlement_custom_items_touch_updated_at on public.asset_rental_service_settlement_custom_items;
create trigger asset_rental_service_settlement_custom_items_touch_updated_at
before update on public.asset_rental_service_settlement_custom_items
for each row execute function public.touch_updated_at();

alter table public.asset_rental_service_settlement_custom_items enable row level security;

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

create or replace function public.upsert_asset_rental_service_settlement_with_custom_items(
  p_settlement_id uuid,
  p_asset_id uuid,
  p_rental_id uuid,
  p_settlement_code text,
  p_period_from date,
  p_period_to date,
  p_tenant_name_snapshot text,
  p_tenant_contact_snapshot text,
  p_status text,
  p_electricity_amount numeric,
  p_hot_water_heating_amount numeric,
  p_space_heating_amount numeric,
  p_common_area_cleaning_amount numeric,
  p_cold_water_sewer_amount numeric,
  p_hot_water_sewer_amount numeric,
  p_advance_payments_total_amount numeric,
  p_service_total_amount numeric,
  p_balance_amount numeric,
  p_note text,
  p_closed_at timestamptz,
  p_closed_by uuid,
  p_created_by uuid,
  p_custom_items jsonb
)
returns table(settlement_id uuid, settlement_code text)
language plpgsql
as $$
declare
  v_settlement_id uuid;
begin
  if p_settlement_id is null then
    insert into public.asset_rental_service_settlements (
      asset_id,
      rental_id,
      settlement_code,
      period_from,
      period_to,
      tenant_name_snapshot,
      tenant_contact_snapshot,
      status,
      electricity_amount,
      hot_water_heating_amount,
      space_heating_amount,
      common_area_cleaning_amount,
      cold_water_sewer_amount,
      hot_water_sewer_amount,
      advance_payments_total_amount,
      service_total_amount,
      balance_amount,
      note,
      closed_at,
      closed_by,
      created_by
    ) values (
      p_asset_id,
      p_rental_id,
      p_settlement_code,
      p_period_from,
      p_period_to,
      p_tenant_name_snapshot,
      p_tenant_contact_snapshot,
      p_status,
      p_electricity_amount,
      p_hot_water_heating_amount,
      p_space_heating_amount,
      p_common_area_cleaning_amount,
      p_cold_water_sewer_amount,
      p_hot_water_sewer_amount,
      p_advance_payments_total_amount,
      p_service_total_amount,
      p_balance_amount,
      p_note,
      p_closed_at,
      p_closed_by,
      p_created_by
    )
    returning id into v_settlement_id;
  else
    update public.asset_rental_service_settlements
    set
      asset_id = p_asset_id,
      rental_id = p_rental_id,
      settlement_code = p_settlement_code,
      period_from = p_period_from,
      period_to = p_period_to,
      tenant_name_snapshot = p_tenant_name_snapshot,
      tenant_contact_snapshot = p_tenant_contact_snapshot,
      status = p_status,
      electricity_amount = p_electricity_amount,
      hot_water_heating_amount = p_hot_water_heating_amount,
      space_heating_amount = p_space_heating_amount,
      common_area_cleaning_amount = p_common_area_cleaning_amount,
      cold_water_sewer_amount = p_cold_water_sewer_amount,
      hot_water_sewer_amount = p_hot_water_sewer_amount,
      advance_payments_total_amount = p_advance_payments_total_amount,
      service_total_amount = p_service_total_amount,
      balance_amount = p_balance_amount,
      note = p_note,
      closed_at = p_closed_at,
      closed_by = p_closed_by,
      created_by = p_created_by
    where id = p_settlement_id
    returning id into v_settlement_id;

    if v_settlement_id is null then
      raise exception 'Vyúčtování nebylo nalezeno.';
    end if;
  end if;

  delete from public.asset_rental_service_settlement_custom_items
  where settlement_id = v_settlement_id;

  insert into public.asset_rental_service_settlement_custom_items (
    settlement_id,
    title,
    amount,
    sort_order,
    created_by
  )
  select
    v_settlement_id,
    nullif(trim(item.title), ''),
    item.amount,
    coalesce(item.sort_order, 0),
    p_created_by
  from jsonb_to_recordset(coalesce(p_custom_items, '[]'::jsonb)) as item(
    title text,
    amount numeric,
    sort_order integer
  )
  where nullif(trim(item.title), '') is not null;

  settlement_id := v_settlement_id;
  settlement_code := p_settlement_code;
  return next;
end;
$$;
