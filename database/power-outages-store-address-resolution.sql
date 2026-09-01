begin;

alter table public.power_outage_store_address_suggestions
  drop constraint if exists power_outage_store_address_suggestions_status_check;
update public.power_outage_store_address_suggestions
set analysis_status = 'needs_review'
where analysis_status = 'suggested';
alter table public.power_outage_store_address_suggestions
  add constraint power_outage_store_address_suggestions_status_check
  check (analysis_status in (
    'verified',
    'normalization',
    'needs_review',
    'insufficient',
    'not_found',
    'error'
  ));

create table if not exists public.power_outage_store_address_correction_audit (
  id uuid primary key default gen_random_uuid(),
  registry_id uuid references public.power_outage_store_registry(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  suggestion_id uuid references public.power_outage_store_address_suggestions(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  old_city text not null,
  old_address text not null,
  new_city text not null,
  new_address text not null,
  candidate_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint power_outage_store_address_correction_audit_candidate_check
    check (jsonb_typeof(candidate_data) = 'object')
);

comment on table public.power_outage_store_address_correction_audit is
  'Neměnný audit ručně potvrzených oprav adres prodejen z diagnostiky odstávek.';

create index if not exists power_outage_store_address_correction_audit_store_idx
  on public.power_outage_store_address_correction_audit (store_id, created_at desc);

alter table public.power_outage_store_address_correction_audit enable row level security;

drop policy if exists power_outage_store_address_correction_audit_admin_read
  on public.power_outage_store_address_correction_audit;
create policy power_outage_store_address_correction_audit_admin_read
  on public.power_outage_store_address_correction_audit
  for select to authenticated
  using (public.current_user_is_admin());

revoke all on table public.power_outage_store_address_correction_audit
  from public, anon, authenticated;
grant select on table public.power_outage_store_address_correction_audit
  to authenticated;
grant all on table public.power_outage_store_address_correction_audit
  to service_role;

create or replace function public.apply_power_outage_store_address_correction(
  p_registry_id uuid,
  p_expected_fingerprint text,
  p_new_city text,
  p_new_address text,
  p_suggestion_id uuid default null,
  p_candidate_data jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  registry_row public.power_outage_store_registry%rowtype;
  audit_id uuid;
  clean_city text := trim(coalesce(p_new_city, ''));
  clean_address text := trim(coalesce(p_new_address, ''));
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception using errcode = '42501', message = 'Opravu adresy smí potvrdit pouze administrátor.';
  end if;

  if clean_city = '' or char_length(clean_city) > 160 then
    raise exception using errcode = '22023', message = 'Město musí obsahovat 1 až 160 znaků.';
  end if;
  if clean_address = '' or char_length(clean_address) > 240 then
    raise exception using errcode = '22023', message = 'Adresa musí obsahovat 1 až 240 znaků.';
  end if;
  if coalesce(jsonb_typeof(p_candidate_data), 'null') <> 'object' then
    raise exception using errcode = '22023', message = 'Metadata kandidáta musí být JSON objekt.';
  end if;

  select *
  into registry_row
  from public.power_outage_store_registry
  where id = p_registry_id
    and is_active
  for update;

  if not found or registry_row.store_id is null then
    raise exception using errcode = 'P0002', message = 'Prodejna již není v aktivním registru.';
  end if;
  if registry_row.address_fingerprint is distinct from p_expected_fingerprint then
    raise exception using errcode = '40001', message = 'Adresa byla mezitím změněna. Načtěte diagnostiku znovu.';
  end if;
  if registry_row.store_city = clean_city and registry_row.store_address = clean_address then
    raise exception using errcode = '22023', message = 'Navržená adresa je shodná se současnou adresou.';
  end if;
  if p_suggestion_id is not null and not exists (
    select 1
    from public.power_outage_store_address_suggestions suggestion
    where suggestion.id = p_suggestion_id
      and suggestion.registry_id = p_registry_id
      and suggestion.address_fingerprint = p_expected_fingerprint
  ) then
    raise exception using errcode = '22023', message = 'Návrh již neodpovídá aktuální adrese.';
  end if;

  update public.stores
  set city = clean_city,
      address = clean_address
  where id = registry_row.store_id;

  insert into public.power_outage_store_address_correction_audit (
    registry_id,
    store_id,
    suggestion_id,
    actor_user_id,
    old_city,
    old_address,
    new_city,
    new_address,
    candidate_data
  ) values (
    registry_row.id,
    registry_row.store_id,
    p_suggestion_id,
    auth.uid(),
    registry_row.store_city,
    registry_row.store_address,
    clean_city,
    clean_address,
    coalesce(p_candidate_data, '{}'::jsonb)
  ) returning id into audit_id;

  return audit_id;
end;
$$;

revoke all on function public.apply_power_outage_store_address_correction(
  uuid, text, text, text, uuid, jsonb
) from public, anon;
grant execute on function public.apply_power_outage_store_address_correction(
  uuid, text, text, text, uuid, jsonb
) to authenticated;

commit;

select 'TABLE' as check_type,
  'power_outage_store_address_correction_audit' as object_name,
  to_regclass('public.power_outage_store_address_correction_audit') is not null as is_correct
union all
select 'RLS',
  'power_outage_store_address_correction_audit',
  coalesce((
    select relrowsecurity
    from pg_class
    where oid = 'public.power_outage_store_address_correction_audit'::regclass
  ), false)
union all
select 'POLICY',
  'power_outage_store_address_correction_audit_admin_read',
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'power_outage_store_address_correction_audit'
      and policyname = 'power_outage_store_address_correction_audit_admin_read'
  )
union all
select 'FUNCTION',
  'apply_power_outage_store_address_correction',
  to_regprocedure('public.apply_power_outage_store_address_correction(uuid,text,text,text,uuid,jsonb)') is not null
union all
select 'GRANT',
  'authenticated executes address correction only through RPC',
  has_function_privilege(
    'authenticated',
    'public.apply_power_outage_store_address_correction(uuid,text,text,text,uuid,jsonb)',
    'execute'
  )
  and not has_table_privilege(
    'authenticated',
    'public.power_outage_store_address_correction_audit',
    'insert'
  )
union all
select 'CONSTRAINT',
  'address suggestion status v2',
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.power_outage_store_address_suggestions'::regclass
      and conname = 'power_outage_store_address_suggestions_status_check'
      and pg_get_constraintdef(oid) like '%insufficient%'
  )
order by check_type, object_name;
