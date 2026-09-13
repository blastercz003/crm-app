begin;

do $$
begin
  if to_regclass('public.complete_power_outage_notification_email_plans') is null
     or to_regclass('public.complete_power_outage_notification_email_pilot_send_outcomes') is null
     or to_regclass('public.complete_power_outage_notification_email_pilot_safety_events') is null
     or to_regclass('public.cpo_notification_email_production_outcomes') is null
     or to_regclass('public.cpo_notification_email_production_safety_events') is null
     or to_regprocedure('public.get_complete_power_outage_company_page_v8(text,integer,timestamptz,uuid,integer,boolean,boolean,text,text,text,text,text,text,text)') is null
  then
    raise exception 'Chybi zavislosti pro minibadge odeslaneho upozorneni.';
  end if;
end
$$;

create index if not exists cpo_notification_email_plans_outage_company_idx
  on public.complete_power_outage_notification_email_plans(outage_id, ico)
  where outage_id is not null;

create or replace function public.get_complete_power_outage_notification_email_badge_v1(
  requested_candidate_id uuid
)
returns table (
  notification_email_status text,
  notification_email_sent_at timestamptz,
  notification_email_delivered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidate_scope as (
    select company.ico, address.outage_id
    from public.complete_power_outage_companies company
    join public.complete_power_outage_addresses address
      on address.id = company.outage_address_id
    where company.id = requested_candidate_id
      and company.ico is not null
  ), actual_sends as (
    select
      plan.id as plan_id,
      outcome.created_at as sent_at,
      'production'::text as send_channel
    from candidate_scope scope_row
    join public.complete_power_outage_notification_email_plans plan
      on plan.ico = scope_row.ico
     and plan.outage_id = scope_row.outage_id
    join public.cpo_notification_email_production_outcomes outcome
      on outcome.plan_id = plan.id
     and outcome.outcome = 'sent'

    union all

    select
      plan.id as plan_id,
      outcome.created_at as sent_at,
      'pilot'::text as send_channel
    from candidate_scope scope_row
    join public.complete_power_outage_notification_email_plans plan
      on plan.ico = scope_row.ico
     and plan.outage_id = scope_row.outage_id
    join public.complete_power_outage_notification_email_pilot_send_outcomes outcome
      on outcome.plan_id = plan.id
     and outcome.outcome = 'sent'
  ), sends_with_delivery as (
    select
      actual_send.plan_id,
      actual_send.sent_at,
      delivery.delivered_at
    from actual_sends actual_send
    left join lateral (
      select max(delivery_event.created_at) as delivered_at
      from (
        select event.created_at
        from public.cpo_notification_email_production_safety_events event
        where actual_send.send_channel = 'production'
          and event.plan_id = actual_send.plan_id
          and event.signal_type = 'delivery_success'

        union all

        select event.created_at
        from public.complete_power_outage_notification_email_pilot_safety_events event
        where actual_send.send_channel = 'pilot'
          and event.plan_id = actual_send.plan_id
          and event.signal_type = 'delivery_success'
      ) delivery_event
    ) delivery on true
  )
  select
    case
      when count(*) = 0 then null
      when max(delivered_at) is not null then 'delivered'
      else 'sent'
    end as notification_email_status,
    max(sent_at) as notification_email_sent_at,
    max(delivered_at) as notification_email_delivered_at
  from sends_with_delivery;
$$;

revoke all on function public.get_complete_power_outage_notification_email_badge_v1(uuid)
  from public, anon, authenticated;

create or replace function public.get_complete_power_outage_company_page_v9(
  p_mode text default 'current',
  p_limit integer default 60,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_cursor_score integer default null,
  p_cursor_client_priority boolean default null,
  p_clients_only boolean default false,
  p_query text default '',
  p_owner_filter text default 'all',
  p_source text default 'all',
  p_entity_kind text default 'all',
  p_candidate_status text default 'visible',
  p_commercial_filter text default 'all',
  p_sort text default 'date'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  enriched_items jsonb;
begin
  result := public.get_complete_power_outage_company_page_v8(
    p_mode,
    p_limit,
    p_cursor_at,
    p_cursor_id,
    p_cursor_score,
    p_cursor_client_priority,
    p_clients_only,
    p_query,
    p_owner_filter,
    p_source,
    p_entity_kind,
    p_candidate_status,
    p_commercial_filter,
    p_sort
  );

  select coalesce(
    jsonb_agg(
      item.value || jsonb_build_object(
        'notification_email_status', notification.notification_email_status,
        'notification_email_sent_at', notification.notification_email_sent_at,
        'notification_email_delivered_at', notification.notification_email_delivered_at
      )
      order by item.ordinality
    ),
    '[]'::jsonb
  )
  into enriched_items
  from jsonb_array_elements(coalesce(result -> 'items', '[]'::jsonb))
    with ordinality as item(value, ordinality)
  left join lateral public.get_complete_power_outage_notification_email_badge_v1(
    (item.value ->> 'candidate_id')::uuid
  ) notification on true;

  return jsonb_set(result, '{items}', enriched_items, true);
end;
$$;

revoke all on function public.get_complete_power_outage_company_page_v9(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) from public, anon;

grant execute on function public.get_complete_power_outage_company_page_v9(
  text,integer,timestamptz,uuid,integer,boolean,boolean,
  text,text,text,text,text,text,text
) to authenticated;

notify pgrst, 'reload schema';

commit;
