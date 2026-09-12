begin;

-- Krok 10.3: rucni administratorske schvaleni konkretniho oznameni pro
-- budouci pilot KOMPLETNI. Tento krok nic neodesila, nevytvari allowlist
-- a nemeni SHADOW rezim ani stav planu.
do $$
declare
  missing_dependencies text[] := array[]::text[];
begin
  if to_regclass('public.complete_power_outage_notification_email_plans') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_plans');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_state') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_state');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_candidates_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_candidates_v1');
  end if;
  if to_regclass('public.complete_power_outage_notification_email_suppressions_v1') is null then
    missing_dependencies := array_append(missing_dependencies, 'public.complete_power_outage_notification_email_suppressions_v1');
  end if;
  if to_regprocedure('extensions.digest(text,text)') is null then
    missing_dependencies := array_append(missing_dependencies, 'extensions.digest(text,text)');
  end if;

  if cardinality(missing_dependencies) > 0 then
    raise exception 'Chybi zavislosti pro rucni schvalovani pilotu KOMPLETNI: %.',
      array_to_string(missing_dependencies, ', ');
  end if;
end
$$;

create table if not exists public.complete_power_outage_notification_email_pilot_review_events (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null
    references public.complete_power_outage_notification_email_plans(id) on delete restrict,
  decision text not null,
  plan_fingerprint text not null,
  recipient_email_snapshot text not null,
  company_name_snapshot text not null,
  starts_at_snapshot timestamptz not null,
  ends_at_snapshot timestamptz not null,
  reason text not null,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cpo_notification_email_pilot_review_decision_check check (
    decision in ('approved', 'rejected', 'revoked')
  ),
  constraint cpo_notification_email_pilot_review_fingerprint_check check (
    plan_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  constraint cpo_notification_email_pilot_review_email_check check (
    recipient_email_snapshot = lower(btrim(recipient_email_snapshot))
    and recipient_email_snapshot ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint cpo_notification_email_pilot_review_period_check check (
    ends_at_snapshot > starts_at_snapshot
  ),
  constraint cpo_notification_email_pilot_review_reason_check check (
    btrim(reason) <> ''
  ),
  constraint cpo_notification_email_pilot_review_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  )
);

create index if not exists cpo_notification_email_pilot_review_latest_idx
  on public.complete_power_outage_notification_email_pilot_review_events (
    plan_id, created_at desc, id desc
  );

create or replace function public.prevent_cpo_notification_email_pilot_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Historie rucniho schvalovani pilotu je nemenna; vlozte nove rozhodnuti.';
end;
$$;

drop trigger if exists cpo_notification_email_pilot_review_immutable
  on public.complete_power_outage_notification_email_pilot_review_events;
create trigger cpo_notification_email_pilot_review_immutable
before update or delete
on public.complete_power_outage_notification_email_pilot_review_events
for each row execute function public.prevent_cpo_notification_email_pilot_review_mutation();

create or replace function public.cpo_notification_email_plan_fingerprint_v1(
  requested_plan_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(
    jsonb_build_object(
      'planId', plan.id,
      'batchId', plan.batch_id,
      'selectorKey', plan.selector_key,
      'ico', plan.ico,
      'companyProfileId', plan.company_profile_id,
      'outageId', plan.outage_id,
      'eventKind', plan.event_kind,
      'dedupeKey', plan.dedupe_key,
      'recipientEmail', plan.recipient_email,
      'recipientContactId', plan.recipient_contact_id,
      'contactClass', plan.contact_class,
      'companyName', plan.company_name_snapshot,
      'source', plan.source_snapshot,
      'externalId', plan.external_id_snapshot,
      'startsAt', plan.starts_at_snapshot,
      'endsAt', plan.ends_at_snapshot,
      'municipality', plan.municipality_snapshot,
      'addresses', plan.address_snapshot
    )::text,
    'sha256'
  ), 'hex')
  from public.complete_power_outage_notification_email_plans plan
  where plan.id = requested_plan_id;
$$;

create or replace view public.complete_power_outage_notification_email_pilot_reviews_v1
with (security_invoker = true)
as
with latest_decision as (
  select distinct on (event.plan_id)
    event.plan_id,
    event.id as decision_id,
    event.decision,
    event.plan_fingerprint,
    event.reason,
    event.decided_by,
    event.created_at as decided_at
  from public.complete_power_outage_notification_email_pilot_review_events event
  order by event.plan_id, event.created_at desc, event.id desc
)
select
  plan.id as plan_id,
  latest_decision.decision_id,
  coalesce(latest_decision.decision, 'pending') as review_status,
  latest_decision.reason,
  latest_decision.decided_by,
  latest_decision.decided_at,
  latest_decision.plan_fingerprint is not null
    and latest_decision.plan_fingerprint = public.cpo_notification_email_plan_fingerprint_v1(plan.id)
    as revision_is_current,
  latest_decision.decision = 'approved'
    and latest_decision.plan_fingerprint = public.cpo_notification_email_plan_fingerprint_v1(plan.id)
    and plan.plan_status = 'shadow_ready'
    and plan.starts_at_snapshot > now()
    and plan.expires_at > now()
    and not coalesce(suppression.is_suppressed, false)
    and exists (
      select 1
      from public.complete_power_outage_notification_email_candidates_v1 candidate
      where candidate.dedupe_key = plan.dedupe_key
        and candidate.batch_id = plan.batch_id
        and candidate.selector_key = plan.selector_key
        and candidate.company_profile_id = plan.company_profile_id
        and candidate.ico = plan.ico
        and candidate.outage_id = plan.outage_id
        and candidate.recipient_contact_id = plan.recipient_contact_id
        and lower(candidate.recipient_email) = plan.recipient_email
        and candidate.starts_at = plan.starts_at_snapshot
        and candidate.ends_at = plan.ends_at_snapshot
        and candidate.address_snapshot = plan.address_snapshot
    ) as approved_and_eligible_now
from public.complete_power_outage_notification_email_plans plan
left join latest_decision on latest_decision.plan_id = plan.id
left join public.complete_power_outage_notification_email_suppressions_v1 suppression
  on suppression.normalized_email = plan.recipient_email;

alter table public.complete_power_outage_notification_email_pilot_review_events
  enable row level security;

revoke all on table public.complete_power_outage_notification_email_pilot_review_events
  from public, anon, authenticated;
revoke all on table public.complete_power_outage_notification_email_pilot_reviews_v1
  from public, anon, authenticated;
grant all on table public.complete_power_outage_notification_email_pilot_review_events
  to service_role;
grant select on table public.complete_power_outage_notification_email_pilot_reviews_v1
  to service_role;

create or replace function public.decide_cpo_notification_email_pilot_v1(
  requested_plan_id uuid,
  requested_decision text,
  requested_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  state_row public.complete_power_outage_notification_email_state%rowtype;
  normalized_decision text := lower(btrim(coalesce(requested_decision, '')));
  normalized_reason text := nullif(btrim(coalesce(requested_reason, '')), '');
  current_fingerprint text;
  decision_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'O pilotnich oznameni muze rozhodovat pouze administrator.';
  end if;

  if normalized_decision not in ('approved', 'rejected', 'revoked') then
    raise exception 'Neplatne rozhodnuti o pilotnim oznameni.';
  end if;

  select * into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  where plan.id = requested_plan_id
  for share;

  if selected_plan.id is null then
    raise exception 'Pozadovane oznameni nebylo nalezeno.';
  end if;

  select * into state_row
  from public.complete_power_outage_notification_email_state
  where singleton;

  if normalized_decision = 'approved' then
    if state_row.singleton is null
       or state_row.runtime_mode <> 'shadow'
       or not state_row.planning_enabled
       or state_row.dispatch_enabled
    then
      raise exception 'Schvaleni pilotu je dovoleno pouze pri aktivnim SHADOW planovani a vypnutem odesilani.';
    end if;

    if selected_plan.plan_status <> 'shadow_ready'
       or selected_plan.starts_at_snapshot <= now()
       or selected_plan.expires_at <= now()
    then
      raise exception 'Oznameni uz neni aktualni a nelze je schvalit.';
    end if;

    if exists (
      select 1
      from public.complete_power_outage_notification_email_suppressions_v1 suppression
      where suppression.normalized_email = selected_plan.recipient_email
        and suppression.is_suppressed
    ) then
      raise exception 'Odhlaseny kontakt nelze schvalit pro pilot.';
    end if;

    if not exists (
      select 1
      from public.complete_power_outage_notification_email_candidates_v1 candidate
      where candidate.dedupe_key = selected_plan.dedupe_key
        and candidate.batch_id = selected_plan.batch_id
        and candidate.selector_key = selected_plan.selector_key
        and candidate.company_profile_id = selected_plan.company_profile_id
        and candidate.ico = selected_plan.ico
        and candidate.outage_id = selected_plan.outage_id
        and candidate.recipient_contact_id = selected_plan.recipient_contact_id
        and lower(candidate.recipient_email) = selected_plan.recipient_email
        and candidate.starts_at = selected_plan.starts_at_snapshot
        and candidate.ends_at = selected_plan.ends_at_snapshot
        and candidate.address_snapshot = selected_plan.address_snapshot
    ) then
      raise exception 'Oznameni uz neodpovida aktualnimu potvrzenemu vyberu, kontaktu nebo odstavce.';
    end if;
  end if;

  current_fingerprint := public.cpo_notification_email_plan_fingerprint_v1(selected_plan.id);
  if current_fingerprint is null then
    raise exception 'Nepodarilo se vytvorit otisk schvalovaneho oznameni.';
  end if;

  insert into public.complete_power_outage_notification_email_pilot_review_events (
    plan_id, decision, plan_fingerprint, recipient_email_snapshot,
    company_name_snapshot, starts_at_snapshot, ends_at_snapshot,
    reason, decided_by, metadata
  ) values (
    selected_plan.id,
    normalized_decision,
    current_fingerprint,
    selected_plan.recipient_email,
    selected_plan.company_name_snapshot,
    selected_plan.starts_at_snapshot,
    selected_plan.ends_at_snapshot,
    coalesce(normalized_reason, case normalized_decision
      when 'approved' then 'Schvaleno administratorem pro pripravu pilotu.'
      when 'rejected' then 'Zamitnuto administratorem pro pilot.'
      else 'Predchozi rozhodnuti zruseno administratorem.'
    end),
    auth.uid(),
    jsonb_build_object(
      'contract', 'complete-notification-email-pilot-review-v1',
      'sendingAttempted', false,
      'liveDispatchEnabled', false
    )
  ) returning id into decision_id;

  return jsonb_build_object(
    'status', normalized_decision,
    'planId', selected_plan.id,
    'decisionId', decision_id,
    'approvedForFuturePilotPreparation', normalized_decision = 'approved',
    'sendingAttempted', false,
    'liveDispatchEnabled', false
  );
end;
$$;

create or replace function public.get_cpo_notification_email_pilot_review_v1(
  requested_limit integer default 100
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
    raise exception 'Prehled schvalovani pilotu je dostupny pouze administratorum.';
  end if;

  if requested_limit < 1 or requested_limit > 250 then
    raise exception 'Limit prehledu musi byt mezi 1 a 250.';
  end if;

  select jsonb_build_object(
    'contract', 'complete-notification-email-pilot-review-v1',
    'reviewEnabled', true,
    'reviewUiEnabled', false,
    'sendingEnabled', false,
    'liveDispatchEnabled', false,
    'pendingCount', count(*) filter (where review.review_status in ('pending', 'revoked')),
    'approvedCount', count(*) filter (where review.review_status = 'approved'),
    'approvedAndEligibleNowCount', count(*) filter (where review.approved_and_eligible_now),
    'rejectedCount', count(*) filter (where review.review_status = 'rejected'),
    'staleApprovalCount', count(*) filter (
      where review.review_status = 'approved' and not review.approved_and_eligible_now
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planId', listed.plan_id,
        'reviewStatus', case
          when listed.review_status = 'approved' and not listed.approved_and_eligible_now then 'stale'
          when listed.review_status = 'revoked' then 'pending'
          else listed.review_status
        end,
        'approvedAndEligibleNow', listed.approved_and_eligible_now,
        'companyName', listed.company_name_snapshot,
        'ico', listed.ico,
        'recipientEmail', listed.recipient_email,
        'source', listed.source_snapshot,
        'startsAt', listed.starts_at_snapshot,
        'endsAt', listed.ends_at_snapshot,
        'municipality', listed.municipality_snapshot,
        'addresses', listed.address_snapshot,
        'reason', listed.reason,
        'decidedAt', listed.decided_at
      ) order by listed.starts_at_snapshot, listed.company_name_snapshot)
      from (
        select
          plan.id as plan_id,
          review.review_status,
          review.approved_and_eligible_now,
          plan.company_name_snapshot,
          plan.ico,
          plan.recipient_email,
          plan.source_snapshot,
          plan.starts_at_snapshot,
          plan.ends_at_snapshot,
          plan.municipality_snapshot,
          plan.address_snapshot,
          review.reason,
          review.decided_at
        from public.complete_power_outage_notification_email_plans plan
        join public.complete_power_outage_notification_email_pilot_reviews_v1 review
          on review.plan_id = plan.id
        where plan.plan_status = 'shadow_ready'
          and plan.starts_at_snapshot > now()
        order by
          case review.review_status when 'pending' then 0 when 'revoked' then 0 else 1 end,
          plan.starts_at_snapshot,
          plan.company_name_snapshot
        limit requested_limit
      ) listed
    ), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_notification_email_pilot_reviews_v1 review
  join public.complete_power_outage_notification_email_plans plan
    on plan.id = review.plan_id
  where plan.plan_status = 'shadow_ready'
    and plan.starts_at_snapshot > now();

  return coalesce(result, jsonb_build_object(
    'contract', 'complete-notification-email-pilot-review-v1',
    'reviewEnabled', true,
    'reviewUiEnabled', false,
    'sendingEnabled', false,
    'liveDispatchEnabled', false,
    'pendingCount', 0,
    'approvedCount', 0,
    'approvedAndEligibleNowCount', 0,
    'rejectedCount', 0,
    'staleApprovalCount', 0,
    'items', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.prevent_cpo_notification_email_pilot_review_mutation()
  from public, anon, authenticated;
revoke all on function public.cpo_notification_email_plan_fingerprint_v1(uuid)
  from public, anon, authenticated;
revoke all on function public.decide_cpo_notification_email_pilot_v1(uuid,text,text)
  from public, anon;
revoke all on function public.get_cpo_notification_email_pilot_review_v1(integer)
  from public, anon;

grant execute on function public.prevent_cpo_notification_email_pilot_review_mutation()
  to service_role;
grant execute on function public.cpo_notification_email_plan_fingerprint_v1(uuid)
  to service_role;
grant execute on function public.decide_cpo_notification_email_pilot_v1(uuid,text,text)
  to authenticated, service_role;
grant execute on function public.get_cpo_notification_email_pilot_review_v1(integer)
  to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
      'pilotReviewContract', 'complete-notification-email-pilot-review-v1',
      'pilotReviewEnabled', true,
      'pilotReviewUiEnabled', false,
      'pilotAllowlistEnabled', false,
      'liveDispatchEnabled', false,
      'pilotReviewInstalledAt', now()
    ),
    updated_at = now()
where singleton;

notify pgrst, 'reload schema';

commit;
