begin;

-- Krok 10.4: velmi maly, rucne spravovany allowlist konkretne schvalenych
-- oznameni. Vychozi limit jsou 3 firmy a databazovy strop je 5 firem.
-- Allowlist sam nic neodesila a neaktivuje LIVE rezim.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_pilot_review_events') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_pilot_review_events');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_pilot_reviews_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_pilot_reviews_v1');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_plans') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_plans');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_state');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro pilotni allowlist KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_pilot_allowlist_state (
  singleton boolean primary key default true check (singleton),
  management_enabled boolean not null default true,
  configured_max_company_count integer not null default 3,
  hard_max_company_count integer not null default 5,
  ui_enabled boolean not null default false,
  live_dispatch_enabled boolean not null default false,
  rules_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpo_pilot_allowlist_limit_check check (
    configured_max_company_count between 1 and 5
    and hard_max_company_count = 5
    and configured_max_company_count <= hard_max_company_count
  ),
  constraint cpo_pilot_allowlist_ui_safety_check check (
    not ui_enabled or management_enabled
  ),
  constraint cpo_pilot_allowlist_live_safety_check check (
    not live_dispatch_enabled
  ),
  constraint cpo_pilot_allowlist_rules_check check (rules_version > 0),
  constraint cpo_pilot_allowlist_metadata_check check (jsonb_typeof(metadata) = 'object')
);

insert into public.complete_power_outage_notification_email_pilot_allowlist_state (
  singleton, management_enabled, configured_max_company_count,
  hard_max_company_count, ui_enabled, live_dispatch_enabled,
  rules_version, metadata
) values (
  true, true, 3, 5, false, false, 1,
  jsonb_build_object(
    'contract', 'complete-notification-email-pilot-allowlist-v1',
    'selectionMode', 'manual_only',
    'scope', 'approved_specific_notice',
    'sendingAttempted', false,
    'installedAt', now()
  )
)
on conflict (singleton) do update
set management_enabled = true,
    configured_max_company_count = public.complete_power_outage_notification_email_pilot_allowlist_state.configured_max_company_count,
    hard_max_company_count = 5,
    ui_enabled = false,
    live_dispatch_enabled = false,
    rules_version = 1,
    metadata = public.complete_power_outage_notification_email_pilot_allowlist_state.metadata
      || excluded.metadata,
    updated_at = now();

-- Slozene unikatni indexy umozni vynutit, ze udalost allowlistu odkazuje
-- na rozhodnuti i ICO tehoz konkretniho planu, ne pouze na existujici UUID.
create unique index if not exists cpo_pilot_review_event_plan_identity_idx
  on public.complete_power_outage_notification_email_pilot_review_events (id, plan_id);
create unique index if not exists cpo_notification_email_plan_ico_identity_idx
  on public.complete_power_outage_notification_email_plans (id, ico);

create table if not exists public.complete_power_outage_notification_email_pilot_allowlist_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null,
  ico_snapshot text not null,
  action text not null,
  plan_fingerprint text not null,
  source_review_event_id uuid not null,
  reason text not null,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_pilot_allowlist_plan_ico_fkey
    foreign key (plan_id, ico_snapshot)
    references public.complete_power_outage_notification_email_plans(id, ico) on delete restrict,
  constraint cpo_pilot_allowlist_review_plan_fkey
    foreign key (source_review_event_id, plan_id)
    references public.complete_power_outage_notification_email_pilot_review_events(id, plan_id) on delete restrict,
  constraint cpo_pilot_allowlist_action_check check (action in ('added', 'removed')),
  constraint cpo_pilot_allowlist_ico_check check (ico_snapshot ~ '^[0-9]{8}$'),
  constraint cpo_pilot_allowlist_fingerprint_check check (plan_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint cpo_pilot_allowlist_reason_check check (btrim(reason) <> ''),
  constraint cpo_pilot_allowlist_event_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cpo_pilot_allowlist_latest_plan_idx
  on public.complete_power_outage_notification_email_pilot_allowlist_events (
    plan_id, created_at desc, id desc
  );
create index if not exists cpo_pilot_allowlist_latest_ico_idx
  on public.complete_power_outage_notification_email_pilot_allowlist_events (
    ico_snapshot, created_at desc, id desc
  );

create or replace function public.prevent_cpo_notification_email_pilot_allowlist_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie pilotniho allowlistu je nemenna; vlozte novou udalost.';
end;
$$;

drop trigger if exists cpo_notification_email_pilot_allowlist_immutable
  on public.complete_power_outage_notification_email_pilot_allowlist_events;
create trigger cpo_notification_email_pilot_allowlist_immutable
before update or delete
on public.complete_power_outage_notification_email_pilot_allowlist_events
for each row execute function public.prevent_cpo_notification_email_pilot_allowlist_mutation();

create or replace view public.complete_power_outage_notification_email_pilot_allowlist_v1
with (security_invoker = true)
as
with latest_event as (
  select distinct on (event.plan_id)
    event.plan_id,
    event.id as allowlist_event_id,
    event.ico_snapshot,
    event.action,
    event.plan_fingerprint,
    event.source_review_event_id,
    event.reason,
    event.decided_by,
    event.created_at
  from public.complete_power_outage_notification_email_pilot_allowlist_events event
  order by event.plan_id, event.created_at desc, event.id desc
)
select
  latest_event.plan_id,
  latest_event.allowlist_event_id,
  latest_event.ico_snapshot as ico,
  latest_event.action,
  latest_event.source_review_event_id,
  latest_event.reason,
  latest_event.decided_by,
  latest_event.created_at,
  latest_event.action = 'added'
    and latest_event.plan_fingerprint = public.cpo_notification_email_plan_fingerprint_v1(plan.id)
    and review.review_status = 'approved'
    and review.decision_id = latest_event.source_review_event_id
    and review.approved_and_eligible_now
    as active_and_eligible_now
from latest_event
join public.complete_power_outage_notification_email_plans plan
  on plan.id = latest_event.plan_id and plan.ico = latest_event.ico_snapshot
join public.complete_power_outage_notification_email_pilot_reviews_v1 review
  on review.plan_id = latest_event.plan_id;

-- Ochrana je i na urovni tabulky, aby limit ani podminky neslo obejit
-- budoucim serverovym kodem, ktery by omylem vlozil udalost napřímo.
create or replace function public.guard_cpo_notification_email_pilot_allowlist_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowlist_state public.complete_power_outage_notification_email_pilot_allowlist_state%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  active_company_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_allowlist_v1', 0)
  );

  select * into allowlist_state
  from public.complete_power_outage_notification_email_pilot_allowlist_state
  where singleton
  for update;

  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;

  if allowlist_state.singleton is null
     or not allowlist_state.management_enabled
     or allowlist_state.live_dispatch_enabled
     or email_state.singleton is null
     or email_state.runtime_mode <> 'shadow'
     or email_state.dispatch_enabled
  then
    raise exception 'Pilotni allowlist lze menit pouze v bezpecnem SHADOW rezimu.';
  end if;

  if new.action = 'added' then
    if new.plan_fingerprint is distinct from public.cpo_notification_email_plan_fingerprint_v1(new.plan_id)
       or not exists (
         select 1
         from public.complete_power_outage_notification_email_pilot_reviews_v1 review
         where review.plan_id = new.plan_id
           and review.decision_id = new.source_review_event_id
           and review.review_status = 'approved'
           and review.approved_and_eligible_now
       )
    then
      raise exception 'Allowlist prijima pouze aktualni rucne schvalene konkretni oznameni.';
    end if;

    if exists (
      select 1
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now
        and entry.ico = new.ico_snapshot
        and entry.plan_id <> new.plan_id
    ) then
      raise exception 'Pro tuto firmu uz je aktivni jine pilotni oznameni.';
    end if;

    if not exists (
      select 1
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now and entry.plan_id = new.plan_id
    ) then
      select count(distinct entry.ico)::integer into active_company_count
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now;

      if active_company_count >= allowlist_state.configured_max_company_count then
        raise exception 'Pilotni allowlist dosahl nastaveneho limitu % firem.',
          allowlist_state.configured_max_company_count;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists cpo_notification_email_pilot_allowlist_insert_guard
  on public.complete_power_outage_notification_email_pilot_allowlist_events;
create trigger cpo_notification_email_pilot_allowlist_insert_guard
before insert
on public.complete_power_outage_notification_email_pilot_allowlist_events
for each row execute function public.guard_cpo_notification_email_pilot_allowlist_insert();

alter table public.complete_power_outage_notification_email_pilot_allowlist_state
  enable row level security;
alter table public.complete_power_outage_notification_email_pilot_allowlist_events
  enable row level security;

revoke all on table public.complete_power_outage_notification_email_pilot_allowlist_state
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_allowlist_events
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_allowlist_v1
  from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_pilot_allowlist_state
  to service_role;
grant all on table public.complete_power_outage_notification_email_pilot_allowlist_events
  to service_role;
grant select on table public.complete_power_outage_notification_email_pilot_allowlist_v1
  to service_role;

create or replace function public.set_cpo_notification_email_pilot_allowlist_v1(
  requested_plan_id uuid,
  requested_included boolean,
  requested_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  allowlist_state public.complete_power_outage_notification_email_pilot_allowlist_state%rowtype;
  email_state public.complete_power_outage_notification_email_state%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  selected_review public.complete_power_outage_notification_email_pilot_reviews_v1%rowtype;
  existing_entry public.complete_power_outage_notification_email_pilot_allowlist_v1%rowtype;
  normalized_reason text := nullif(btrim(coalesce(requested_reason, '')), '');
  active_company_count integer := 0;
  inserted_event_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Pilotni allowlist muze spravovat pouze administrator.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('complete_notification_email_pilot_allowlist_v1', 0)
  );

  select * into allowlist_state
  from public.complete_power_outage_notification_email_pilot_allowlist_state
  where singleton
  for update;

  select * into email_state
  from public.complete_power_outage_notification_email_state
  where singleton;

  if allowlist_state.singleton is null or not allowlist_state.management_enabled then
    raise exception 'Sprava pilotniho allowlistu neni aktivni.';
  end if;

  if email_state.singleton is null
     or email_state.runtime_mode <> 'shadow'
     or email_state.dispatch_enabled
     or allowlist_state.live_dispatch_enabled
  then
    raise exception 'Pilotni allowlist lze menit pouze pri vypnutem LIVE odesilani a rezimu SHADOW.';
  end if;

  select * into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  where plan.id = requested_plan_id
  for share;

  if selected_plan.id is null then
    raise exception 'Pozadovane oznameni nebylo nalezeno.';
  end if;

  select * into selected_review
  from public.complete_power_outage_notification_email_pilot_reviews_v1 review
  where review.plan_id = selected_plan.id;

  select * into existing_entry
  from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
  where entry.plan_id = selected_plan.id;

  if requested_included then
    if selected_review.plan_id is null
       or selected_review.review_status <> 'approved'
       or not selected_review.approved_and_eligible_now
    then
      raise exception 'Do allowlistu lze pridat jen rucne schvalene a stale platne konkretni oznameni.';
    end if;

    if existing_entry.plan_id is not null and existing_entry.active_and_eligible_now then
      return jsonb_build_object(
        'status', 'already_included',
        'planId', selected_plan.id,
        'ico', selected_plan.ico,
        'sendingAttempted', false,
        'liveDispatchEnabled', false
      );
    end if;

    if exists (
      select 1
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now
        and entry.ico = selected_plan.ico
        and entry.plan_id <> selected_plan.id
    ) then
      raise exception 'Pro tuto firmu uz je v allowlistu jine konkretni oznameni.';
    end if;

    select count(distinct entry.ico)::integer into active_company_count
    from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
    where entry.active_and_eligible_now;

    if active_company_count >= allowlist_state.configured_max_company_count then
      raise exception 'Pilotni allowlist dosahl nastaveneho limitu % firem.',
        allowlist_state.configured_max_company_count;
    end if;
  elsif existing_entry.plan_id is null or existing_entry.action = 'removed' then
    return jsonb_build_object(
      'status', 'already_removed',
      'planId', selected_plan.id,
      'ico', selected_plan.ico,
      'sendingAttempted', false,
      'liveDispatchEnabled', false
    );
  end if;

  if selected_review.decision_id is null then
    raise exception 'Oznameni nema zadne rucni rozhodnuti, ke kteremu lze allowlist navazat.';
  end if;

  insert into public.complete_power_outage_notification_email_pilot_allowlist_events (
    plan_id, ico_snapshot, action, plan_fingerprint, source_review_event_id,
    reason, decided_by, metadata
  ) values (
    selected_plan.id,
    selected_plan.ico,
    case when requested_included then 'added' else 'removed' end,
    public.cpo_notification_email_plan_fingerprint_v1(selected_plan.id),
    selected_review.decision_id,
    coalesce(normalized_reason, case when requested_included
      then 'Rucne zarazeno do omezeneho pilotniho allowlistu.'
      else 'Rucne odebrano z omezeneho pilotniho allowlistu.'
    end),
    auth.uid(),
    jsonb_build_object(
      'contract', 'complete-notification-email-pilot-allowlist-v1',
      'configuredMaximumCompanyCount', allowlist_state.configured_max_company_count,
      'hardMaximumCompanyCount', allowlist_state.hard_max_company_count,
      'sendingAttempted', false,
      'liveDispatchEnabled', false
    )
  ) returning id into inserted_event_id;

  return jsonb_build_object(
    'status', case when requested_included then 'included' else 'removed' end,
    'planId', selected_plan.id,
    'ico', selected_plan.ico,
    'allowlistEventId', inserted_event_id,
    'configuredMaximumCompanyCount', allowlist_state.configured_max_company_count,
    'hardMaximumCompanyCount', allowlist_state.hard_max_company_count,
    'sendingAttempted', false,
    'liveDispatchEnabled', false
  );
end;
$$;

create or replace function public.get_cpo_notification_email_pilot_allowlist_v1(
  requested_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Pilotni allowlist je dostupny pouze administratorum.';
  end if;

  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'Limit prehledu musi byt mezi 1 a 100.';
  end if;

  select jsonb_build_object(
    'contract', 'complete-notification-email-pilot-allowlist-v1',
    'managementEnabled', state_row.management_enabled,
    'uiEnabled', state_row.ui_enabled,
    'liveDispatchEnabled', false,
    'configuredMaximumCompanyCount', state_row.configured_max_company_count,
    'hardMaximumCompanyCount', state_row.hard_max_company_count,
    'activeCompanyCount', (
      select count(distinct entry.ico)
      from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
      where entry.active_and_eligible_now
    ),
    'activeItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planId', item.plan_id,
        'companyName', item.company_name_snapshot,
        'ico', item.ico,
        'recipientEmail', item.recipient_email,
        'startsAt', item.starts_at_snapshot,
        'endsAt', item.ends_at_snapshot,
        'municipality', item.municipality_snapshot,
        'addresses', item.address_snapshot,
        'includedAt', item.included_at,
        'reason', item.reason
      ) order by item.starts_at_snapshot, item.company_name_snapshot)
      from (
        select
          plan.id as plan_id,
          plan.company_name_snapshot,
          plan.ico,
          plan.recipient_email,
          plan.starts_at_snapshot,
          plan.ends_at_snapshot,
          plan.municipality_snapshot,
          plan.address_snapshot,
          entry.created_at as included_at,
          entry.reason
        from public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
        join public.complete_power_outage_notification_email_plans plan on plan.id = entry.plan_id
        where entry.active_and_eligible_now
        order by plan.starts_at_snapshot, plan.company_name_snapshot
        limit requested_limit
      ) item
    ), '[]'::jsonb),
    'approvedCandidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planId', candidate.plan_id,
        'companyName', candidate.company_name_snapshot,
        'ico', candidate.ico,
        'recipientEmail', candidate.recipient_email,
        'startsAt', candidate.starts_at_snapshot,
        'endsAt', candidate.ends_at_snapshot,
        'municipality', candidate.municipality_snapshot,
        'addresses', candidate.address_snapshot
      ) order by candidate.starts_at_snapshot, candidate.company_name_snapshot)
      from (
        select
          plan.id as plan_id,
          plan.company_name_snapshot,
          plan.ico,
          plan.recipient_email,
          plan.starts_at_snapshot,
          plan.ends_at_snapshot,
          plan.municipality_snapshot,
          plan.address_snapshot
        from public.complete_power_outage_notification_email_pilot_reviews_v1 review
        join public.complete_power_outage_notification_email_plans plan on plan.id = review.plan_id
        left join public.complete_power_outage_notification_email_pilot_allowlist_v1 entry
          on entry.plan_id = plan.id and entry.active_and_eligible_now
        where review.review_status = 'approved'
          and review.approved_and_eligible_now
          and entry.plan_id is null
        order by plan.starts_at_snapshot, plan.company_name_snapshot
        limit requested_limit
      ) candidate
    ), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_notification_email_pilot_allowlist_state state_row
  where state_row.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.prevent_cpo_notification_email_pilot_allowlist_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_cpo_notification_email_pilot_allowlist_insert()
  from public, anon, authenticated;
revoke all on function public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)
  from public, anon;
revoke all on function public.get_cpo_notification_email_pilot_allowlist_v1(integer)
  from public, anon;

grant execute on function public.prevent_cpo_notification_email_pilot_allowlist_mutation()
  to service_role;
grant execute on function public.guard_cpo_notification_email_pilot_allowlist_insert()
  to service_role;
grant execute on function public.set_cpo_notification_email_pilot_allowlist_v1(uuid,boolean,text)
  to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_pilot_allowlist_v1(integer)
  to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
      'pilotAllowlistContract', 'complete-notification-email-pilot-allowlist-v1',
      'pilotAllowlistEnabled', true,
      'pilotAllowlistUiEnabled', false,
      'pilotAllowlistConfiguredMaximumCompanyCount', 3,
      'pilotAllowlistHardMaximumCompanyCount', 5,
      'liveDispatchEnabled', false,
      'pilotAllowlistInstalledAt', now()
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
