begin;

-- PostgreSQL omezuje identifikatory na 63 znaku. Puvodni dlouhy nazev RPC byl
-- v databazi zkracen, ale PostgREST obdrzel nezkraceny nazev a nenasel jej.
drop function if exists public.record_complete_power_outage_notification_email_test_resend_event_v1(text,text,text,jsonb);

create or replace function public.record_cpo_notification_email_test_event_v1(
  requested_provider_event_id text,
  requested_provider_message_id text,
  requested_event_kind text,
  requested_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '5s'
as $$
declare
  selected_delivery_id uuid;
  inserted_count integer;
begin
  select delivery.id into selected_delivery_id
  from public.complete_power_outage_notification_email_test_deliveries delivery
  where delivery.provider_message_id = requested_provider_message_id;

  if selected_delivery_id is null then
    return jsonb_build_object('ignored', true, 'duplicate', false);
  end if;

  insert into public.complete_power_outage_notification_email_test_events (
    delivery_id, provider_event_id, provider_message_id, event_kind, payload
  ) values (
    selected_delivery_id, requested_provider_event_id,
    requested_provider_message_id, requested_event_kind, requested_payload
  ) on conflict (provider_event_id) do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    return jsonb_build_object('ignored', false, 'duplicate', true);
  end if;

  update public.complete_power_outage_notification_email_test_deliveries delivery
  set delivery_status = case requested_event_kind
        when 'email.delivered' then 'delivered'
        when 'email.delivery_delayed' then 'delivery_delayed'
        when 'email.bounced' then 'bounced'
        when 'email.complained' then 'complained'
        when 'email.failed' then 'failed'
        when 'email.suppressed' then 'suppressed'
        else delivery.delivery_status
      end,
      delivered_at = case
        when requested_event_kind = 'email.delivered' then now()
        else delivery.delivered_at
      end,
      last_error_code = case
        when requested_event_kind in (
          'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'
        ) then upper(replace(requested_event_kind, '.', '_'))
        else delivery.last_error_code
      end,
      last_error_message = case
        when requested_event_kind in (
          'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'
        ) then 'Resend oznamil neuspesny TEST stav.'
        else delivery.last_error_message
      end
  where delivery.id = selected_delivery_id;

  if requested_event_kind = 'email.delivered' then
    update public.complete_power_outage_notification_email_test_state
    set last_delivered_at = now()
    where singleton;
  end if;

  return jsonb_build_object(
    'ignored', false,
    'duplicate', false,
    'deliveryId', selected_delivery_id
  );
end;
$$;

revoke all on function public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.record_cpo_notification_email_test_event_v1(text,text,text,jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');
commit;

select
  function_row.oid::regprocedure::text as function_signature,
  function_row.proargnames as argument_names,
  length(function_row.proname) as function_name_length,
  has_function_privilege('service_role', function_row.oid, 'EXECUTE')
    as service_role_can_execute
from pg_proc function_row
join pg_namespace namespace_row on namespace_row.oid = function_row.pronamespace
where namespace_row.nspname = 'public'
  and function_row.proname = 'record_cpo_notification_email_test_event_v1';
