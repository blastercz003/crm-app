create extension if not exists "pgcrypto";

create table if not exists public.asset_insurance_details (
  id uuid,
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

alter table public.asset_insurance_details
  add column if not exists id uuid;

update public.asset_insurance_details
set id = coalesce(id, gen_random_uuid());

alter table public.asset_insurance_details
  alter column id set default gen_random_uuid();

alter table public.asset_insurance_details
  alter column id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'asset_insurance_details_pkey'
      and conrelid = 'public.asset_insurance_details'::regclass
  ) then
    alter table public.asset_insurance_details drop constraint asset_insurance_details_pkey;
  end if;
end
$$;

alter table public.asset_insurance_details
  add primary key (id);

create index if not exists asset_insurance_details_asset_id_created_at_idx
  on public.asset_insurance_details (asset_id, created_at desc);

drop trigger if exists asset_insurance_details_touch_updated_at on public.asset_insurance_details;
create trigger asset_insurance_details_touch_updated_at
before update on public.asset_insurance_details
for each row execute function public.touch_updated_at();

insert into public.asset_insurance_details (
  asset_id,
  insurance_type,
  end_date
)
select
  asset_id,
  'Povinné ručení',
  insurance_expires_on
from public.asset_vehicle_details
where insurance_expires_on is not null
  and not exists (
    select 1
    from public.asset_insurance_details existing
    where existing.asset_id = public.asset_vehicle_details.asset_id
  );
