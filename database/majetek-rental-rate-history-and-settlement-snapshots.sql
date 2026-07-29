begin;

create table if not exists public.asset_rental_rent_history (
  id uuid primary key default gen_random_uuid(),
  rental_id uuid not null references public.asset_rentals(id) on delete cascade,
  effective_from date not null,
  monthly_rent numeric(14,2) not null check (monthly_rent >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_rental_rent_history_effective_from_month_start_check
    check (effective_from = date_trunc('month', effective_from)::date),
  constraint asset_rental_rent_history_rental_month_key
    unique (rental_id, effective_from)
);

create index if not exists asset_rental_rent_history_rental_effective_from_idx
  on public.asset_rental_rent_history (rental_id, effective_from desc, created_at desc);

drop trigger if exists asset_rental_rent_history_touch_updated_at on public.asset_rental_rent_history;
create trigger asset_rental_rent_history_touch_updated_at
before update on public.asset_rental_rent_history
for each row execute function public.touch_updated_at();

alter table public.asset_rental_rent_history enable row level security;
grant select, insert, update, delete on public.asset_rental_rent_history to authenticated;

drop policy if exists "Admins can read rental rent history" on public.asset_rental_rent_history;
create policy "Admins can read rental rent history"
  on public.asset_rental_rent_history
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert rental rent history" on public.asset_rental_rent_history;
create policy "Admins can insert rental rent history"
  on public.asset_rental_rent_history
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update rental rent history" on public.asset_rental_rent_history;
create policy "Admins can update rental rent history"
  on public.asset_rental_rent_history
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete rental rent history" on public.asset_rental_rent_history;
create policy "Admins can delete rental rent history"
  on public.asset_rental_rent_history
  for delete
  using (public.current_user_is_majetek_admin());

insert into public.asset_rental_rent_history (
  rental_id,
  effective_from,
  monthly_rent,
  note,
  created_at,
  updated_at
)
select
  rentals.id,
  date_trunc('month', coalesce(rentals.start_date, rentals.created_at::date))::date,
  rentals.monthly_rent,
  'Automaticky převedeno z původní výše nájemného.',
  rentals.created_at,
  rentals.updated_at
from public.asset_rentals as rentals
where rentals.monthly_rent is not null
on conflict (rental_id, effective_from) do nothing;

create unique index if not exists asset_rental_service_advance_history_rental_month_key
  on public.asset_rental_service_advance_history (rental_id, effective_from);

create table if not exists public.asset_rental_service_settlement_advance_months (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.asset_rental_service_settlements(id) on delete cascade,
  month date not null,
  monthly_advance numeric(14,2) not null check (monthly_advance >= 0),
  source_advance_id uuid references public.asset_rental_service_advance_history(id) on delete set null,
  source_effective_from date,
  created_at timestamptz not null default now(),
  constraint asset_rental_service_settlement_advance_months_month_start_check
    check (month = date_trunc('month', month)::date),
  constraint asset_rental_service_settlement_advance_months_settlement_month_key
    unique (settlement_id, month)
);

create index if not exists asset_rental_service_settlement_advance_months_settlement_idx
  on public.asset_rental_service_settlement_advance_months (settlement_id, month asc);

alter table public.asset_rental_service_settlement_advance_months enable row level security;
grant select, insert, update, delete on public.asset_rental_service_settlement_advance_months to authenticated;

drop policy if exists "Admins can read settlement advance months" on public.asset_rental_service_settlement_advance_months;
create policy "Admins can read settlement advance months"
  on public.asset_rental_service_settlement_advance_months
  for select
  using (public.current_user_is_majetek_admin());

drop policy if exists "Admins can insert settlement advance months" on public.asset_rental_service_settlement_advance_months;
create policy "Admins can insert settlement advance months"
  on public.asset_rental_service_settlement_advance_months
  for insert
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can update settlement advance months" on public.asset_rental_service_settlement_advance_months;
create policy "Admins can update settlement advance months"
  on public.asset_rental_service_settlement_advance_months
  for update
  using (public.current_user_is_majetek_admin())
  with check (public.current_user_is_majetek_admin());

drop policy if exists "Admins can delete settlement advance months" on public.asset_rental_service_settlement_advance_months;
create policy "Admins can delete settlement advance months"
  on public.asset_rental_service_settlement_advance_months
  for delete
  using (public.current_user_is_majetek_admin());

insert into public.asset_rental_service_settlement_advance_months (
  settlement_id,
  month,
  monthly_advance,
  source_advance_id,
  source_effective_from
)
select
  settlements.id,
  months.month_start,
  coalesce(applicable.monthly_advance, 0),
  applicable.id,
  applicable.effective_from
from public.asset_rental_service_settlements as settlements
cross join lateral (
  select generate_series(
    date_trunc('month', settlements.period_from)::date,
    date_trunc('month', settlements.period_to)::date,
    interval '1 month'
  )::date as month_start
) as months
left join lateral (
  select
    history.id,
    history.effective_from,
    history.monthly_advance
  from public.asset_rental_service_advance_history as history
  where history.rental_id = settlements.rental_id
    and history.effective_from <= months.month_start
  order by history.effective_from desc, history.created_at desc
  limit 1
) as applicable on true
on conflict (settlement_id, month) do nothing;

do $$
declare
  v_mismatch_count integer;
begin
  select count(*)
  into v_mismatch_count
  from public.asset_rental_service_settlements as settlements
  join (
    select
      settlement_id,
      sum(monthly_advance) as snapshot_total
    from public.asset_rental_service_settlement_advance_months
    group by settlement_id
  ) as snapshots on snapshots.settlement_id = settlements.id
  where settlements.status = 'closed'
    and snapshots.snapshot_total <> settlements.advance_payments_total_amount;

  if v_mismatch_count > 0 then
    raise exception
      'Migrace byla zastavena: % uzavřených vyúčtování má jiný součet historie záloh než uložený součet.',
      v_mismatch_count;
  end if;
end;
$$;

create or replace function public.guard_closed_settlement_advance_history()
returns trigger
language plpgsql
as $$
declare
  v_rental_id uuid;
  v_effective_from date;
  v_last_closed_month date;
begin
  v_rental_id := case when tg_op = 'DELETE' then old.rental_id else new.rental_id end;
  v_effective_from := case when tg_op = 'DELETE' then old.effective_from else new.effective_from end;

  select max(date_trunc('month', settlements.period_to)::date)
  into v_last_closed_month
  from public.asset_rental_service_settlements as settlements
  where settlements.rental_id = v_rental_id
    and settlements.status = 'closed';

  if v_last_closed_month is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' and v_effective_from <= v_last_closed_month then
    raise exception
      'Zálohu nelze zpětně přidat do období uzavřeného vyúčtování. Nejdříve vyúčtování znovu otevřete.';
  end if;

  if tg_op in ('UPDATE', 'DELETE') and old.effective_from <= v_last_closed_month then
    raise exception
      'Zálohu použitou v uzavřeném vyúčtování nelze změnit ani smazat. Nejdříve vyúčtování znovu otevřete.';
  end if;

  if tg_op = 'UPDATE' and new.effective_from <= v_last_closed_month then
    raise exception
      'Změnu zálohy nelze přesunout do období uzavřeného vyúčtování.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists asset_rental_service_advance_history_guard_closed_settlements
  on public.asset_rental_service_advance_history;
create trigger asset_rental_service_advance_history_guard_closed_settlements
before insert or update or delete on public.asset_rental_service_advance_history
for each row execute function public.guard_closed_settlement_advance_history();

create or replace function public.guard_closed_settlement_accounting_snapshot()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'closed' and (
    new.asset_id is distinct from old.asset_id
    or new.rental_id is distinct from old.rental_id
    or new.settlement_code is distinct from old.settlement_code
    or new.period_from is distinct from old.period_from
    or new.period_to is distinct from old.period_to
    or new.tenant_name_snapshot is distinct from old.tenant_name_snapshot
    or new.tenant_contact_snapshot is distinct from old.tenant_contact_snapshot
    or new.status is distinct from old.status
    or new.electricity_amount is distinct from old.electricity_amount
    or new.hot_water_heating_amount is distinct from old.hot_water_heating_amount
    or new.space_heating_amount is distinct from old.space_heating_amount
    or new.common_area_cleaning_amount is distinct from old.common_area_cleaning_amount
    or new.cold_water_sewer_amount is distinct from old.cold_water_sewer_amount
    or new.hot_water_sewer_amount is distinct from old.hot_water_sewer_amount
    or new.advance_payments_total_amount is distinct from old.advance_payments_total_amount
    or new.note is distinct from old.note
    or new.closed_at is distinct from old.closed_at
    or new.closed_by is distinct from old.closed_by
  ) then
    raise exception 'Uzavřené vyúčtování je neměnný účetní snapshot.';
  end if;

  return new;
end;
$$;

drop trigger if exists asset_rental_service_settlements_guard_closed_snapshot
  on public.asset_rental_service_settlements;
create trigger asset_rental_service_settlements_guard_closed_snapshot
before update on public.asset_rental_service_settlements
for each row execute function public.guard_closed_settlement_accounting_snapshot();

create or replace function public.guard_closed_settlement_advance_month_snapshot()
returns trigger
language plpgsql
as $$
declare
  v_settlement_id uuid;
  v_status text;
begin
  v_settlement_id := case when tg_op = 'DELETE' then old.settlement_id else new.settlement_id end;

  select settlements.status
  into v_status
  from public.asset_rental_service_settlements as settlements
  where settlements.id = v_settlement_id;

  if v_status = 'closed' then
    raise exception 'Měsíční snapshot uzavřeného vyúčtování nelze změnit ani smazat.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists asset_rental_service_settlement_advance_months_guard_closed
  on public.asset_rental_service_settlement_advance_months;
create trigger asset_rental_service_settlement_advance_months_guard_closed
before update or delete on public.asset_rental_service_settlement_advance_months
for each row execute function public.guard_closed_settlement_advance_month_snapshot();

drop function if exists public.upsert_asset_rental_with_service_advance(
  uuid,
  text,
  date,
  uuid,
  text,
  date,
  numeric,
  numeric,
  text,
  uuid,
  date,
  numeric,
  text,
  uuid
);

create function public.upsert_asset_rental_with_service_advance(
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

    if p_monthly_rent is not null then
      insert into public.asset_rental_rent_history (
        rental_id,
        effective_from,
        monthly_rent,
        created_by
      ) values (
        v_rental_id,
        date_trunc('month', p_start_date)::date,
        p_monthly_rent,
        p_actor_user_id
      );
    end if;
  else
    update public.asset_rentals
    set
      tenant_name = p_tenant_name,
      tenant_contact = p_tenant_contact,
      start_date = p_start_date,
      end_date = p_end_date,
      monthly_rent = coalesce(p_monthly_rent, monthly_rent),
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

drop function if exists public.upsert_asset_rental_service_settlement_with_custom_items(
  uuid,
  uuid,
  uuid,
  text,
  date,
  date,
  text,
  text,
  text,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  text,
  timestamptz,
  uuid,
  uuid,
  jsonb
);

create function public.upsert_asset_rental_service_settlement_with_custom_items(
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
  v_existing_status text;
  v_advance_total numeric(14,2);
begin
  select coalesce(sum(coalesce(applicable.monthly_advance, 0)), 0)
  into v_advance_total
  from (
    select generate_series(
      date_trunc('month', p_period_from)::date,
      date_trunc('month', p_period_to)::date,
      interval '1 month'
    )::date as month_start
  ) as months
  left join lateral (
    select history.monthly_advance
    from public.asset_rental_service_advance_history as history
    where history.rental_id = p_rental_id
      and history.effective_from <= months.month_start
    order by history.effective_from desc, history.created_at desc
    limit 1
  ) as applicable on true;

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
      v_advance_total,
      p_note,
      p_closed_at,
      p_closed_by,
      p_created_by
    )
    returning id into v_settlement_id;
  else
    select settlements.status
    into v_existing_status
    from public.asset_rental_service_settlements as settlements
    where settlements.id = p_settlement_id
    for update;

    if v_existing_status is null then
      raise exception 'Vyúčtování nebylo nalezeno.';
    end if;

    if v_existing_status = 'closed' then
      raise exception 'Uzavřené vyúčtování nelze přepočítat ani upravit. Nejdříve ho znovu otevřete.';
    end if;

    delete from public.asset_rental_service_settlement_advance_months as snapshot_months
    where snapshot_months.settlement_id = p_settlement_id;

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
      advance_payments_total_amount = v_advance_total,
      note = p_note,
      closed_at = p_closed_at,
      closed_by = p_closed_by,
      created_by = p_created_by
    where id = p_settlement_id
    returning id into v_settlement_id;
  end if;

  delete from public.asset_rental_service_settlement_custom_items as custom_items
  where custom_items.settlement_id = v_settlement_id;

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

  insert into public.asset_rental_service_settlement_advance_months (
    settlement_id,
    month,
    monthly_advance,
    source_advance_id,
    source_effective_from
  )
  select
    v_settlement_id,
    months.month_start,
    coalesce(applicable.monthly_advance, 0),
    applicable.id,
    applicable.effective_from
  from (
    select generate_series(
      date_trunc('month', p_period_from)::date,
      date_trunc('month', p_period_to)::date,
      interval '1 month'
    )::date as month_start
  ) as months
  left join lateral (
    select
      history.id,
      history.effective_from,
      history.monthly_advance
    from public.asset_rental_service_advance_history as history
    where history.rental_id = p_rental_id
      and history.effective_from <= months.month_start
    order by history.effective_from desc, history.created_at desc
    limit 1
  ) as applicable on true;

  settlement_id := v_settlement_id;
  settlement_code := p_settlement_code;
  return next;
end;
$$;

commit;
