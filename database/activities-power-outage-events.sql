begin;

-- Propojeni vyznamnych uzivatelskych ukonu z Monitoringu odstavek
-- do spolecneho proudu automatickych zaznamu na strance Aktivita.
do $$
begin
  if to_regclass('public.activities') is null
     or to_regclass('public.complete_power_outage_companies') is null
     or to_regclass('public.complete_power_outage_communication_events') is null
     or to_regclass('public.complete_power_outage_company_ownership_events') is null
  then
    raise exception 'Chybi zavislosti pro automaticke zaznamy Monitoringu odstavek.';
  end if;
end
$$;

alter table public.activities
  drop constraint if exists activities_source_type_check;

alter table public.activities
  add constraint activities_source_type_check
  check (source_type is null or source_type in ('meeting', 'task', 'offer', 'power_outage'));

create or replace function public.activities_log_cpo_communication_event_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  company_name text;
  event_title text;
begin
  -- Systemove e-maily a importovane zaznamy nemaji byt pripisovany uzivateli.
  if new.actor_kind <> 'user'
     or new.actor_user_id is null
     or new.event_kind not in (
       'manual_contact', 'status_changed', 'job_won', 'job_reopened',
       'follow_up_created', 'follow_up_rescheduled',
       'follow_up_completed', 'follow_up_cancelled'
     )
  then
    return new;
  end if;

  select nullif(btrim(company.company_name), '')
  into company_name
  from public.complete_power_outage_companies company
  where company.id = new.candidate_id;

  if company_name is null then
    return new;
  end if;

  event_title := case
    when new.event_kind = 'job_won' then 'Z komunikace vznikla zakázka'
    when new.event_kind = 'job_reopened' then 'Zakázka byla znovu otevřena ke komunikaci'
    when new.event_kind = 'follow_up_created' then 'Vytvořena připomínka k odstávce'
    when new.event_kind = 'follow_up_rescheduled' then 'Přeplánována připomínka k odstávce'
    when new.event_kind = 'follow_up_completed' then 'Dokončena připomínka k odstávce'
    when new.event_kind = 'follow_up_cancelled' then 'Zrušena připomínka k odstávce'
    when new.new_status = 'contacted' then 'Zapsána komunikace k odstávce'
    when new.new_status = 'unreachable' then 'Firma nebyla zastižena'
    when new.new_status = 'interested' then 'Firma projevila zájem'
    when new.new_status = 'offer_sent' then 'Nabídka byla odeslána'
    when new.new_status = 'closed_no_job' then 'Komunikace uzavřena bez zakázky'
    else 'Aktualizován stav komunikace k odstávce'
  end;

  insert into public.activities (
    user_id,
    created_by,
    client_id,
    origin,
    activity_type,
    title,
    description,
    status,
    occurred_at,
    source_type,
    source_id,
    source_event_key,
    source_path,
    metadata
  ) values (
    new.actor_user_id,
    new.actor_user_id,
    null,
    'automatic',
    'power_outage_' || new.event_kind,
    event_title,
    null,
    'logged',
    new.occurred_at,
    'power_outage',
    new.candidate_id,
    'communication:' || new.id::text,
    '/power-outages?mode=complete',
    jsonb_build_object(
      'contract', 'activities-power-outage-events-v1',
      'completePowerOutageCandidateId', new.candidate_id,
      'completePowerOutageCompanyName', company_name,
      'completePowerOutageCommunicationEventId', new.id
    )
  )
  on conflict (user_id, source_type, source_id, source_event_key)
    where origin = 'automatic'
  do nothing;

  return new;
end;
$$;

revoke all on function public.activities_log_cpo_communication_event_v1()
  from public, anon, authenticated;
grant execute on function public.activities_log_cpo_communication_event_v1()
  to service_role;

drop trigger if exists activities_cpo_communication_event_log
  on public.complete_power_outage_communication_events;
create trigger activities_cpo_communication_event_log
after insert on public.complete_power_outage_communication_events
for each row execute function public.activities_log_cpo_communication_event_v1();

create or replace function public.activities_log_cpo_ownership_event_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_title text;
begin
  if new.changed_by is null then
    return new;
  end if;

  event_title := case new.event_kind
    when 'assigned' then 'Převzat záznam odstávky'
    when 'transferred' then 'Záznam odstávky předán uživateli ' || coalesce(new.owner_name, 'Uživatel')
    when 'released' then 'Uvolněn záznam odstávky'
  end;

  insert into public.activities (
    user_id,
    created_by,
    client_id,
    origin,
    activity_type,
    title,
    description,
    status,
    occurred_at,
    source_type,
    source_id,
    source_event_key,
    source_path,
    metadata
  ) values (
    new.changed_by,
    new.changed_by,
    null,
    'automatic',
    'power_outage_' || new.event_kind,
    event_title,
    null,
    'logged',
    new.occurred_at,
    'power_outage',
    new.candidate_id,
    'ownership:' || new.id::text,
    '/power-outages?mode=complete',
    jsonb_build_object(
      'contract', 'activities-power-outage-events-v1',
      'completePowerOutageCandidateId', new.candidate_id,
      'completePowerOutageCompanyName', new.company_name_snapshot,
      'completePowerOutageOwnershipEventId', new.id
    )
  )
  on conflict (user_id, source_type, source_id, source_event_key)
    where origin = 'automatic'
  do nothing;

  return new;
end;
$$;

revoke all on function public.activities_log_cpo_ownership_event_v1()
  from public, anon, authenticated;
grant execute on function public.activities_log_cpo_ownership_event_v1()
  to service_role;

drop trigger if exists activities_cpo_ownership_event_log
  on public.complete_power_outage_company_ownership_events;
create trigger activities_cpo_ownership_event_log
after insert on public.complete_power_outage_company_ownership_events
for each row execute function public.activities_log_cpo_ownership_event_v1();

commit;
