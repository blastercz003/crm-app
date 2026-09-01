begin;

create table if not exists public.power_outage_store_address_suggestions (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid not null unique
    references public.power_outage_store_registry(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  store_chain_name text not null,
  store_number text not null,
  current_city text not null,
  current_address text not null,
  address_fingerprint text not null,
  source text not null default 'mapy',
  analysis_status text not null,
  confidence numeric(5,4) not null default 0,
  query_text text not null,
  suggested_city text,
  suggested_address text,
  suggested_label text,
  suggested_zip text,
  longitude double precision,
  latitude double precision,
  candidate_count integer not null default 0,
  analyzed_at timestamptz not null default now(),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_store_address_suggestions_fingerprint_check
    check (address_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint power_outage_store_address_suggestions_source_check
    check (source = 'mapy'),
  constraint power_outage_store_address_suggestions_status_check
    check (analysis_status in ('suggested', 'needs_review', 'not_found', 'error')),
  constraint power_outage_store_address_suggestions_confidence_check
    check (confidence >= 0 and confidence <= 1),
  constraint power_outage_store_address_suggestions_candidate_count_check
    check (candidate_count >= 0),
  constraint power_outage_store_address_suggestions_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.power_outage_store_address_suggestions is
  'Read-only diagnostická cache návrhů adres z Mapy.com; nikdy sama nemění public.stores.';

create index if not exists power_outage_store_address_suggestions_chain_status_idx
  on public.power_outage_store_address_suggestions
    (store_chain_name, analysis_status, analyzed_at desc);

create index if not exists power_outage_store_address_suggestions_fingerprint_idx
  on public.power_outage_store_address_suggestions (address_fingerprint);

drop trigger if exists power_outage_store_address_suggestions_set_updated_at
  on public.power_outage_store_address_suggestions;
create trigger power_outage_store_address_suggestions_set_updated_at
before update on public.power_outage_store_address_suggestions
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_store_address_suggestions enable row level security;

drop policy if exists power_outage_store_address_suggestions_authorized_read
  on public.power_outage_store_address_suggestions;
create policy power_outage_store_address_suggestions_authorized_read
  on public.power_outage_store_address_suggestions
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.power_outage_store_address_suggestions
  from public, anon, authenticated;
grant select on table public.power_outage_store_address_suggestions
  to authenticated;
grant all on table public.power_outage_store_address_suggestions
  to service_role;

commit;

select 'TABLE' as check_type,
  'power_outage_store_address_suggestions' as object_name,
  to_regclass('public.power_outage_store_address_suggestions') is not null as is_correct
union all
select 'RLS',
  'power_outage_store_address_suggestions',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.power_outage_store_address_suggestions'::regclass
  ), false)
union all
select 'POLICY',
  'power_outage_store_address_suggestions_authorized_read',
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'power_outage_store_address_suggestions'
      and policyname = 'power_outage_store_address_suggestions_authorized_read'
  )
union all
select 'GRANT',
  'authenticated read-only address suggestions',
  has_table_privilege('authenticated', 'public.power_outage_store_address_suggestions', 'select')
  and not has_table_privilege('authenticated', 'public.power_outage_store_address_suggestions', 'insert')
  and not has_table_privilege('authenticated', 'public.power_outage_store_address_suggestions', 'update')
  and not has_table_privilege('authenticated', 'public.power_outage_store_address_suggestions', 'delete')
order by check_type, object_name;
