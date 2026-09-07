begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_new_status_v3') is null
    or to_regclass('public.complete_power_outage_cez_projection_state') is null
    or to_regclass('public.complete_power_outages') is null
    or to_regclass('public.complete_power_outage_addresses') is null
    or to_regclass('public.complete_power_outage_companies') is null
    or to_regclass('public.complete_power_outage_company_evidence') is null
    or to_regclass('public.complete_power_outage_address_targets') is null
    or to_regclass('public.complete_power_outage_company_assignments') is null
    or to_regclass('public.complete_power_outage_company_notes') is null
    or to_regprocedure('public.request_power_outages_endpoint(text)') is null
  then
    raise exception 'Chybi zavislosti pro bezpecnou aktivaci CEZ ALL v1.';
  end if;
end
$$;

-- Aktivační pohled ponechává dosavadní diagnostiku 2/2 nedotčenou, ale pro
-- řízené přepnutí vyžaduje jediný poslední úplný a bezchybný snapshot.
create or replace view public.complete_power_outage_cez_all_v1_readiness
with (security_invoker = true)
as
select
  status.*,
  1::integer as required_safe_cycle_count,
  (
    status.recent_cycle_count >= 1
    and status.safe_recent_cycle_count >= 1
    and status.latest_finalized_cycle_id is not null
    and status.latest_projection_matches
    and status.projection_status = 'ready'
    and status.representative_remaining = 0
    and status.mapping_remaining = 0
    and status.representative_error = 0
    and status.mapping_error = 0
    and status.scan_error = 0
    and status.normalization_remaining = 0
    and status.normalization_error = 0
    and status.readiness_error_stage is null
  ) as activation_ready
from public.complete_power_outage_cez_new_status_v3 status;

revoke all on table public.complete_power_outage_cez_all_v1_readiness
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_all_v1_readiness
  to authenticated, service_role;

-- Neměnná kopie všech stávajících ČEZ záznamů v KOMPLETNÍM tabu před
-- aktivací. Obsahuje i výsledky providerů a ruční práci uživatelů.
create table if not exists public.complete_power_outage_cez_all_manifests (
  id uuid primary key default gen_random_uuid(),
  manifest_kind text not null,
  active_source text not null,
  outage_count integer not null default 0,
  address_count integer not null default 0,
  address_target_count integer not null default 0,
  company_count integer not null default 0,
  evidence_count integer not null default 0,
  assignment_count integer not null default 0,
  note_count integer not null default 0,
  status text not null default 'building',
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint cpo_cez_all_manifests_kind_check
    check (manifest_kind in ('pre_activation', 'post_activation', 'rollback')),
  constraint cpo_cez_all_manifests_source_check
    check (active_source in ('legacy', 'shadow')),
  constraint cpo_cez_all_manifests_status_check
    check (status in ('building', 'complete', 'failed')),
  constraint cpo_cez_all_manifests_counts_check check (
    outage_count >= 0 and address_count >= 0 and address_target_count >= 0
    and company_count >= 0 and evidence_count >= 0
    and assignment_count >= 0 and note_count >= 0
  ),
  constraint cpo_cez_all_manifests_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.complete_power_outage_cez_all_manifest_items (
  manifest_id uuid not null
    references public.complete_power_outage_cez_all_manifests(id) on delete restrict,
  entity_kind text not null,
  entity_key text not null,
  outage_id uuid,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (manifest_id, entity_kind, entity_key),
  constraint cpo_cez_all_manifest_items_kind_check check (
    entity_kind in ('outage', 'address', 'address_target', 'company',
      'evidence', 'assignment', 'note')
  ),
  constraint cpo_cez_all_manifest_items_key_check check (btrim(entity_key) <> ''),
  constraint cpo_cez_all_manifest_items_payload_check
    check (jsonb_typeof(payload) = 'object')
);

create index if not exists cpo_cez_all_manifest_items_outage_idx
  on public.complete_power_outage_cez_all_manifest_items
  (manifest_id, outage_id, entity_kind);

create or replace function public.protect_complete_power_outage_cez_all_manifest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Bezpecnostni manifest CEZ ALL nelze smazat.';
  end if;
  if old.status = 'complete' then
    raise exception 'Dokonceny bezpecnostni manifest CEZ ALL je nemenny.';
  end if;
  return new;
end;
$$;

create or replace function public.protect_complete_power_outage_cez_all_manifest_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Polozky bezpecnostniho manifestu CEZ ALL jsou nemenene.';
end;
$$;

drop trigger if exists cpo_cez_all_manifest_immutable
  on public.complete_power_outage_cez_all_manifests;
create trigger cpo_cez_all_manifest_immutable
before update or delete on public.complete_power_outage_cez_all_manifests
for each row execute function public.protect_complete_power_outage_cez_all_manifest();

drop trigger if exists cpo_cez_all_manifest_items_immutable
  on public.complete_power_outage_cez_all_manifest_items;
create trigger cpo_cez_all_manifest_items_immutable
before update or delete on public.complete_power_outage_cez_all_manifest_items
for each row execute function public.protect_complete_power_outage_cez_all_manifest_item();

create or replace function public.capture_complete_power_outage_cez_all_manifest(
  requested_kind text,
  requested_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_manifest_id uuid;
  current_source text;
  saved_outages integer := 0;
  saved_addresses integer := 0;
  saved_targets integer := 0;
  saved_companies integer := 0;
  saved_evidence integer := 0;
  saved_assignments integer := 0;
  saved_notes integer := 0;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Bezpecnostni manifest muze vytvorit pouze service role.';
  end if;
  if requested_kind not in ('pre_activation', 'post_activation', 'rollback') then
    raise exception 'Neznamy typ bezpecnostniho manifestu: %', requested_kind;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('complete_cez_all_manifest', 0)) then
    raise exception 'Jiny bezpecnostni manifest CEZ ALL se prave vytvari.';
  end if;

  lock table public.complete_power_outages in share mode;
  lock table public.complete_power_outage_addresses in share mode;
  lock table public.complete_power_outage_address_targets in share mode;
  lock table public.complete_power_outage_companies in share mode;
  lock table public.complete_power_outage_company_evidence in share mode;
  lock table public.complete_power_outage_company_assignments in share mode;
  lock table public.complete_power_outage_company_notes in share mode;

  select active_source into current_source
  from public.complete_power_outage_cez_projection_state
  where singleton for share;

  insert into public.complete_power_outage_cez_all_manifests (
    manifest_kind, active_source, note, created_by
  ) values (
    requested_kind, current_source, nullif(btrim(requested_note), ''), auth.uid()
  ) returning id into new_manifest_id;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'outage', outage.id::text, outage.id, to_jsonb(outage)
  from public.complete_power_outages outage
  where outage.source = 'cez';
  get diagnostics saved_outages = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'address', address.id::text, outage.id, to_jsonb(address)
  from public.complete_power_outage_addresses address
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_addresses = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'address_target', target.id::text, outage.id, to_jsonb(target)
  from public.complete_power_outage_address_targets target
  join public.complete_power_outage_addresses address on address.id = target.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_targets = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'company', company.id::text, outage.id, to_jsonb(company)
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_companies = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'evidence', evidence.id::text, outage.id, to_jsonb(evidence)
  from public.complete_power_outage_company_evidence evidence
  join public.complete_power_outage_companies company on company.id = evidence.company_id
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_evidence = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'assignment', assignment.candidate_id::text,
    outage.id, to_jsonb(assignment)
  from public.complete_power_outage_company_assignments assignment
  join public.complete_power_outage_companies company on company.id = assignment.candidate_id
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_assignments = row_count;

  insert into public.complete_power_outage_cez_all_manifest_items
    (manifest_id, entity_kind, entity_key, outage_id, payload)
  select new_manifest_id, 'note', note.id::text, outage.id, to_jsonb(note)
  from public.complete_power_outage_company_notes note
  join public.complete_power_outage_companies company on company.id = note.candidate_id
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where outage.source = 'cez';
  get diagnostics saved_notes = row_count;

  update public.complete_power_outage_cez_all_manifests
  set outage_count = saved_outages,
      address_count = saved_addresses,
      address_target_count = saved_targets,
      company_count = saved_companies,
      evidence_count = saved_evidence,
      assignment_count = saved_assignments,
      note_count = saved_notes,
      status = 'complete',
      metadata = jsonb_build_object(
        'contract', 'complete-cez-all-v1-preservation',
        'productionWritesMade', false
      )
  where id = new_manifest_id;

  return new_manifest_id;
end;
$$;

-- Přepnutí je vratné. Aktivace nového zdroje vždy nejprve pořídí úplný
-- manifest a následně požádá existující KOMPLETNÍ endpoint o první sync.
create or replace function public.set_complete_power_outage_cez_source(requested_source text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_source text := lower(btrim(coalesce(requested_source, '')));
  readiness record;
  prior_source text;
  manifest_id uuid;
  sync_request_id bigint;
begin
  if current_user not in ('postgres', 'service_role') then
    raise exception 'Zdroj CEZ KOMPLETNI muze prepnout pouze service role.';
  end if;
  if safe_source not in ('legacy', 'shadow') then
    raise exception 'Zdroj musi byt legacy nebo shadow.';
  end if;

  perform pg_advisory_xact_lock(hashtext('complete_power_outage_cez_activation'));
  select active_source into prior_source
  from public.complete_power_outage_cez_projection_state
  where singleton for update;

  if safe_source = prior_source then
    return jsonb_build_object(
      'ok', true, 'previousSource', prior_source,
      'activeSource', safe_source, 'changed', false
    );
  end if;

  if safe_source = 'shadow' then
    select * into readiness
    from public.complete_power_outage_cez_all_v1_readiness;
    if not coalesce(readiness.activation_ready, false) then
      raise exception 'CEZ ALL v1 nesplnuje aktivacni podminku 1/1.';
    end if;
    manifest_id := public.capture_complete_power_outage_cez_all_manifest(
      'pre_activation',
      'Automaticky manifest pred aktivaci CEZ ALL v1.'
    );
  else
    manifest_id := public.capture_complete_power_outage_cez_all_manifest(
      'rollback',
      'Automaticky manifest pred navratem na puvodni CEZ katalog.'
    );
  end if;

  update public.complete_power_outage_cez_projection_state
  set previous_source = prior_source,
      active_source = safe_source,
      activated_at = now(),
      activated_by = auth.uid(),
      updated_at = now(),
      metadata = metadata || jsonb_build_object(
        'lastSourceChangeAt', now(),
        'lastSourceChangeFrom', prior_source,
        'lastSourceChangeTo', safe_source,
        'activeProductName', case when safe_source = 'shadow' then 'CEZ ALL v1' else 'CEZ legacy' end,
        'requiredSafeCycleCount', 1,
        'preservationManifestId', manifest_id,
        'legacyAvailableForRollback', true
      )
  where singleton;

  sync_request_id := public.request_power_outages_endpoint(
    '/api/power-outages/complete/sync?source=cez'
  );

  return jsonb_build_object(
    'ok', true,
    'previousSource', prior_source,
    'activeSource', safe_source,
    'changed', true,
    'requiredSafeCycleCount', 1,
    'manifestId', manifest_id,
    'syncRequestId', sync_request_id
  );
end;
$$;

alter table public.complete_power_outage_cez_all_manifests enable row level security;
alter table public.complete_power_outage_cez_all_manifest_items enable row level security;

drop policy if exists cpo_cez_all_manifests_authorized_read
  on public.complete_power_outage_cez_all_manifests;
create policy cpo_cez_all_manifests_authorized_read
  on public.complete_power_outage_cez_all_manifests
  for select to authenticated
  using (public.current_user_can_view_power_outages());

drop policy if exists cpo_cez_all_manifest_items_authorized_read
  on public.complete_power_outage_cez_all_manifest_items;
create policy cpo_cez_all_manifest_items_authorized_read
  on public.complete_power_outage_cez_all_manifest_items
  for select to authenticated
  using (public.current_user_can_view_power_outages());

revoke all on table public.complete_power_outage_cez_all_manifests,
  public.complete_power_outage_cez_all_manifest_items
  from public, anon, authenticated;
grant select on table public.complete_power_outage_cez_all_manifests,
  public.complete_power_outage_cez_all_manifest_items
  to authenticated;

revoke all on function public.capture_complete_power_outage_cez_all_manifest(text,text),
  public.set_complete_power_outage_cez_source(text),
  public.protect_complete_power_outage_cez_all_manifest(),
  public.protect_complete_power_outage_cez_all_manifest_item()
  from public, anon, authenticated;
grant execute on function public.capture_complete_power_outage_cez_all_manifest(text,text),
  public.set_complete_power_outage_cez_source(text)
  to service_role;

commit;

select 'VIEW' as check_type, 'CEZ ALL v1 one-cycle readiness' as object_name,
  to_regclass('public.complete_power_outage_cez_all_v1_readiness') is not null as is_correct
union all
select 'LOGIC', 'one safe cycle is sufficient',
  coalesce((select required_safe_cycle_count = 1
    from public.complete_power_outage_cez_all_v1_readiness), false)
union all
select 'STATE', 'CEZ ALL v1 is ready for controlled activation',
  coalesce((select activation_ready
    from public.complete_power_outage_cez_all_v1_readiness), false)
union all
select 'FUNCTION', 'controlled CEZ ALL v1 activation',
  to_regprocedure('public.set_complete_power_outage_cez_source(text)') is not null
union all
select 'FUNCTION', 'complete CEZ preservation manifest',
  to_regprocedure('public.capture_complete_power_outage_cez_all_manifest(text,text)') is not null
union all
select 'SAFETY', 'migration did not activate CEZ ALL v1',
  coalesce((select active_source = 'legacy'
    from public.complete_power_outage_cez_projection_state where singleton), false)
union all
select 'SAFETY', 'legacy source remains available',
  pg_get_functiondef('public.set_complete_power_outage_cez_source(text)'::regprocedure)
    like '%safe_source not in (''legacy'', ''shadow'')%'
union all
select 'GRANT', 'authenticated cannot switch CEZ source',
  not has_function_privilege('authenticated',
    'public.set_complete_power_outage_cez_source(text)', 'EXECUTE')
union all
select 'ISOLATION', 'CEZ ALL activation does not reference MARKET outage tables',
  position('public.power_outages' in pg_get_functiondef(
    'public.set_complete_power_outage_cez_source(text)'::regprocedure)) = 0
order by check_type, object_name;
