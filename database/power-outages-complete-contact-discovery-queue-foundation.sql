begin;

-- Krok 3: prazdny a vypnuty zaklad fronty dohledavani kontaktu.
-- Nevytvari aktivaci, worker, claim funkci, CRON ani HTTP pozadavek.
do $$
begin
  if to_regclass('public.complete_power_outage_contact_discovery_selectors') is null
     or to_regclass('public.complete_power_outage_contact_discovery_state') is null
     or to_regclass('public.complete_power_outage_contact_discovery_selector_targets') is null
     or to_regclass('public.complete_power_outage_company_profiles') is null
     or to_regclass('public.complete_power_outage_company_websites') is null
     or to_regclass('public.complete_power_outage_top_selection_versions') is null
     or to_regprocedure('public.set_power_outage_updated_at()') is null
  then
    raise exception 'Chybi zavislosti pro zaklad fronty dohledavani kontaktu.';
  end if;
end
$$;

-- Slozene unikatni klice dovoluji databazi overit, ze profil patri ICO
-- a nalezeny web patri stejnemu profilu jako polozka fronty.
create unique index if not exists cpo_company_profiles_id_ico_uidx
  on public.complete_power_outage_company_profiles (id, ico);

create unique index if not exists cpo_company_websites_id_profile_uidx
  on public.complete_power_outage_company_websites (id, company_profile_id);

-- Kazdy budouci kontrolovany vyber dostane vlastni davku s presnym snimkem
-- selectoru. Zmena selectoru tak neprepise historii predchoziho vyberu.
create table if not exists public.complete_power_outage_contact_discovery_batches (
  id uuid primary key default gen_random_uuid(),
  selector_key text not null
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  selection_version_key text
    references public.complete_power_outage_top_selection_versions(version_key)
    on delete restrict,
  batch_status text not null default 'draft',
  selector_contract_snapshot jsonb not null,
  target_ico_count bigint not null default 0,
  profile_ready_count bigint not null default 0,
  profile_waiting_count bigint not null default 0,
  represented_queue_count bigint not null default 0,
  captured_at timestamptz,
  activated_at timestamptz,
  finished_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_discovery_batches_status_check check (
    batch_status in (
      'draft', 'capturing', 'ready', 'active', 'paused',
      'completed', 'cancelled', 'failed'
    )
  ),
  constraint cpo_contact_discovery_batches_contract_check check (
    jsonb_typeof(selector_contract_snapshot) = 'object'
    and selector_contract_snapshot <> '{}'::jsonb
  ),
  constraint cpo_contact_discovery_batches_counts_check check (
    target_ico_count >= 0
    and profile_ready_count >= 0
    and profile_waiting_count >= 0
    and represented_queue_count >= 0
    and profile_ready_count + profile_waiting_count = target_ico_count
    and represented_queue_count <= target_ico_count
  ),
  constraint cpo_contact_discovery_batches_capture_check check (
    batch_status in ('draft', 'capturing', 'cancelled', 'failed')
    or captured_at is not null
  ),
  constraint cpo_contact_discovery_batches_activation_check check (
    batch_status not in ('active', 'paused', 'completed')
    or activated_at is not null
  ),
  constraint cpo_contact_discovery_batches_finished_check check (
    batch_status not in ('completed', 'cancelled')
    or finished_at is not null
  ),
  constraint cpo_contact_discovery_batches_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint cpo_contact_discovery_batches_id_selector_unique
    unique (id, selector_key)
);

create index if not exists cpo_contact_discovery_batches_status_idx
  on public.complete_power_outage_contact_discovery_batches (
    batch_status,
    created_at desc
  );

-- Nemenny obsah budouci davky. Jedno ICO se v jedne davce objevi pouze jednou,
-- i kdyz ma vice kandidatu, adres nebo planovanych odstavek.
create table if not exists public.complete_power_outage_contact_discovery_batch_items (
  batch_id uuid not null
    references public.complete_power_outage_contact_discovery_batches(id)
    on delete restrict,
  ico text not null,
  company_profile_id uuid,
  company_name text not null,
  candidate_count integer not null,
  outage_count integer not null,
  nearest_outage_starts_at timestamptz not null,
  latest_outage_ends_at timestamptz not null,
  outage_sources text[] not null default '{}'::text[],
  profile_ready_at_capture boolean not null,
  target_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (batch_id, ico),
  constraint cpo_contact_discovery_batch_items_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico)
    on delete restrict,
  constraint cpo_contact_discovery_batch_items_ico_check check (
    ico ~ '^[0-9]{8}$'
  ),
  constraint cpo_contact_discovery_batch_items_name_check check (
    btrim(company_name) <> ''
  ),
  constraint cpo_contact_discovery_batch_items_counts_check check (
    candidate_count > 0 and outage_count > 0
  ),
  constraint cpo_contact_discovery_batch_items_dates_check check (
    latest_outage_ends_at > nearest_outage_starts_at
  ),
  constraint cpo_contact_discovery_batch_items_sources_check check (
    cardinality(outage_sources) > 0
    and array_position(outage_sources, null) is null
    and outage_sources <@ array['cez', 'egd', 'pre']::text[]
  ),
  constraint cpo_contact_discovery_batch_items_profile_check check (
    profile_ready_at_capture = (company_profile_id is not null)
  ),
  constraint cpo_contact_discovery_batch_items_snapshot_check check (
    jsonb_typeof(target_snapshot) = 'object'
  )
);

create index if not exists cpo_contact_discovery_batch_items_profile_idx
  on public.complete_power_outage_contact_discovery_batch_items (
    profile_ready_at_capture,
    ico
  );

-- Globalne pouze jeden radek na ICO. Dalsi selector muze firmu znovu zahrnout
-- do sveho manifestu, ale nevytvori druhou soubeznou polozku ke zpracovani.
create table if not exists public.complete_power_outage_contact_discovery_queue (
  ico text primary key,
  origin_batch_id uuid not null,
  origin_selector_key text not null
    references public.complete_power_outage_contact_discovery_selectors(selector_key)
    on delete restrict,
  company_profile_id uuid,
  queue_status text not null default 'waiting_profile',
  priority integer not null default 100,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 5,
  next_attempt_at timestamptz,
  processing_token uuid,
  processing_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  discovered_website_id uuid,
  discovered_contact_count integer not null default 0,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_contact_discovery_queue_batch_item_fkey
    foreign key (origin_batch_id, ico)
    references public.complete_power_outage_contact_discovery_batch_items(batch_id, ico)
    on delete restrict,
  constraint cpo_contact_discovery_queue_batch_selector_fkey
    foreign key (origin_batch_id, origin_selector_key)
    references public.complete_power_outage_contact_discovery_batches(id, selector_key)
    on delete restrict,
  constraint cpo_contact_discovery_queue_profile_fkey
    foreign key (company_profile_id, ico)
    references public.complete_power_outage_company_profiles(id, ico)
    on delete restrict,
  constraint cpo_contact_discovery_queue_website_fkey
    foreign key (discovered_website_id, company_profile_id)
    references public.complete_power_outage_company_websites(id, company_profile_id)
    on delete restrict,
  constraint cpo_contact_discovery_queue_ico_check check (
    ico ~ '^[0-9]{8}$'
  ),
  constraint cpo_contact_discovery_queue_status_check check (
    queue_status in (
      'waiting_profile', 'pending', 'processing', 'ready',
      'no_website', 'no_contact', 'error', 'needs_review',
      'skipped', 'cancelled'
    )
  ),
  constraint cpo_contact_discovery_queue_priority_check check (
    priority between 0 and 1000
  ),
  constraint cpo_contact_discovery_queue_attempts_check check (
    attempt_count >= 0
    and max_attempt_count between 1 and 20
    and attempt_count <= max_attempt_count
  ),
  constraint cpo_contact_discovery_queue_profile_check check (
    (queue_status = 'waiting_profile' and company_profile_id is null)
    or (queue_status <> 'waiting_profile' and company_profile_id is not null)
  ),
  constraint cpo_contact_discovery_queue_processing_check check (
    (
      queue_status = 'processing'
      and processing_token is not null
      and processing_expires_at is not null
      and started_at is not null
    )
    or (
      queue_status <> 'processing'
      and processing_token is null
      and processing_expires_at is null
    )
  ),
  constraint cpo_contact_discovery_queue_result_check check (
    (queue_status = 'ready'
      and discovered_website_id is not null
      and discovered_contact_count > 0)
    or (queue_status = 'no_contact'
      and discovered_website_id is not null
      and discovered_contact_count = 0)
    or (queue_status = 'no_website'
      and discovered_website_id is null
      and discovered_contact_count = 0)
    or (queue_status not in ('ready', 'no_contact', 'no_website'))
  ),
  constraint cpo_contact_discovery_queue_finished_check check (
    queue_status not in (
      'ready', 'no_website', 'no_contact', 'skipped', 'cancelled'
    )
    or finished_at is not null
  ),
  constraint cpo_contact_discovery_queue_contact_count_check check (
    discovered_contact_count >= 0
  ),
  constraint cpo_contact_discovery_queue_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists cpo_contact_discovery_queue_work_idx
  on public.complete_power_outage_contact_discovery_queue (
    queue_status,
    priority desc,
    next_attempt_at,
    created_at
  )
  where queue_status in ('waiting_profile', 'pending', 'error');

create index if not exists cpo_contact_discovery_queue_batch_idx
  on public.complete_power_outage_contact_discovery_queue (
    origin_batch_id,
    queue_status,
    ico
  );

-- Polozky zachyceneho manifestu jsou append-only. U davky lze menit provozni
-- stav, nikoli po zachyceni zpetne prepsat selector nebo jeho puvodni rozsah.
create or replace function public.protect_complete_power_outage_contact_discovery_batch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Historii davky dohledavani kontaktu nelze odstranit.';
  end if;

  if old.captured_at is not null and (
    new.selector_key is distinct from old.selector_key
    or new.selection_version_key is distinct from old.selection_version_key
    or new.selector_contract_snapshot is distinct from old.selector_contract_snapshot
    or new.target_ico_count is distinct from old.target_ico_count
    or new.profile_ready_count is distinct from old.profile_ready_count
    or new.profile_waiting_count is distinct from old.profile_waiting_count
    or new.captured_at is distinct from old.captured_at
  ) then
    raise exception 'Zachyceny vyber dohledavani kontaktu je nemenny.';
  end if;

  return new;
end;
$$;

create or replace function public.protect_complete_power_outage_contact_discovery_batch_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Zachycene polozky davky dohledavani kontaktu jsou nemenne.';
  return old;
end;
$$;

drop trigger if exists cpo_contact_discovery_batches_protect
  on public.complete_power_outage_contact_discovery_batches;
create trigger cpo_contact_discovery_batches_protect
before update or delete on public.complete_power_outage_contact_discovery_batches
for each row execute function
  public.protect_complete_power_outage_contact_discovery_batch();

drop trigger if exists cpo_contact_discovery_batch_items_protect
  on public.complete_power_outage_contact_discovery_batch_items;
create trigger cpo_contact_discovery_batch_items_protect
before update or delete on public.complete_power_outage_contact_discovery_batch_items
for each row execute function
  public.protect_complete_power_outage_contact_discovery_batch_item();

drop trigger if exists cpo_contact_discovery_batches_set_updated_at
  on public.complete_power_outage_contact_discovery_batches;
create trigger cpo_contact_discovery_batches_set_updated_at
before update on public.complete_power_outage_contact_discovery_batches
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists cpo_contact_discovery_queue_set_updated_at
  on public.complete_power_outage_contact_discovery_queue;
create trigger cpo_contact_discovery_queue_set_updated_at
before update on public.complete_power_outage_contact_discovery_queue
for each row execute function public.set_power_outage_updated_at();

alter table public.complete_power_outage_contact_discovery_batches
  enable row level security;
alter table public.complete_power_outage_contact_discovery_batch_items
  enable row level security;
alter table public.complete_power_outage_contact_discovery_queue
  enable row level security;

-- Obsah vyberu ani fronty nesmi bezny prihlaseny uzivatel globalne vycitat.
-- Pozdejsi administracni UI dostane pouze bezpecne agregacni RPC.
revoke all on table public.complete_power_outage_contact_discovery_batches
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_contact_discovery_batch_items
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_contact_discovery_queue
  from public, anon, authenticated;

grant all on table public.complete_power_outage_contact_discovery_batches
  to service_role;
grant all on table public.complete_power_outage_contact_discovery_batch_items
  to service_role;
grant all on table public.complete_power_outage_contact_discovery_queue
  to service_role;

revoke all on function
  public.protect_complete_power_outage_contact_discovery_batch()
  from public, anon, authenticated;
revoke all on function
  public.protect_complete_power_outage_contact_discovery_batch_item()
  from public, anon, authenticated;
grant execute on function
  public.protect_complete_power_outage_contact_discovery_batch()
  to service_role;
grant execute on function
  public.protect_complete_power_outage_contact_discovery_batch_item()
  to service_role;

commit;
