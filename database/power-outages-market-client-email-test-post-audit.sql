-- Čistě čtecí audit po ukončení prvního bezpečného TESTU.
-- Nespouští plánovač, worker ani žádné odeslání.

select 'DATA' as check_type,
  'successful TEST delivery is recorded' as object_name,
  exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'test'
      and delivery_status in ('sent', 'delivered')
      and provider = 'resend'
      and provider_message_id is not null
      and sent_at is not null
  ) as is_correct
union all
select 'DATA', 'TEST email contains safety banner and original recipients',
  exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'test'
      and html_snapshot like '%TESTOVACÍ REŽIM%'
      and text_snapshot like '%Původní příjemci:%'
      and jsonb_array_length(recipient_snapshot) > 0
  )
union all
select 'WEBHOOK', 'delivered Resend event is linked and processed',
  exists (
    select 1
    from public.power_outage_client_email_provider_events as event
    join public.power_outage_client_email_deliveries as delivery
      on delivery.id = event.delivery_id
    where delivery.mode_at_plan = 'test'
      and event.provider = 'resend'
      and event.event_kind = 'email.delivered'
      and event.processed_at is not null
      and event.processing_error is null
  )
union all
select 'SAFETY', 'dispatch is disabled after TEST',
  exists (
    select 1
    from public.power_outage_client_email_state
    where singleton
      and runtime_mode in ('disabled', 'shadow')
      and dispatch_enabled = false
      and worker_token is null
  )
union all
select 'SAFETY', 'no client remains in TEST or ACTIVE',
  not exists (
    select 1
    from public.power_outage_client_email_settings
    where mode in ('test', 'live')
  )
union all
select 'SAFETY', 'no unsent TEST delivery remains claimable',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'test'
      and delivery_status in ('planned', 'queued', 'sending', 'failed')
  )
union all
select 'SAFETY', 'no ACTIVE delivery exists',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'live'
  )
union all
select 'SAFETY', 'TEST delivery has no recorded send error',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'test'
      and last_error_code is not null
      and delivery_status <> 'cancelled'
  )
union all
select 'IDEMPOTENCY', 'delivery dedupe key is unique',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.power_outage_client_email_deliveries'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (dedupe_key)'
  )
union all
select 'IDEMPOTENCY', 'Resend webhook event id is unique',
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.power_outage_client_email_provider_events'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (provider, provider_event_id)'
  )
union all
select 'ISOLATION', 'post TEST audit does not reference COMPLETE outage tables',
  true
order by check_type, object_name;
