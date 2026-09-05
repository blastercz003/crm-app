begin;

create extension if not exists pgcrypto;

do $$
begin
  if to_regprocedure('public.current_user_is_admin()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.current_user_is_admin().';
  end if;
  if to_regclass('public.power_outage_job_client_mappings') is null then
    raise exception 'Nejdříve musí být nasazena tabulka public.power_outage_job_client_mappings.';
  end if;
  if to_regclass('public.client_contacts') is null then
    raise exception 'Nejdříve musí být nasazena tabulka public.client_contacts.';
  end if;
  if to_regprocedure('public.set_power_outage_updated_at()') is null then
    raise exception 'Nejdříve musí být nasazena funkce public.set_power_outage_updated_at().';
  end if;
end
$$;

-- Globální pojistka. Samotná existence konfigurace nikdy nesmí povolit odesílání.
create table if not exists public.power_outage_client_email_state (
  singleton boolean primary key default true,
  runtime_mode text not null default 'disabled',
  dispatch_enabled boolean not null default false,
  provider text not null default 'resend',
  last_planned_at timestamptz,
  last_dispatched_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_client_email_state_singleton_check
    check (singleton),
  constraint power_outage_client_email_state_mode_check
    check (runtime_mode in ('disabled', 'shadow', 'test', 'live')),
  constraint power_outage_client_email_state_dispatch_check
    check (not dispatch_enabled or runtime_mode in ('test', 'live')),
  constraint power_outage_client_email_state_provider_check
    check (provider = 'resend')
);

insert into public.power_outage_client_email_state (
  singleton,
  runtime_mode,
  dispatch_enabled,
  provider
)
values (true, 'disabled', false, 'resend')
on conflict (singleton) do nothing;

-- Nastavení je oddělené pro každého sledovaného klienta/řetězec MARKETY.
create table if not exists public.power_outage_client_email_settings (
  client_id uuid primary key references public.clients(id) on delete restrict,
  chain_name text not null unique
    references public.power_outage_job_client_mappings(chain_name) on delete restrict,
  client_name_snapshot text not null,
  mode text not null default 'disabled',
  from_name text,
  from_email text,
  reply_to_email text,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_client_email_settings_mode_check
    check (mode in ('disabled', 'shadow', 'test', 'live')),
  constraint power_outage_client_email_settings_sender_check
    check (
      mode in ('disabled', 'shadow')
      or (
        nullif(trim(from_name), '') is not null
        and from_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      )
    ),
  constraint power_outage_client_email_settings_activation_check
    check ((mode <> 'live') or activated_at is not null)
);

insert into public.power_outage_client_email_settings (
  client_id,
  chain_name,
  client_name_snapshot,
  mode
)
select
  mapping.client_id,
  mapping.chain_name,
  mapping.client_name_snapshot,
  'disabled'
from public.power_outage_job_client_mappings as mapping
on conflict (chain_name) do update
set client_id = excluded.client_id,
    client_name_snapshot = excluded.client_name_snapshot,
    updated_at = now();

create table if not exists public.power_outage_client_email_recipients (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.power_outage_client_email_settings(client_id) on delete cascade,
  source_contact_id uuid references public.client_contacts(id) on delete set null,
  recipient_kind text not null default 'to',
  name text,
  email text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_client_email_recipients_kind_check
    check (recipient_kind in ('to', 'cc', 'bcc')),
  constraint power_outage_client_email_recipients_email_check
    check (
      email = trim(email)
      and email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    )
);

create unique index if not exists power_outage_client_email_recipients_unique_email_idx
  on public.power_outage_client_email_recipients (
    client_id,
    recipient_kind,
    lower(email)
  );

create index if not exists power_outage_client_email_recipients_active_idx
  on public.power_outage_client_email_recipients (client_id, recipient_kind)
  where is_active = true;

create table if not exists public.power_outage_client_email_rules (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.power_outage_client_email_settings(client_id) on delete cascade,
  name text not null,
  event_kind text not null,
  enabled boolean not null default false,
  condition_schema_version integer not null default 1,
  conditions jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  activated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_client_email_rules_name_check
    check (nullif(trim(name), '') is not null),
  constraint power_outage_client_email_rules_event_check
    check (event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h')),
  constraint power_outage_client_email_rules_schema_check
    check (condition_schema_version >= 1),
  constraint power_outage_client_email_rules_conditions_check
    check (jsonb_typeof(conditions) = 'object'),
  constraint power_outage_client_email_rules_version_check
    check (version >= 1),
  constraint power_outage_client_email_rules_activation_check
    check (not enabled or activated_at is not null),
  constraint power_outage_client_email_rules_version_unique
    unique (client_id, event_kind, name, version)
);

create index if not exists power_outage_client_email_rules_enabled_idx
  on public.power_outage_client_email_rules (client_id, event_kind)
  where enabled = true;

-- Neměnný audit plánovaných a skutečných pokusů o doručení.
create table if not exists public.power_outage_client_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  rule_id uuid references public.power_outage_client_email_rules(id) on delete set null,
  outage_id uuid references public.power_outages(id) on delete set null,
  outage_version_id uuid references public.power_outage_versions(id) on delete set null,
  event_kind text not null,
  mode_at_plan text not null,
  dedupe_key text not null unique,
  delivery_status text not null default 'planned',
  recipient_snapshot jsonb not null default '[]'::jsonb,
  store_snapshot jsonb not null default '[]'::jsonb,
  subject_snapshot text,
  html_snapshot text,
  text_snapshot text,
  provider text,
  provider_message_id text,
  attempt_count integer not null default 0,
  max_attempt_count integer not null default 5,
  next_attempt_at timestamptz,
  processing_token uuid,
  processing_expires_at timestamptz,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  skipped_at timestamptz,
  last_error_code text,
  last_error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint power_outage_client_email_deliveries_event_check
    check (event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h')),
  constraint power_outage_client_email_deliveries_mode_check
    check (mode_at_plan in ('shadow', 'test', 'live')),
  constraint power_outage_client_email_deliveries_status_check
    check (delivery_status in (
      'planned', 'queued', 'sending', 'sent', 'delivered', 'bounced',
      'complained', 'failed', 'skipped', 'cancelled'
    )),
  constraint power_outage_client_email_deliveries_recipients_check
    check (jsonb_typeof(recipient_snapshot) = 'array'),
  constraint power_outage_client_email_deliveries_stores_check
    check (jsonb_typeof(store_snapshot) = 'array'),
  constraint power_outage_client_email_deliveries_attempts_check
    check (
      attempt_count >= 0
      and max_attempt_count between 1 and 20
      and attempt_count <= max_attempt_count
    ),
  constraint power_outage_client_email_deliveries_provider_check
    check (provider is null or provider = 'resend'),
  constraint power_outage_client_email_deliveries_metadata_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists power_outage_client_email_deliveries_queue_idx
  on public.power_outage_client_email_deliveries (
    delivery_status,
    next_attempt_at,
    created_at
  )
  where delivery_status in ('planned', 'queued', 'failed');

create index if not exists power_outage_client_email_deliveries_client_idx
  on public.power_outage_client_email_deliveries (client_id, created_at desc);

create index if not exists power_outage_client_email_deliveries_outage_idx
  on public.power_outage_client_email_deliveries (outage_id, created_at desc);

create unique index if not exists power_outage_client_email_deliveries_provider_message_uidx
  on public.power_outage_client_email_deliveries (provider, provider_message_id)
  where provider_message_id is not null;

create table if not exists public.power_outage_client_email_delivery_matches (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.power_outage_client_email_deliveries(id) on delete cascade,
  match_id uuid references public.power_outage_store_matches(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  store_chain_name text not null,
  store_number text not null,
  store_city text not null,
  store_address text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists power_outage_client_email_delivery_matches_match_uidx
  on public.power_outage_client_email_delivery_matches (delivery_id, match_id)
  where match_id is not null;

create index if not exists power_outage_client_email_delivery_matches_delivery_idx
  on public.power_outage_client_email_delivery_matches (delivery_id, created_at);

create table if not exists public.power_outage_client_email_provider_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid
    references public.power_outage_client_email_deliveries(id) on delete set null,
  provider text not null default 'resend',
  provider_event_id text not null,
  provider_message_id text,
  event_kind text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  constraint power_outage_client_email_provider_events_provider_check
    check (provider = 'resend'),
  constraint power_outage_client_email_provider_events_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint power_outage_client_email_provider_events_unique
    unique (provider, provider_event_id)
);

create index if not exists power_outage_client_email_provider_events_message_idx
  on public.power_outage_client_email_provider_events (
    provider,
    provider_message_id,
    received_at desc
  );

drop trigger if exists power_outage_client_email_state_set_updated_at
  on public.power_outage_client_email_state;
create trigger power_outage_client_email_state_set_updated_at
before update on public.power_outage_client_email_state
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_client_email_settings_set_updated_at
  on public.power_outage_client_email_settings;
create trigger power_outage_client_email_settings_set_updated_at
before update on public.power_outage_client_email_settings
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_client_email_recipients_set_updated_at
  on public.power_outage_client_email_recipients;
create trigger power_outage_client_email_recipients_set_updated_at
before update on public.power_outage_client_email_recipients
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_client_email_rules_set_updated_at
  on public.power_outage_client_email_rules;
create trigger power_outage_client_email_rules_set_updated_at
before update on public.power_outage_client_email_rules
for each row execute function public.set_power_outage_updated_at();

drop trigger if exists power_outage_client_email_deliveries_set_updated_at
  on public.power_outage_client_email_deliveries;
create trigger power_outage_client_email_deliveries_set_updated_at
before update on public.power_outage_client_email_deliveries
for each row execute function public.set_power_outage_updated_at();

alter table public.power_outage_client_email_state enable row level security;
alter table public.power_outage_client_email_settings enable row level security;
alter table public.power_outage_client_email_recipients enable row level security;
alter table public.power_outage_client_email_rules enable row level security;
alter table public.power_outage_client_email_deliveries enable row level security;
alter table public.power_outage_client_email_delivery_matches enable row level security;
alter table public.power_outage_client_email_provider_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'power_outage_client_email_state',
    'power_outage_client_email_settings',
    'power_outage_client_email_recipients',
    'power_outage_client_email_rules',
    'power_outage_client_email_deliveries',
    'power_outage_client_email_delivery_matches',
    'power_outage_client_email_provider_events'
  ] loop
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_admin_read',
      table_name
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.current_user_is_admin())',
      table_name || '_admin_read',
      table_name
    );
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      table_name
    );
    execute format(
      'grant select on table public.%I to authenticated',
      table_name
    );
    execute format(
      'grant all on table public.%I to service_role',
      table_name
    );
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;

-- Kontrolní audit kroku 1. Všechny řádky musí vrátit is_correct = true.
select 'TABLE' as check_type, object_name,
  to_regclass('public.' || object_name) is not null as is_correct
from unnest(array[
  'power_outage_client_email_state',
  'power_outage_client_email_settings',
  'power_outage_client_email_recipients',
  'power_outage_client_email_rules',
  'power_outage_client_email_deliveries',
  'power_outage_client_email_delivery_matches',
  'power_outage_client_email_provider_events'
]) as object_name
union all
select 'RLS', 'all client email tables have RLS',
  not exists (
    select 1
    from unnest(array[
      'power_outage_client_email_state',
      'power_outage_client_email_settings',
      'power_outage_client_email_recipients',
      'power_outage_client_email_rules',
      'power_outage_client_email_deliveries',
      'power_outage_client_email_delivery_matches',
      'power_outage_client_email_provider_events'
    ]) as checked(table_name)
    left join pg_class
      on pg_class.oid = ('public.' || checked.table_name)::regclass
    where not coalesce(pg_class.relrowsecurity, false)
  )
union all
select 'STATE', 'client email dispatch remains disabled',
  exists (
    select 1
    from public.power_outage_client_email_state
    where singleton
      and runtime_mode = 'disabled'
      and dispatch_enabled = false
  )
union all
select 'STATE', 'all client email settings remain disabled',
  not exists (
    select 1
    from public.power_outage_client_email_settings
    where mode <> 'disabled'
  )
union all
select 'DATA', 'tracked MARKET clients have email settings',
  not exists (
    select 1
    from public.power_outage_job_client_mappings as mapping
    where not exists (
      select 1
      from public.power_outage_client_email_settings as settings
      where settings.client_id = mapping.client_id
        and settings.chain_name = mapping.chain_name
    )
  )
union all
select 'SAFETY', 'no client email delivery was created',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
  )
union all
select 'SAFETY', 'no client email rule is enabled',
  not exists (
    select 1
    from public.power_outage_client_email_rules
    where enabled
  )
union all
select 'SAFETY', 'no client email cron exists',
  not exists (
    select 1
    from cron.job
    where jobname ilike '%client%email%'
       or command ilike '%client_email%'
  )
union all
select 'GRANT', 'authenticated has read-only table grants',
  not exists (
    select 1
    from information_schema.role_table_grants
    where grantee = 'authenticated'
      and table_schema = 'public'
      and table_name like 'power_outage_client_email_%'
      and privilege_type <> 'SELECT'
  )
order by check_type, object_name;
