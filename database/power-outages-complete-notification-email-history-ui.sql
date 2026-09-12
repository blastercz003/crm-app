begin;

-- Strankovana, pouze pro administratory dostupna historie odesilani KOMPLETNI.
-- Funkce je read-only a nema zadnou vazbu na odesilaci cestu panelu MARKETY.
create or replace function public.get_cpo_notification_email_delivery_history_v1(
  requested_limit integer default 20,
  requested_offset integer default 0,
  requested_status text default 'all',
  requested_search text default null,
  requested_date_from date default null,
  requested_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare
  result jsonb;
  normalized_search text := nullif(btrim(requested_search), '');
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'admin'
  ) then
    raise exception 'Historie odesilani je dostupna pouze administratorum.';
  end if;

  if requested_limit < 1 or requested_limit > 50 then
    raise exception 'Velikost stranky historie musi byt mezi 1 a 50.';
  end if;
  if requested_offset < 0 or requested_offset > 1000000 then
    raise exception 'Neplatny posun historie.';
  end if;
  if requested_status not in ('all', 'sent', 'delivered', 'bounced', 'complaint', 'error') then
    raise exception 'Neplatny filtr stavu historie.';
  end if;
  if requested_date_from is not null and requested_date_to is not null
    and requested_date_from > requested_date_to then
    raise exception 'Pocatecni datum historie nesmi byt po koncovem datu.';
  end if;

  with safety_by_plan as materialized (
    select
      event.plan_id,
      bool_or(event.signal_type = 'complaint') as has_complaint,
      bool_or(event.signal_type = 'hard_bounce') as has_hard_bounce,
      bool_or(event.signal_type = 'delivery_success') as has_delivery,
      bool_or(event.signal_type in ('transient_error', 'configuration_error')) as has_error,
      max(event.created_at) filter (where event.signal_type = 'delivery_success') as delivered_at,
      (array_agg(event.error_code order by event.created_at desc)
        filter (where event.error_code is not null))[1] as error_code
    from public.complete_power_outage_notification_email_pilot_safety_events event
    group by event.plan_id
  ), delivery_rows as materialized (
    select
      plan.company_name_snapshot,
      plan.recipient_email,
      plan.source_snapshot,
      plan.starts_at_snapshot,
      plan.ends_at_snapshot,
      plan.municipality_snapshot,
      outcome.created_at as sent_at,
      case
        when coalesce(safety.has_complaint, false) then 'complaint'
        when coalesce(safety.has_hard_bounce, false) then 'bounced'
        when coalesce(safety.has_delivery, false) then 'delivered'
        when coalesce(safety.has_error, false) then 'error'
        else 'sent'
      end as delivery_status,
      safety.delivered_at,
      safety.error_code
    from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
    join public.complete_power_outage_notification_email_plans plan
      on plan.id = outcome.plan_id
    left join safety_by_plan safety
      on safety.plan_id = plan.id
    where outcome.outcome = 'sent'
  ), filtered as materialized (
    select delivery.*
    from delivery_rows delivery
    where (requested_status = 'all' or delivery.delivery_status = requested_status)
      and (requested_date_from is null or
        (delivery.sent_at at time zone 'Europe/Prague')::date >= requested_date_from)
      and (requested_date_to is null or
        (delivery.sent_at at time zone 'Europe/Prague')::date <= requested_date_to)
      and (normalized_search is null
        or delivery.company_name_snapshot ilike '%' || normalized_search || '%'
        or delivery.recipient_email ilike '%' || normalized_search || '%')
  ), page as (
    select filtered.*
    from filtered
    order by filtered.sent_at desc, filtered.company_name_snapshot
    limit requested_limit
    offset requested_offset
  )
  select jsonb_build_object(
    'totalCount', (select count(*) from filtered),
    'offset', requested_offset,
    'pageSize', requested_limit,
    'hasMore', requested_offset + (select count(*) from page) < (select count(*) from filtered),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'companyName', page.company_name_snapshot,
        'recipientEmail', page.recipient_email,
        'source', page.source_snapshot,
        'startsAt', page.starts_at_snapshot,
        'endsAt', page.ends_at_snapshot,
        'municipality', page.municipality_snapshot,
        'sentAt', page.sent_at,
        'deliveryStatus', page.delivery_status,
        'deliveredAt', page.delivered_at,
        'errorCode', page.error_code
      ) order by page.sent_at desc, page.company_name_snapshot)
      from page
    ), '[]'::jsonb)
  ) into result;

  return coalesce(result, jsonb_build_object(
    'totalCount', 0,
    'offset', requested_offset,
    'pageSize', requested_limit,
    'hasMore', false,
    'items', '[]'::jsonb
  ));
end;
$$;

revoke all on function public.get_cpo_notification_email_delivery_history_v1(integer, integer, text, text, date, date)
  from public, anon;
grant execute on function public.get_cpo_notification_email_delivery_history_v1(integer, integer, text, text, date, date)
  to authenticated, service_role;

-- Hlavni popup dostane pouze pet poslednich polozek. Celkovy pocet je levny
-- samostatny udaj pro tlacitko vedouci do strankovane historie.
create or replace function public.get_cpo_notification_email_management_v1(
  requested_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '20s'
as $$
declare
  operations jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Panel EMAILY je dostupny pouze administratorum.';
  end if;
  if requested_limit < 1 or requested_limit > 100 then
    raise exception 'Limit prehledu musi byt mezi 1 a 100.';
  end if;

  operations := public.get_cpo_notification_email_operations_v1(5)
    || jsonb_build_object(
      'sentTotalCount', (
        select count(*)
        from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
        where outcome.outcome = 'sent'
      )
    );

  return jsonb_build_object(
    'contract', 'complete-notification-email-operations-ui-v2',
    'adminOnly', true,
    'liveActivationAvailable', false,
    'operations', operations,
    'review', public.get_cpo_notification_email_pilot_review_v1(requested_limit),
    'allowlist', public.get_cpo_notification_email_pilot_allowlist_v1(requested_limit),
    'rateLimit', public.get_cpo_notification_email_pilot_rate_summary_v1(),
    'safety', public.get_cpo_notification_email_pilot_safety_summary_v1()
  );
end;
$$;

revoke all on function public.get_cpo_notification_email_management_v1(integer)
  from public, anon;
grant execute on function public.get_cpo_notification_email_management_v1(integer)
  to authenticated, service_role;

update public.complete_power_outage_notification_email_state
set metadata = metadata || jsonb_build_object(
  'emailOperationsUiContract', 'complete-notification-email-operations-ui-v2',
  'deliveryHistoryPageSize', 20,
  'emailDeliveryHistoryInstalledAt', now()
), updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (values
  ('FUNCTION'::text, 'admin paginated COMPLETE email history exists'::text,
    to_regprocedure('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)') is not null),
  ('GRANT', 'email history enforces administrator role',
    pg_get_functiondef('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)'::regprocedure)
      ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'email history is paginated at database level',
    pg_get_functiondef('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)'::regprocedure)
      ilike '%limit requested_limit%offset requested_offset%'),
  ('LOGIC', 'main email workspace returns only five recent deliveries',
    pg_get_functiondef('public.get_cpo_notification_email_management_v1(integer)'::regprocedure)
      ilike '%get_cpo_notification_email_operations_v1(5)%'),
  ('ISOLATION', 'email history stays in COMPLETE scope',
    pg_get_functiondef('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)'::regprocedure)
      not ilike '%power_outage_client_email%'),
  ('SAFETY', 'email history cannot send or activate email',
    pg_get_functiondef('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)'::regprocedure)
      not ilike '%net.http%'
    and pg_get_functiondef('public.get_cpo_notification_email_delivery_history_v1(integer,integer,text,text,date,date)'::regprocedure)
      not ilike '%dispatch_enabled%'),
  ('STATE', 'email history UI contract version two is recorded',
    (select metadata ->> 'emailOperationsUiContract' = 'complete-notification-email-operations-ui-v2'
     from public.complete_power_outage_notification_email_state where singleton))
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
