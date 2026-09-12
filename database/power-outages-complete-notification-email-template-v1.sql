begin;

do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_test_deliveries') is null
     or to_regclass('public.complete_power_outage_notification_email_plans') is null
     or to_regclass('public.complete_power_outages') is null
  then
    raise exception 'Chybi zavislosti pro sablonu e-mailu KOMPLETNI.';
  end if;
end
$$;

-- Rozsireny TEST claim poskytuje rendereru pouze provozni snapshot odstávky.
-- Puvodni prijemce zustava vyhradne auditnim udajem TESTU a nikdy se nepouzije
-- jako cil zpravy. Ostry odhlasovaci odkaz se v TEST rezimu nevytvari.
create or replace function public.claim_cpo_notification_email_test_v2()
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  state_row public.complete_power_outage_notification_email_test_state%rowtype;
  selected_delivery public.complete_power_outage_notification_email_test_deliveries%rowtype;
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  selected_outage public.complete_power_outages%rowtype;
  new_lease_token uuid := gen_random_uuid();
begin
  select * into state_row
  from public.complete_power_outage_notification_email_test_state
  where singleton
  for update;

  if state_row.singleton is null or not state_row.test_enabled then
    return jsonb_build_object('status', 'disabled', 'delivery', null);
  end if;

  update public.complete_power_outage_notification_email_test_deliveries delivery
  set delivery_status = case
        when delivery.attempt_count < delivery.max_attempt_count then 'pending'
        else 'failed'
      end,
      lease_token = null,
      lease_expires_at = null,
      finished_at = case
        when delivery.attempt_count >= delivery.max_attempt_count then now()
        else delivery.finished_at
      end,
      last_error_code = 'COMPLETE_RESEND_TEST_LEASE_EXPIRED',
      last_error_message = 'Predchozi TEST worker nedokoncil polozku pred vyprsenim lease.'
  where delivery.delivery_status = 'processing'
    and delivery.lease_expires_at <= now();

  select delivery.* into selected_delivery
  from public.complete_power_outage_notification_email_test_deliveries delivery
  where delivery.delivery_status = 'pending'
    and delivery.attempt_count < delivery.max_attempt_count
  order by delivery.requested_at desc, delivery.id
  limit 1
  for update skip locked;

  if selected_delivery.id is null then
    update public.complete_power_outage_notification_email_test_state
    set test_enabled = false,
        last_error_at = now(),
        last_error_code = 'COMPLETE_RESEND_TEST_EMPTY',
        last_error_message = 'Nebyla pripravena zadna TEST zprava.'
    where singleton;
    return jsonb_build_object('status', 'empty', 'delivery', null);
  end if;

  select plan.* into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  where plan.id = selected_delivery.plan_id;

  if selected_plan.id is null then
    raise exception 'TEST delivery nema platny plan KOMPLETNI.';
  end if;

  select outage.* into selected_outage
  from public.complete_power_outages outage
  where outage.id = selected_plan.outage_id;

  if selected_outage.id is null then
    raise exception 'TEST plan nema platnou odstavku KOMPLETNI.';
  end if;

  update public.complete_power_outage_notification_email_test_deliveries
  set delivery_status = 'processing',
      attempt_count = attempt_count + 1,
      lease_token = new_lease_token,
      lease_expires_at = now() + interval '2 minutes',
      metadata = metadata || jsonb_build_object(
        'templateContract', 'complete-notification-email-template-v1',
        'unsubscribeLinkActive', false
      )
  where id = selected_delivery.id
  returning * into selected_delivery;

  return jsonb_build_object(
    'status', 'claimed',
    'leaseToken', new_lease_token,
    'delivery', jsonb_build_object(
      'id', selected_delivery.id,
      'subject', selected_delivery.subject_snapshot,
      'text', selected_delivery.text_snapshot,
      'companyName', selected_delivery.company_name_snapshot,
      'startsAt', selected_delivery.starts_at_snapshot,
      'endsAt', selected_delivery.ends_at_snapshot,
      'addresses', selected_delivery.address_snapshot,
      'source', selected_plan.source_snapshot,
      'municipality', selected_plan.municipality_snapshot,
      'announcementUrl', selected_outage.announcement_url,
      'sourceUrl', selected_outage.source_url,
      'originalRecipient', selected_delivery.original_recipient_email,
      'attemptCount', selected_delivery.attempt_count
    )
  );
end;
$$;

revoke all on function public.claim_cpo_notification_email_test_v2()
  from public, anon, authenticated;
grant execute on function public.claim_cpo_notification_email_test_v2()
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
