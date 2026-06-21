create or replace function public.upsert_asset_rental_with_service_advance(
  p_asset_id uuid,
  p_tenant_name text,
  p_start_date date,
  p_rental_id uuid default null,
  p_tenant_contact text default null,
  p_end_date date default null,
  p_monthly_rent numeric default null,
  p_deposit_amount numeric default null,
  p_note text default null,
  p_service_advance_id uuid default null,
  p_service_advance_effective_from date default null,
  p_service_advance_monthly_advance numeric default null,
  p_service_advance_note text default null,
  p_actor_user_id uuid default null
)
returns table(rental_id uuid, advance_id uuid)
language plpgsql
as $$
declare
  v_rental_id uuid;
  v_advance_id uuid;
begin
  if p_rental_id is null then
    insert into public.asset_rentals (
      asset_id,
      tenant_name,
      tenant_contact,
      start_date,
      end_date,
      monthly_rent,
      deposit_amount,
      note
    ) values (
      p_asset_id,
      p_tenant_name,
      p_tenant_contact,
      p_start_date,
      p_end_date,
      p_monthly_rent,
      p_deposit_amount,
      p_note
    )
    returning id into v_rental_id;
  else
    update public.asset_rentals
    set
      tenant_name = p_tenant_name,
      tenant_contact = p_tenant_contact,
      start_date = p_start_date,
      end_date = p_end_date,
      monthly_rent = p_monthly_rent,
      deposit_amount = p_deposit_amount,
      note = p_note
    where id = p_rental_id
      and asset_id = p_asset_id
    returning id into v_rental_id;

    if v_rental_id is null then
      raise exception 'Pronájem nebyl nalezen.';
    end if;
  end if;

  if p_service_advance_id is not null
    or p_service_advance_effective_from is not null
    or p_service_advance_monthly_advance is not null
    or p_service_advance_note is not null then
    if p_service_advance_effective_from is null or p_service_advance_monthly_advance is null then
      raise exception 'Vyplň měsíc a částku zálohy na služby.';
    end if;

    if p_service_advance_id is null then
      insert into public.asset_rental_service_advance_history (
        rental_id,
        effective_from,
        monthly_advance,
        note,
        created_by
      ) values (
        v_rental_id,
        p_service_advance_effective_from,
        p_service_advance_monthly_advance,
        p_service_advance_note,
        p_actor_user_id
      )
      returning id into v_advance_id;
    else
      update public.asset_rental_service_advance_history
      set
        effective_from = p_service_advance_effective_from,
        monthly_advance = p_service_advance_monthly_advance,
        note = p_service_advance_note
      where id = p_service_advance_id
        and rental_id = v_rental_id
      returning id into v_advance_id;

      if v_advance_id is null then
        raise exception 'Záloha nebyla nalezena.';
      end if;
    end if;
  end if;

  rental_id := v_rental_id;
  advance_id := v_advance_id;
  return next;
end;
$$;
