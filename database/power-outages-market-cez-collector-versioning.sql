begin;

do $$
begin
  if to_regclass('public.power_outage_source_state') is null
    or to_regclass('public.power_outage_sync_runs') is null
  then
    raise exception 'Nejdříve spusťte základní migraci monitoringu odstávek.';
  end if;
  if to_regprocedure('public.current_user_can_view_power_outages()') is null
    or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybí společné bezpečnostní funkce monitoringu odstávek.';
  end if;
end
$$;

-- Neměnný katalog implementovaných strategií. Záznam v1 dokumentuje a uchovává
-- přesně dosavadní produkční chování MARKETY: jedna ověřená adresa za město,
-- sjednocení exact `outages` a městských `outages_in_town`.
create table if not exists public.power_outage_cez_market_collector_versions (
  version text primary key,
  display_name text not null,
  contract_name text not null,
  strategy text not null,
  settings jsonb not null default '{}'::jsonb,
  rollback_available boolean not null default true,
  created_at timestamptz not null default now(),

  constraint po_cez_market_collector_versions_version_check
    check (version ~ '^v[1-9][0-9]*$'),
  constraint po_cez_market_collector_versions_text_check
    check (
      btrim(display_name) <> ''
      and btrim(contract_name) <> ''
      and btrim(strategy) <> ''
    ),
  constraint po_cez_market_collector_versions_settings_check
    check (jsonb_typeof(settings) = 'object')
);

insert into public.power_outage_cez_market_collector_versions (
  version,
  display_name,
  contract_name,
  strategy,
  settings,
  rollback_available
)
values (
  'v1',
  'ČEZ v1',
  'cez-public-address-v1',
  'one_verified_address_per_city',
  jsonb_build_object(
    'scope', 'MARKETY',
    'grouping', 'normalized_city',
    'representativeSelection', 'first_verified_cez_address_in_batch',
    'inspectionFields', jsonb_build_array('outages', 'outages_in_town'),
    'deduplicateOutagesBy', 'external_id',
    'productionTables', jsonb_build_array(
      'power_outages',
      'power_outage_addresses',
      'power_outage_store_matches'
    ),
    'frozenAt', now()
  ),
  true
)
on conflict (version) do nothing;

create or replace function public.protect_power_outage_cez_market_collector_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.version = 'v1' then
    raise exception 'Definice sběrače ČEZ MARKETY v1 je neměnná.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists po_cez_market_collector_v1_immutable
  on public.power_outage_cez_market_collector_versions;
create trigger po_cez_market_collector_v1_immutable
before update or delete on public.power_outage_cez_market_collector_versions
for each row execute function public.protect_power_outage_cez_market_collector_v1();

create table if not exists public.power_outage_cez_market_collector_state (
  singleton boolean primary key default true,
  active_version text not null
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  previous_version text
    references public.power_outage_cez_market_collector_versions(version) on delete restrict,
  switched_at timestamptz not null default now(),
  switched_by uuid,
  switch_note text,
  updated_at timestamptz not null default now(),

  constraint po_cez_market_collector_state_singleton_check check (singleton),
  constraint po_cez_market_collector_state_note_check
    check (switch_note is null or length(btrim(switch_note)) between 1 and 1000)
);

insert into public.power_outage_cez_market_collector_state (
  singleton,
  active_version,
  switch_note
)
values (
  true,
  'v1',
  'Výchozí zachovaný sběr ČEZ pro režim MARKETY.'
)
on conflict (singleton) do nothing;

drop trigger if exists po_cez_market_collector_state_set_updated_at
  on public.power_outage_cez_market_collector_state;
create trigger po_cez_market_collector_state_set_updated_at
before update on public.power_outage_cez_market_collector_state
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_cez_market_collector_versions enable row level security;
alter table public.power_outage_cez_market_collector_state enable row level security;

drop policy if exists po_cez_market_collector_versions_authorized_read
  on public.power_outage_cez_market_collector_versions;
create policy po_cez_market_collector_versions_authorized_read
  on public.power_outage_cez_market_collector_versions
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists po_cez_market_collector_state_authorized_read
  on public.power_outage_cez_market_collector_state;
create policy po_cez_market_collector_state_authorized_read
  on public.power_outage_cez_market_collector_state
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_cez_market_collector_versions
  from public, anon, authenticated;
revoke all on table public.power_outage_cez_market_collector_state
  from public, anon, authenticated;
grant select on table public.power_outage_cez_market_collector_versions to authenticated;
grant select on table public.power_outage_cez_market_collector_state to authenticated;
grant all on table public.power_outage_cez_market_collector_versions to service_role;
grant all on table public.power_outage_cez_market_collector_state to service_role;

create or replace function public.set_power_outage_cez_market_collector_version(
  requested_version text,
  requested_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_version text;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Změnu verze sběrače může provést pouze service role.';
  end if;

  if not exists (
    select 1
    from public.power_outage_cez_market_collector_versions v
    where v.version = requested_version
  ) then
    raise exception 'Neznámá verze sběrače ČEZ pro MARKETY: %', requested_version;
  end if;

  select s.active_version
    into current_version
  from public.power_outage_cez_market_collector_state s
  where s.singleton
  for update;

  update public.power_outage_cez_market_collector_state
  set previous_version = current_version,
      active_version = requested_version,
      switched_at = now(),
      switched_by = auth.uid(),
      switch_note = nullif(btrim(requested_note), '')
  where singleton;

  return requested_version;
end;
$$;

revoke all on function public.set_power_outage_cez_market_collector_version(text, text)
  from public, anon, authenticated;
grant execute on function public.set_power_outage_cez_market_collector_version(text, text)
  to service_role;

revoke all on function public.protect_power_outage_cez_market_collector_v1()
  from public, anon, authenticated;

comment on table public.power_outage_cez_market_collector_versions is
  'Verzovaný katalog implementací sběru ČEZ výhradně pro režim MARKETY.';
comment on table public.power_outage_cez_market_collector_state is
  'Reverzibilní přepínač aktivní implementace sběru ČEZ pro MARKETY.';

commit;
