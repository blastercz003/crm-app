begin;

-- Krok 6: sjednoceni vice AI SELECT filtru pro Kontakty firem a Upozorneni
-- firmam. Instalace nemeni runtime, neodesila e-mail a neprovadi HTTP pozadavek.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null
    or to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is null
    or to_regclass('public.complete_power_outage_notification_email_production_config') is null
    or to_regprocedure('public.prepare_complete_power_outage_contact_selector_v2(text)') is null
    or to_regprocedure('public.complete_power_outage_is_large_company_v1(text)') is null
    or to_regprocedure('public.complete_power_outage_is_operationally_sensitive_v3(uuid)') is null
  then
    raise exception 'Chybi zavislosti pro vicefiltr a bezpecnost e-mailu KOMPLETNI.';
  end if;
end
$$;

insert into public.complete_power_outage_contact_discovery_selectors (
  selector_key, display_name, commercial_filter, selection_version_key,
  lifecycle_status, selector_contract
) values (
  'multi_select_v1', 'VYBRANÉ FILTRY', 'multi_selection', null, 'active',
  jsonb_build_object(
    'contract', 'complete-contact-multi-selector-v1',
    'combination', 'union',
    'deduplication', 'ico',
    'notificationDeduplication', 'ico-outage-recipient'
  )
) on conflict (selector_key) do update
set display_name = excluded.display_name,
    commercial_filter = excluded.commercial_filter,
    lifecycle_status = excluded.lifecycle_status,
    selector_contract = excluded.selector_contract,
    updated_at = now();

create table if not exists public.complete_power_outage_ai_selector_set_v1 (
  singleton boolean primary key default true check (singleton),
  selector_keys text[] not null,
  selection_fingerprint text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint cpo_ai_selector_set_keys_check check (
    cardinality(selector_keys) between 1 and 6
    and array_position(selector_keys, null) is null
  ),
  constraint cpo_ai_selector_set_fingerprint_check check (
    selection_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_ai_selector_set_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.complete_power_outage_ai_selector_set_events_v1 (
  id uuid primary key default gen_random_uuid(),
  selector_keys text[] not null,
  selection_fingerprint text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_ai_selector_set_events_keys_check check (cardinality(selector_keys) between 1 and 6),
  constraint cpo_ai_selector_set_events_fingerprint_check check (selection_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_ai_selector_set_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_ai_selector_set_v1 (
  singleton, selector_keys, selection_fingerprint, metadata
)
select true, array[state.selected_selector_key],
  encode(extensions.digest(state.selected_selector_key, 'sha256'), 'hex'),
  jsonb_build_object('contract', 'complete-contact-multi-selector-v1', 'bootstrap', true)
from public.complete_power_outage_contact_discovery_state state
where state.singleton
on conflict (singleton) do nothing;

alter table public.complete_power_outage_ai_selector_set_v1 enable row level security;
alter table public.complete_power_outage_ai_selector_set_events_v1 enable row level security;
revoke all on table public.complete_power_outage_ai_selector_set_v1 from public, anon, authenticated;
revoke all on table public.complete_power_outage_ai_selector_set_events_v1 from public, anon, authenticated;
grant all on table public.complete_power_outage_ai_selector_set_v1 to service_role;
grant all on table public.complete_power_outage_ai_selector_set_events_v1 to service_role;

create or replace function public.prevent_cpo_ai_selector_set_event_mutation_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Historie vyberu AI SELECT je nemenna.';
end;
$$;
drop trigger if exists cpo_ai_selector_set_events_immutable on public.complete_power_outage_ai_selector_set_events_v1;
create trigger cpo_ai_selector_set_events_immutable
before update or delete on public.complete_power_outage_ai_selector_set_events_v1
for each row execute function public.prevent_cpo_ai_selector_set_event_mutation_v1();

-- Jediny sdileny predikat pro kontaktni projekci, planovani i preflight odeslani.
create or replace function public.cpo_candidate_matches_selector_keys_v1(
  requested_candidate_id uuid,
  requested_selector_keys text[]
)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address on address.id = company.outage_address_id
    join public.complete_power_outages outage on outage.id = address.outage_id
    left join public.complete_power_outage_company_scores score on score.candidate_id = company.id
    left join public.complete_power_outage_company_top_selections top_result on top_result.candidate_id = company.id
    left join public.complete_power_outage_top_selection_versions top_version
      on top_version.internal_rules_version = top_result.rules_version
     and top_version.lifecycle_status in ('active', 'archived')
    where company.id = requested_candidate_id
      and company.candidate_status = 'confirmed'
      and company.business_relevance_status = 'eligible'
      and company.ico ~ '^[0-9]{8}$'
      and outage.source_status in ('scheduled', 'active')
      and outage.ends_at >= now()
      and (
        'all_confirmed' = any(requested_selector_keys)
        or 'grade_a' = any(requested_selector_keys)
          and score.score_status in ('complete', 'preliminary') and score.grade = 'A'
        or 'grade_b' = any(requested_selector_keys)
          and score.score_status in ('complete', 'preliminary') and score.grade = 'B'
        or 'top_v1' = any(requested_selector_keys)
          and top_result.evaluation_status = 'eligible' and top_result.top_eligible
          and top_version.version_key is not null
        or 'large_companies_v1' = any(requested_selector_keys)
          and public.complete_power_outage_is_large_company_v1(company.ico)
        or 'operationally_sensitive_v3' = any(requested_selector_keys)
          and public.complete_power_outage_is_operationally_sensitive_v3(company.id)
      )
  );
$$;
revoke all on function public.cpo_candidate_matches_selector_keys_v1(uuid,text[]) from public, anon, authenticated;
grant execute on function public.cpo_candidate_matches_selector_keys_v1(uuid,text[]) to service_role;

-- Adapter obsahuje puvodni jednotlive volby i jejich aktualni sjednoceni.
create or replace view public.complete_power_outage_contact_discovery_selector_targets
with (security_invoker = true) as
with selector_scope as (
  select selector.selector_key, selector.display_name, selector.commercial_filter,
    selector.selection_version_key, selector.selector_contract,
    case when selector.selector_key = 'multi_select_v1' then selected.selector_keys
      else array[selector.selector_key]::text[] end as selector_keys
  from public.complete_power_outage_contact_discovery_selectors selector
  cross join public.complete_power_outage_ai_selector_set_v1 selected
  where selector.lifecycle_status = 'active'
), eligible_candidates as (
  select scope.selector_key, scope.display_name as selector_display_name,
    scope.commercial_filter, scope.selection_version_key, scope.selector_contract,
    company.id as candidate_id, company.ico, company.company_name,
    outage.id as outage_id, outage.source, outage.starts_at, outage.ends_at
  from selector_scope scope
  join public.complete_power_outage_companies company
    on public.cpo_candidate_matches_selector_keys_v1(company.id, scope.selector_keys)
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
), aggregated as (
  select candidate.selector_key, candidate.selector_display_name,
    candidate.commercial_filter, candidate.selection_version_key,
    candidate.selector_contract, candidate.ico,
    (array_agg(candidate.company_name order by candidate.starts_at, candidate.candidate_id))[1] as representative_company_name,
    (array_agg(candidate.candidate_id order by candidate.starts_at, candidate.candidate_id))[1] as representative_candidate_id,
    count(distinct candidate.candidate_id)::integer as candidate_count,
    count(distinct candidate.outage_id)::integer as outage_count,
    min(candidate.starts_at) as nearest_outage_starts_at,
    max(candidate.ends_at) as latest_outage_ends_at,
    array_agg(distinct candidate.source order by candidate.source) as outage_sources
  from eligible_candidates candidate
  group by candidate.selector_key, candidate.selector_display_name,
    candidate.commercial_filter, candidate.selection_version_key,
    candidate.selector_contract, candidate.ico
)
select aggregated.selector_key, aggregated.selector_display_name,
  aggregated.commercial_filter, aggregated.selection_version_key, aggregated.ico,
  profile.id as company_profile_id,
  coalesce(profile.official_name, aggregated.representative_company_name) as company_name,
  aggregated.representative_candidate_id, aggregated.candidate_count,
  aggregated.outage_count, aggregated.nearest_outage_starts_at,
  aggregated.latest_outage_ends_at, aggregated.outage_sources,
  profile.id is not null as has_company_profile, aggregated.selector_contract
from aggregated
left join public.complete_power_outage_company_profiles profile on profile.ico = aggregated.ico;

revoke all on table public.complete_power_outage_contact_discovery_selector_targets from public, anon, authenticated;
grant select on table public.complete_power_outage_contact_discovery_selector_targets to service_role;

create or replace function public.enforce_cpo_ai_selector_set_dispatch_lock_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sending_is_active boolean;
begin
  select config.configuration_status = 'live' or config.production_activation_enabled
      or config.continuous_dispatch_enabled or email_state.runtime_mode = 'live'
      or email_state.dispatch_enabled
  into sending_is_active
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  where config.singleton and email_state.singleton;
  if coalesce(sending_is_active, true) then
    raise exception 'Zdrojove filtry jsou uzamceny behem aktivniho odesilani KOMPLETNI.';
  end if;
  return new;
end;
$$;
drop trigger if exists cpo_ai_selector_set_dispatch_lock on public.complete_power_outage_ai_selector_set_v1;
create trigger cpo_ai_selector_set_dispatch_lock
before update on public.complete_power_outage_ai_selector_set_v1
for each row when (old.selector_keys is distinct from new.selector_keys)
execute function public.enforce_cpo_ai_selector_set_dispatch_lock_v1();

create or replace function public.prepare_complete_power_outage_contact_selector_set_v1(
  requested_selector_keys text[]
)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '120s' as $$
declare normalized_keys text[]; fingerprint text; switch_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Vyber kontaktu muze menit pouze administrator.'; end if;

  select array_agg(key order by case key
    when 'top_v1' then 1 when 'large_companies_v1' then 2
    when 'operationally_sensitive_v3' then 3 when 'grade_a' then 4
    when 'grade_b' then 5 when 'all_confirmed' then 6 else 99 end)
  into normalized_keys
  from (select distinct unnest(requested_selector_keys) as key) selected
  where key in ('top_v1','large_companies_v1','operationally_sensitive_v3','grade_a','grade_b','all_confirmed');

  if cardinality(normalized_keys) is null or cardinality(normalized_keys) < 1
    or cardinality(normalized_keys) <> cardinality(array(select distinct unnest(requested_selector_keys))) then
    raise exception 'Vyber obsahuje neplatny AI SELECT filtr.';
  end if;
  if 'all_confirmed' = any(normalized_keys) and cardinality(normalized_keys) > 1 then
    raise exception 'VSECHNY POTVRZENE nelze kombinovat s dalsim filtrem.';
  end if;
  if exists (
    select 1 from unnest(normalized_keys) key
    where not exists (select 1 from public.complete_power_outage_contact_discovery_selectors selector
      where selector.selector_key = key and selector.lifecycle_status = 'active')
  ) then raise exception 'Jeden z vybranych filtru neni aktivni.'; end if;

  fingerprint := encode(extensions.digest(array_to_string(normalized_keys, '|'), 'sha256'), 'hex');
  update public.complete_power_outage_ai_selector_set_v1
  set selector_keys = normalized_keys, selection_fingerprint = fingerprint,
      changed_by = auth.uid(), changed_at = now(),
      metadata = metadata || jsonb_build_object('contract','complete-contact-multi-selector-v1','combination','union')
  where singleton;
  update public.complete_power_outage_contact_discovery_selectors
  set selector_contract = selector_contract || jsonb_build_object(
      'selectedSelectorKeys', to_jsonb(normalized_keys), 'selectionFingerprint', fingerprint),
      updated_at = now()
  where selector_key = 'multi_select_v1';

  switch_result := public.prepare_complete_power_outage_contact_selector_v2('multi_select_v1');
  insert into public.complete_power_outage_ai_selector_set_events_v1 (
    selector_keys, selection_fingerprint, actor_user_id, metadata
  ) values (normalized_keys, fingerprint, auth.uid(), jsonb_build_object(
    'contract','complete-contact-multi-selector-v1','combination','union',
    'deduplication','ico','sendingAttempted',false));
  return switch_result || jsonb_build_object(
    'selectedSelectorKeys', to_jsonb(normalized_keys),
    'selectionFingerprint', fingerprint, 'combination', 'union');
end;
$$;
revoke all on function public.prepare_complete_power_outage_contact_selector_set_v1(text[]) from public, anon;
grant execute on function public.prepare_complete_power_outage_contact_selector_set_v1(text[]) to authenticated, service_role;

create or replace function public.get_cpo_multi_selector_options_v1()
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '20s' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Vybery AI SELECT jsou dostupne pouze administratorum.'; end if;
  select jsonb_build_object(
    'activeSelectorKeys', to_jsonb(selected.selector_keys),
    'activeSelectorNames', coalesce((select jsonb_agg(selector.display_name order by array_position(selected.selector_keys, selector.selector_key))
      from public.complete_power_outage_contact_discovery_selectors selector
      where selector.selector_key = any(selected.selector_keys)), '[]'::jsonb),
    'selectors', coalesce((select jsonb_agg(jsonb_build_object(
      'key', selector.selector_key, 'name', selector.display_name,
      'companyCount', (select count(*) from public.complete_power_outage_contact_discovery_selector_targets target where target.selector_key = selector.selector_key)
    ) order by case selector.selector_key when 'top_v1' then 1 when 'large_companies_v1' then 2
      when 'operationally_sensitive_v3' then 3 when 'grade_a' then 4 when 'grade_b' then 5 else 6 end)
      from public.complete_power_outage_contact_discovery_selectors selector
      where selector.lifecycle_status = 'active' and selector.selector_key <> 'multi_select_v1'), '[]'::jsonb)
  ) into result from public.complete_power_outage_ai_selector_set_v1 selected where selected.singleton;
  return coalesce(result, '{}'::jsonb);
end;
$$;
revoke all on function public.get_cpo_multi_selector_options_v1() from public, anon;
grant execute on function public.get_cpo_multi_selector_options_v1() to authenticated, service_role;

create or replace function public.get_cpo_contact_selector_lock_v1()
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '5s' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile where profile.id = auth.uid() and profile.role = 'admin'
  ) then raise exception 'Stav zdrojoveho vyberu je dostupny pouze administratorum.'; end if;
  select jsonb_build_object(
    'selectorLockedByEmailDispatch', config.configuration_status = 'live'
      or config.production_activation_enabled or config.continuous_dispatch_enabled
      or email_state.runtime_mode = 'live' or email_state.dispatch_enabled,
    'selectorLockReason', case when config.configuration_status = 'live'
      or config.production_activation_enabled or config.continuous_dispatch_enabled
      or email_state.runtime_mode = 'live' or email_state.dispatch_enabled
      then 'Zdrojový výběr je uzamčen během aktivního odesílání. Nejprve pozastavte Upozornění firmám.' end,
    'productionEmailSelectorKey', config.active_selector_key,
    'selectedSelectorKeys', to_jsonb(selected.selector_keys),
    'selectedSelectorNames', coalesce((select jsonb_agg(selector.display_name order by array_position(selected.selector_keys, selector.selector_key))
      from public.complete_power_outage_contact_discovery_selectors selector
      where selector.selector_key = any(selected.selector_keys)), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_notification_email_production_config config
  cross join public.complete_power_outage_notification_email_state email_state
  cross join public.complete_power_outage_ai_selector_set_v1 selected
  where config.singleton and email_state.singleton and selected.singleton;
  return coalesce(result, jsonb_build_object('selectorLockedByEmailDispatch', true));
end;
$$;

-- Kandidat planu musi byt i nyni POTVRZENO, v platne odstavce a alespon v
-- jednom aktivnim filtru. GROUP BY a dedupe_key zachovava jeden e-mail na ICO+odstavku.
create or replace view public.complete_power_outage_notification_email_candidates_v1
with (security_invoker = true) as
with runtime as (
  select email_state.active_selector_key,
    case when email_state.active_selector_key = 'multi_select_v1' then selected.selector_keys
      else array[email_state.active_selector_key]::text[] end as selector_keys
  from public.complete_power_outage_notification_email_state email_state
  cross join public.complete_power_outage_ai_selector_set_v1 selected
  where email_state.singleton and selected.singleton
), active_batch as (
  select batch.id, batch.selector_key, runtime.selector_keys
  from runtime join lateral (
    select candidate_batch.* from public.complete_power_outage_contact_discovery_batches candidate_batch
    where candidate_batch.selector_key = runtime.active_selector_key
      and candidate_batch.batch_status in ('ready','active','paused','completed')
    order by candidate_batch.created_at desc limit 1
  ) batch on true
), scoped_addresses as (
  select distinct active_batch.id as batch_id, active_batch.selector_key,
    batch_item.company_profile_id, company.ico, profile.official_name as company_name,
    effective.shadow_contact_id as recipient_contact_id,
    effective.normalized_value as recipient_email, effective.contact_class,
    outage.id as outage_id, outage.source, outage.external_id, outage.title,
    outage.starts_at, outage.ends_at, outage.municipality,
    address.id as address_id, address.municipality as address_municipality,
    address.street, address.house_number, address.orientation_number,
    address.postal_code, address.raw_address
  from active_batch
  join public.complete_power_outage_contact_discovery_batch_items batch_item on batch_item.batch_id = active_batch.id
  join public.complete_power_outage_company_profiles profile on profile.id = batch_item.company_profile_id and profile.ico = batch_item.ico
  join public.complete_power_outage_contact_classification_effective_v1 effective
    on effective.company_profile_id = batch_item.company_profile_id and effective.ico = batch_item.ico
   and effective.contact_type = 'email' and effective.notification_eligible and effective.is_primary
  join public.complete_power_outage_companies company on company.ico = batch_item.ico
   and public.cpo_candidate_matches_selector_keys_v1(company.id, active_batch.selector_keys)
  join public.complete_power_outage_addresses address on address.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address.outage_id
  where company.candidate_status = 'confirmed'
    and outage.source_status = 'scheduled' and outage.starts_at > now()
    and not exists (
      select 1 from public.complete_power_outage_companies linked_company
      join public.complete_power_outage_addresses linked_address on linked_address.id = linked_company.outage_address_id
      join public.complete_power_outage_job_links job_link on job_link.candidate_id = linked_company.id
      where linked_company.ico = company.ico and linked_address.outage_id = outage.id
    )
), grouped as (
  select scoped.batch_id, scoped.selector_key, scoped.company_profile_id,
    scoped.ico, scoped.company_name, scoped.recipient_contact_id,
    lower(scoped.recipient_email) as recipient_email, scoped.contact_class,
    scoped.outage_id, scoped.source, scoped.external_id, scoped.title,
    scoped.starts_at, scoped.ends_at, scoped.municipality,
    jsonb_agg(jsonb_build_object('municipality',scoped.address_municipality,
      'street',scoped.street,'houseNumber',scoped.house_number,
      'orientationNumber',scoped.orientation_number,'postalCode',scoped.postal_code,
      'rawAddress',scoped.raw_address) order by scoped.address_municipality,
      scoped.street,scoped.house_number,scoped.orientation_number,scoped.address_id) as address_snapshot
  from scoped_addresses scoped
  group by scoped.batch_id,scoped.selector_key,scoped.company_profile_id,scoped.ico,
    scoped.company_name,scoped.recipient_contact_id,lower(scoped.recipient_email),
    scoped.contact_class,scoped.outage_id,scoped.source,scoped.external_id,
    scoped.title,scoped.starts_at,scoped.ends_at,scoped.municipality
)
select grouped.*,
  encode(extensions.digest(concat('complete-notification-email-v1:new_outage:',grouped.ico,':',grouped.outage_id),'sha256'),'hex') as dedupe_key,
  coalesce(suppression.is_suppressed,false) as is_suppressed,
  format('Planovana odstavka elektriny - %s - %s',grouped.company_name,
    to_char(grouped.starts_at at time zone 'Europe/Prague','DD. MM. YYYY')) as subject_snapshot,
  format(E'Dobry den,\n\nupozornujeme na planovanou odstavku elektriny, ktera se muze tykat provozu firmy %s. Termin: %s az %s. Distributor: %s.\n\nPred odeslanim bude zprava doplnena o jasnou moznost odhlaseni dalsich upozorneni.',
    grouped.company_name,grouped.starts_at at time zone 'Europe/Prague',
    grouped.ends_at at time zone 'Europe/Prague',upper(grouped.source)) as text_snapshot
from grouped
left join public.complete_power_outage_notification_email_suppressions_v1 suppression
  on suppression.normalized_email = grouped.recipient_email;
revoke all on table public.complete_power_outage_notification_email_candidates_v1 from public, anon, authenticated;
grant select on table public.complete_power_outage_notification_email_candidates_v1 to service_role;

-- Trigger je prvni planovaci pojistka. I stary nebo rucni zapis planu je
-- okamzite oznacen mimo scope, pokud jiz nesplnuje aktualni sjednoceni.
create or replace function public.enforce_cpo_notification_email_production_plan_scope_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare config_row public.complete_power_outage_notification_email_production_config%rowtype;
  selected_keys text[]; lower_boundary timestamptz; upper_boundary timestamptz;
begin
  select * into config_row from public.complete_power_outage_notification_email_production_config where singleton;
  if config_row.singleton is null or not config_row.continuous_planning_enabled then return new; end if;
  select case when config_row.active_selector_key = 'multi_select_v1' then selected.selector_keys
    else array[config_row.active_selector_key]::text[] end into selected_keys
  from public.complete_power_outage_ai_selector_set_v1 selected where selected.singleton;
  lower_boundary := now() + make_interval(mins => config_row.minimum_outage_lead_minutes);
  upper_boundary := now() + make_interval(days => config_row.maximum_outage_horizon_days);
  if new.plan_status in ('shadow_ready','suppressed') and (
    new.selector_key <> config_row.active_selector_key
    or new.starts_at_snapshot < lower_boundary or new.starts_at_snapshot > upper_boundary
    or not exists (
      select 1 from public.complete_power_outage_companies company
      join public.complete_power_outage_addresses address on address.id = company.outage_address_id
      join public.complete_power_outages outage on outage.id = address.outage_id
      where company.ico = new.ico and outage.id = new.outage_id
        and company.candidate_status = 'confirmed' and outage.source_status = 'scheduled'
        and outage.starts_at = new.starts_at_snapshot
        and public.cpo_candidate_matches_selector_keys_v1(company.id, selected_keys)
    )
  ) then new.plan_status := 'out_of_scope'; end if;
  new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'productionScopeApplied',true,'productionScopeContract','complete-notification-email-multi-selector-safety-v1',
    'selectedSelectorKeys',to_jsonb(selected_keys),'sendingAttempted',false);
  return new;
end;
$$;

-- Druha, bezprostredni pojistka bezi pred atomickym claimem. Stale plany
-- vyradi a teprve potom deleguje limit, potlaceni kontaktu a rezervaci na v1.
create or replace function public.claim_cpo_notification_email_production_v2()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '20s' as $$
declare config_row public.complete_power_outage_notification_email_production_config%rowtype;
  selected_keys text[]; removed_count integer := 0; result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cpo_notification_email_production_dispatch_v1',0));
  select * into config_row from public.complete_power_outage_notification_email_production_config where singleton;
  select case when config_row.active_selector_key = 'multi_select_v1' then selected.selector_keys
    else array[config_row.active_selector_key]::text[] end into selected_keys
  from public.complete_power_outage_ai_selector_set_v1 selected where selected.singleton;
  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'out_of_scope', metadata = plan.metadata || jsonb_build_object(
    'sendPreflightRejectedAt',now(),'sendPreflightContract','complete-notification-email-multi-selector-safety-v1',
    'sendingAttempted',false), updated_at = now()
  where plan.plan_status = 'shadow_ready' and plan.selector_key = config_row.active_selector_key
    and not exists (
      select 1 from public.complete_power_outage_companies company
      join public.complete_power_outage_addresses address on address.id = company.outage_address_id
      join public.complete_power_outages outage on outage.id = address.outage_id
      where company.ico = plan.ico and outage.id = plan.outage_id
        and company.candidate_status = 'confirmed' and company.business_relevance_status = 'eligible'
        and outage.source_status = 'scheduled' and outage.starts_at = plan.starts_at_snapshot
        and outage.ends_at > now()
        and public.cpo_candidate_matches_selector_keys_v1(company.id, selected_keys)
    );
  get diagnostics removed_count = row_count;
  result := public.claim_cpo_notification_email_production_v1();
  return result || jsonb_build_object('multiSelectorPreflight',true,
    'preflightRejectedCount',removed_count,'selectedSelectorKeys',to_jsonb(selected_keys));
end;
$$;
revoke all on function public.claim_cpo_notification_email_production_v2() from public, anon, authenticated;
grant execute on function public.claim_cpo_notification_email_production_v2() to service_role;

notify pgrst, 'reload schema';
commit;
