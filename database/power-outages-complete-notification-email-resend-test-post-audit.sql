with latest_delivery as (
  select delivery.*
  from public.complete_power_outage_notification_email_test_deliveries delivery
  order by delivery.requested_at desc, delivery.id desc
  limit 1
),
checks(check_type, object_name, is_correct) as (
  values
  ('DATA', 'latest COMPLETE TEST was accepted by Resend',
    exists (
      select 1 from latest_delivery
      where provider_message_id is not null
        and sent_at is not null
        and delivery_status in ('sent', 'delivered', 'delivery_delayed')
    )),
  ('DATA', 'latest COMPLETE TEST reached the internal recipient',
    exists (
      select 1 from latest_delivery
      where delivery_status = 'delivered' and delivered_at is not null
    )),
  ('DATA', 'latest COMPLETE TEST has a signed webhook event',
    exists (
      select 1
      from latest_delivery delivery
      join public.complete_power_outage_notification_email_test_events event
        on event.delivery_id = delivery.id
      where event.provider_message_id = delivery.provider_message_id
    )),
  ('LOGIC', 'latest COMPLETE TEST preserved the original audit recipient',
    exists (
      select 1 from latest_delivery
      where original_recipient_email is not null
    )),
  ('SAFETY', 'latest COMPLETE TEST used a different internal recipient',
    exists (
      select 1 from latest_delivery
      where test_recipient_email is not null
        and test_recipient_email <> original_recipient_email
    )),
  ('SAFETY', 'COMPLETE TEST automatically disabled after one attempt',
    (select not test_enabled
     from public.complete_power_outage_notification_email_test_state
     where singleton)),
  ('SAFETY', 'COMPLETE planning remains SHADOW and cannot dispatch',
    (select runtime_mode = 'shadow' and planning_enabled and not dispatch_enabled
     from public.complete_power_outage_notification_email_state
     where singleton)),
  ('SAFETY', 'COMPLETE TEST still has no automatic dispatch schedule',
    not exists (
      select 1 from cron.job
      where jobname ilike '%complete%notification%email%send%'
         or jobname ilike '%complete%notification%email%dispatch%'
    )),
  ('SAFETY', 'COMPLETE TEST webhook did not suppress a company recipient',
    not exists (
      select 1
      from latest_delivery delivery
      join public.complete_power_outage_notification_email_suppression_events suppression
        on suppression.normalized_email = delivery.original_recipient_email
      where suppression.created_at >= delivery.requested_at
    )),
  ('ISOLATION', 'latest delivery belongs only to COMPLETE TEST tables',
    exists (
      select 1 from latest_delivery
      where provider = 'resend'
        and metadata ->> 'contract' = 'complete-notification-email-resend-test-delivery-v1'
        and coalesce((metadata ->> 'marketEmailIsolation')::boolean, false)
    ))
)
select check_type, object_name, is_correct
from checks
order by check_type, object_name;

select
  delivery.id as delivery_id,
  delivery.delivery_status,
  delivery.company_name_snapshot,
  delivery.attempt_count,
  delivery.provider_message_id is not null as has_provider_message_id,
  delivery.original_recipient_email <> delivery.test_recipient_email
    as redirected_to_internal_test_recipient,
  delivery.requested_at,
  delivery.sent_at,
  delivery.delivered_at,
  delivery.last_error_code,
  delivery.last_error_message
from public.complete_power_outage_notification_email_test_deliveries delivery
order by delivery.requested_at desc, delivery.id desc
limit 1;

select event.event_kind, event.created_at
from public.complete_power_outage_notification_email_test_events event
where event.delivery_id = (
  select delivery.id
  from public.complete_power_outage_notification_email_test_deliveries delivery
  order by delivery.requested_at desc, delivery.id desc
  limit 1
)
order by event.created_at, event.provider_event_id;
