begin;

-- Finalni provozni read-only kontrakt panelu EMAILY. Nepridava zadnou
-- odesilaci cestu a po pilotu ponechava system v SHADOW rezimu.
create or replace function public.get_cpo_notification_email_operations_v1(
  requested_limit integer default 10
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
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role = 'admin'
  ) then
    raise exception 'Provozni prehled e-mailu je dostupny pouze administratorum.';
  end if;
  if requested_limit < 1 or requested_limit > 25 then
    raise exception 'Limit provozniho prehledu musi byt mezi 1 a 25.';
  end if;

  select jsonb_build_object(
    'runtimeMode', email_state.runtime_mode,
    'planningEnabled', email_state.planning_enabled,
    'dispatchEnabled', email_state.dispatch_enabled,
    'selectedSelectorKey', email_state.active_selector_key,
    'preparedCount', (
      select count(*)
      from public.complete_power_outage_notification_email_plans plan
      left join public.complete_power_outage_notification_email_suppressions_v1 suppression
        on suppression.normalized_email = plan.recipient_email
       and suppression.is_suppressed
      where plan.plan_status = 'shadow_ready'
        and plan.selector_key = email_state.active_selector_key
        and plan.starts_at_snapshot > now()
        and plan.expires_at > now()
        and suppression.normalized_email is null
        and not exists (
          select 1
          from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
          where outcome.plan_id = plan.id and outcome.outcome = 'sent'
        )
    ),
    'sentTodayCount', (
      select count(*)
      from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      where outcome.outcome = 'sent'
        and (outcome.created_at at time zone 'Europe/Prague')::date
          = (now() at time zone 'Europe/Prague')::date
    ),
    'deliveredTodayCount', (
      select count(distinct event.plan_id)
      from public.complete_power_outage_notification_email_pilot_safety_events event
      where event.signal_type = 'delivery_success'
        and (event.created_at at time zone 'Europe/Prague')::date
          = (now() at time zone 'Europe/Prague')::date
    ),
    'lastSentAt', (
      select max(outcome.created_at)
      from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      where outcome.outcome = 'sent'
    ),
    'lastDeliveredAt', (
      select max(event.created_at)
      from public.complete_power_outage_notification_email_pilot_safety_events event
      where event.signal_type = 'delivery_success'
    ),
    'suppressedRecipientCount', (
      select count(*) from public.complete_power_outage_notification_email_suppressions_v1 suppression
      where suppression.is_suppressed
    ),
    'preparedItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'planId', prepared.id,
        'companyName', prepared.company_name_snapshot,
        'recipientEmail', prepared.recipient_email,
        'source', prepared.source_snapshot,
        'startsAt', prepared.starts_at_snapshot,
        'endsAt', prepared.ends_at_snapshot,
        'municipality', prepared.municipality_snapshot,
        'addresses', prepared.address_snapshot,
        'notBeforeAt', prepared.not_before_at
      ) order by prepared.starts_at_snapshot, prepared.id)
      from (
        select plan.*
        from public.complete_power_outage_notification_email_plans plan
        left join public.complete_power_outage_notification_email_suppressions_v1 suppression
          on suppression.normalized_email = plan.recipient_email
         and suppression.is_suppressed
        where plan.plan_status = 'shadow_ready'
          and plan.selector_key = email_state.active_selector_key
          and plan.starts_at_snapshot > now()
          and plan.expires_at > now()
          and suppression.normalized_email is null
          and not exists (
            select 1
            from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
            where outcome.plan_id = plan.id and outcome.outcome = 'sent'
          )
        order by plan.starts_at_snapshot, plan.id
        limit requested_limit
      ) prepared
    ), '[]'::jsonb),
    'recentDeliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'companyName', recent.company_name_snapshot,
        'recipientEmail', recent.recipient_email,
        'sentAt', recent.sent_at,
        'deliveryStatus', recent.delivery_status,
        'deliveredAt', recent.delivered_at,
        'errorCode', recent.error_code
      ) order by recent.sent_at desc)
      from (
        select
          plan.company_name_snapshot,
          plan.recipient_email,
          outcome.created_at as sent_at,
          case
            when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.signal_type = 'complaint') then 'complaint'
            when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.signal_type = 'hard_bounce') then 'bounced'
            when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.signal_type = 'delivery_success') then 'delivered'
            when exists (select 1 from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.signal_type in ('transient_error', 'configuration_error')) then 'error'
            else 'sent'
          end as delivery_status,
          (select max(event.created_at) from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.signal_type = 'delivery_success') as delivered_at,
          (select event.error_code from public.complete_power_outage_notification_email_pilot_safety_events event where event.plan_id = plan.id and event.error_code is not null order by event.created_at desc limit 1) as error_code
        from public.complete_power_outage_notification_email_pilot_send_outcomes outcome
        join public.complete_power_outage_notification_email_plans plan on plan.id = outcome.plan_id
        where outcome.outcome = 'sent'
        order by outcome.created_at desc
        limit requested_limit
      ) recent
    ), '[]'::jsonb)
  ) into result
  from public.complete_power_outage_notification_email_state email_state
  where email_state.singleton;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.get_cpo_notification_email_operations_v1(integer)
  from public, anon;
grant execute on function public.get_cpo_notification_email_operations_v1(integer)
  to authenticated, service_role;

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

  return jsonb_build_object(
    'contract', 'complete-notification-email-operations-ui-v1',
    'adminOnly', true,
    'liveActivationAvailable', false,
    'operations', public.get_cpo_notification_email_operations_v1(10),
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
  'emailOperationsUiContract', 'complete-notification-email-operations-ui-v1',
  'liveActivationAvailable', false,
  'emailOperationsUiInstalledAt', now()
), updated_at = now()
where singleton;

notify pgrst, 'reload schema';
commit;

select check_type, object_name, is_correct
from (values
  ('FUNCTION'::text, 'admin COMPLETE email operations summary exists'::text,
    to_regprocedure('public.get_cpo_notification_email_operations_v1(integer)') is not null),
  ('GRANT', 'email operations summary enforces administrator role',
    pg_get_functiondef('public.get_cpo_notification_email_operations_v1(integer)'::regprocedure) ilike '%profile.role = ''admin''%'),
  ('LOGIC', 'operations distinguish prepared sent and delivered emails',
    pg_get_functiondef('public.get_cpo_notification_email_operations_v1(integer)'::regprocedure) ilike '%preparedCount%sentTodayCount%deliveredTodayCount%'),
  ('SAFETY', 'operations UI cannot activate or send email',
    pg_get_functiondef('public.get_cpo_notification_email_operations_v1(integer)'::regprocedure) not ilike '%net.http%'
    and pg_get_functiondef('public.get_cpo_notification_email_operations_v1(integer)'::regprocedure) not ilike '%resend%'),
  ('SAFETY', 'final operations UI leaves COMPLETE dispatch disabled',
    (select runtime_mode = 'shadow'
      and not dispatch_enabled
     from public.complete_power_outage_notification_email_state where singleton)
    and (select not live_dispatch_enabled
      from public.complete_power_outage_notification_email_pilot_allowlist_state where singleton)
    and (select not reservation_enabled
      from public.complete_power_outage_notification_email_pilot_rate_limit_state where singleton)),
  ('STATE', 'final email operations UI keeps LIVE activation unavailable',
    (select metadata ->> 'emailOperationsUiContract' = 'complete-notification-email-operations-ui-v1'
      and not coalesce((metadata ->> 'liveActivationAvailable')::boolean, false)
     from public.complete_power_outage_notification_email_state where singleton))
) audit(check_type, object_name, is_correct)
order by check_type, object_name;
