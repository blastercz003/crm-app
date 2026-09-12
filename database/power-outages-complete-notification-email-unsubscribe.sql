begin;

-- Verejne odhlaseni pro provozni upozorneni KOMPLETNI. Verejny endpoint zna
-- pouze nahodny UUID token; e-mail ani interni ID nikdy nevraci.
do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_plans') is null
     or to_regclass('public.complete_power_outage_notification_email_suppression_events') is null
  then
    raise exception 'Chybi zavislosti pro odhlaseni e-mailu KOMPLETNI.';
  end if;
end
$$;

create or replace function public.unsubscribe_cpo_notification_email_v1(
  requested_token uuid,
  requested_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  selected_plan public.complete_power_outage_notification_email_plans%rowtype;
  latest_action text;
  inserted_event_id uuid;
  affected_plan_count integer := 0;
begin
  if requested_evidence is null or jsonb_typeof(requested_evidence) <> 'object' then
    raise exception 'Doklad odhlaseni musi byt JSON objekt.';
  end if;

  select plan.* into selected_plan
  from public.complete_power_outage_notification_email_plans plan
  where plan.unsubscribe_token = requested_token;

  if selected_plan.id is null then
    return jsonb_build_object(
      'status', 'unavailable',
      'suppressed', false,
      'recipientExposed', false
    );
  end if;

  select suppression.action into latest_action
  from public.complete_power_outage_notification_email_suppression_events suppression
  where suppression.normalized_email = selected_plan.recipient_email
  order by suppression.created_at desc, suppression.id desc
  limit 1;

  if latest_action = 'suppress' then
    return jsonb_build_object(
      'status', 'already_unsubscribed',
      'suppressed', true,
      'recipientExposed', false
    );
  end if;

  insert into public.complete_power_outage_notification_email_suppression_events (
    normalized_email,
    action,
    source,
    reason,
    related_plan_id,
    actor_user_id,
    evidence
  ) values (
    selected_plan.recipient_email,
    'suppress',
    'unsubscribe',
    'Prijemce potvrdil odhlaseni provoznich upozorneni KOMPLETNI.',
    selected_plan.id,
    null,
    requested_evidence || jsonb_build_object(
      'contract', 'complete-notification-email-unsubscribe-v1',
      'confirmedAt', now(),
      'storesNetworkAddress', false,
      'storesUserAgent', false
    )
  )
  returning id into inserted_event_id;

  update public.complete_power_outage_notification_email_plans plan
  set plan_status = 'suppressed',
      metadata = plan.metadata || jsonb_build_object(
        'suppressedByUnsubscribe', true,
        'suppressionEventId', inserted_event_id,
        'suppressedAt', now()
      )
  where plan.recipient_email = selected_plan.recipient_email
    and plan.plan_status = 'shadow_ready';
  get diagnostics affected_plan_count = row_count;

  return jsonb_build_object(
    'status', 'unsubscribed',
    'suppressed', true,
    'affectedPlanCount', affected_plan_count,
    'recipientExposed', false
  );
end;
$$;

revoke all on function public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.unsubscribe_cpo_notification_email_v1(uuid,jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');
commit;
