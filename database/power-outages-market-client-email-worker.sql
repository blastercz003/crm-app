begin;

do $$
begin
  if to_regclass('public.power_outage_client_email_deliveries') is null then
    raise exception 'Nejdříve musí být nasazen databázový základ klientských e-mailů.';
  end if;
  if to_regprocedure('public.request_power_outages_endpoint(text)') is null then
    raise exception 'Chybí společná funkce pro bezpečné volání automatizačních endpointů.';
  end if;
end
$$;

alter table public.power_outage_client_email_state
  add column if not exists worker_token uuid,
  add column if not exists worker_expires_at timestamptz,
  add column if not exists last_dispatch_started_at timestamptz,
  add column if not exists last_dispatch_completed_at timestamptz;

create index if not exists power_outage_client_email_deliveries_retry_idx
  on public.power_outage_client_email_deliveries (next_attempt_at, created_at)
  where delivery_status in ('planned', 'queued', 'failed');

create or replace function public.claim_power_outage_client_email_delivery_batch(
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_record record;
  batch_token uuid := gen_random_uuid();
  claimed_deliveries jsonb := '[]'::jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'E-mailovou frontu může převzít pouze serverový worker.';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'Velikost odesílací dávky musí být mezi 1 a 50.';
  end if;

  select *
  into runtime_record
  from public.power_outage_client_email_state
  where singleton
  for update;

  if runtime_record.runtime_mode not in ('test', 'live')
    or not runtime_record.dispatch_enabled
  then
    return jsonb_build_object(
      'ok', true,
      'status', 'disabled',
      'claimedCount', 0,
      'deliveries', '[]'::jsonb
    );
  end if;

  if runtime_record.worker_token is not null
    and runtime_record.worker_expires_at > now()
  then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_running',
      'claimedCount', 0,
      'deliveries', '[]'::jsonb
    );
  end if;

  -- Obnova položek po přerušeném workeru. Stínové zprávy se sem nikdy nedostanou.
  update public.power_outage_client_email_deliveries
  set delivery_status = 'failed',
      next_attempt_at = now(),
      processing_token = null,
      processing_expires_at = null,
      last_error_code = 'CLIENT_EMAIL_WORKER_LEASE_EXPIRED',
      last_error_message = 'Předchozí odesílací worker nedokončil položku v časovém limitu.',
      updated_at = now()
  where delivery_status = 'sending'
    and mode_at_plan = runtime_record.runtime_mode
    and processing_expires_at <= now();

  update public.power_outage_client_email_state
  set worker_token = batch_token,
      worker_expires_at = now() + interval '2 minutes',
      last_dispatch_started_at = now(),
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where singleton;

  with claimable as (
    select delivery.id
    from public.power_outage_client_email_deliveries as delivery
    join public.power_outage_client_email_settings as settings
      on settings.client_id = delivery.client_id
     and settings.mode = delivery.mode_at_plan
    where delivery.mode_at_plan = runtime_record.runtime_mode
      and delivery.delivery_status in ('planned', 'queued', 'failed')
      and delivery.attempt_count < delivery.max_attempt_count
      and (delivery.next_attempt_at is null or delivery.next_attempt_at <= now())
      and nullif(trim(coalesce(delivery.subject_snapshot, '')), '') is not null
      and nullif(trim(coalesce(delivery.html_snapshot, '')), '') is not null
      and jsonb_array_length(delivery.recipient_snapshot) > 0
      and jsonb_array_length(delivery.store_snapshot) > 0
    order by delivery.created_at, delivery.id
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.power_outage_client_email_deliveries as delivery
    set delivery_status = 'sending',
        attempt_count = delivery.attempt_count + 1,
        processing_token = batch_token,
        processing_expires_at = now() + interval '2 minutes',
        next_attempt_at = null,
        provider = 'resend',
        updated_at = now()
    from claimable
    where delivery.id = claimable.id
    returning delivery.*
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', claimed.id,
      'mode', claimed.mode_at_plan,
      'eventKind', claimed.event_kind,
      'dedupeKey', claimed.dedupe_key,
      'subject', claimed.subject_snapshot,
      'html', claimed.html_snapshot,
      'text', claimed.text_snapshot,
      'recipients', claimed.recipient_snapshot,
      'fromName', claimed.metadata ->> 'fromName',
      'fromEmail', claimed.metadata ->> 'fromEmail',
      'replyToEmail', claimed.metadata ->> 'replyToEmail',
      'attemptCount', claimed.attempt_count,
      'maxAttemptCount', claimed.max_attempt_count
    ) order by claimed.created_at, claimed.id
  ), '[]'::jsonb)
  into claimed_deliveries
  from claimed;

  if jsonb_array_length(claimed_deliveries) = 0 then
    update public.power_outage_client_email_state
    set worker_token = null,
        worker_expires_at = null,
        last_dispatch_completed_at = now(),
        updated_at = now()
    where singleton and worker_token = batch_token;

    return jsonb_build_object(
      'ok', true,
      'status', 'empty',
      'claimedCount', 0,
      'deliveries', '[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', runtime_record.runtime_mode,
    'batchToken', batch_token,
    'claimedCount', jsonb_array_length(claimed_deliveries),
    'deliveries', claimed_deliveries
  );
end;
$$;

create or replace function public.finish_power_outage_client_email_delivery_sent(
  p_delivery_id uuid,
  p_batch_token uuid,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Výsledek odeslání může uložit pouze serverový worker.';
  end if;
  if nullif(trim(coalesce(p_provider_message_id, '')), '') is null then
    raise exception 'Chybí identifikátor zprávy poskytovatele.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'sent',
      provider = 'resend',
      provider_message_id = trim(p_provider_message_id),
      sent_at = coalesce(sent_at, now()),
      processing_token = null,
      processing_expires_at = null,
      next_attempt_at = null,
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where id = p_delivery_id
    and delivery_status = 'sending'
    and processing_token = p_batch_token
    and mode_at_plan in ('test', 'live');

  if not found then
    raise exception 'Odesílací zámek zprávy již není platný.';
  end if;

  -- Webhook může dorazit dříve než odpověď send API. Dodatečně jej proto spojíme.
  update public.power_outage_client_email_provider_events
  set delivery_id = p_delivery_id
  where delivery_id is null
    and provider = 'resend'
    and provider_message_id = trim(p_provider_message_id);

  if exists (
    select 1 from public.power_outage_client_email_provider_events
    where delivery_id = p_delivery_id and event_kind = 'email.complained'
  ) then
    update public.power_outage_client_email_deliveries
    set delivery_status = 'complained', complained_at = coalesce(complained_at, now()), updated_at = now()
    where id = p_delivery_id;
  elsif exists (
    select 1 from public.power_outage_client_email_provider_events
    where delivery_id = p_delivery_id and event_kind = 'email.bounced'
  ) then
    update public.power_outage_client_email_deliveries
    set delivery_status = 'bounced', bounced_at = coalesce(bounced_at, now()), updated_at = now()
    where id = p_delivery_id;
  elsif exists (
    select 1 from public.power_outage_client_email_provider_events
    where delivery_id = p_delivery_id and event_kind = 'email.delivered'
  ) then
    update public.power_outage_client_email_deliveries
    set delivery_status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
    where id = p_delivery_id;
  end if;
end;
$$;

create or replace function public.finish_power_outage_client_email_delivery_failed(
  p_delivery_id uuid,
  p_batch_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_attempt integer;
  maximum_attempt integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Výsledek odeslání může uložit pouze serverový worker.';
  end if;

  select attempt_count, max_attempt_count
  into current_attempt, maximum_attempt
  from public.power_outage_client_email_deliveries
  where id = p_delivery_id
    and delivery_status = 'sending'
    and processing_token = p_batch_token
  for update;

  if current_attempt is null then
    raise exception 'Odesílací zámek zprávy již není platný.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'failed',
      next_attempt_at = case
        when p_retryable and current_attempt < maximum_attempt
          then now() + make_interval(mins => least(60, (2 ^ least(current_attempt, 5))::integer))
        else null
      end,
      processing_token = null,
      processing_expires_at = null,
      last_error_code = left(coalesce(nullif(trim(p_error_code), ''), 'RESEND_SEND_FAILED'), 160),
      last_error_message = left(coalesce(nullif(trim(p_error_message), ''), 'Resend odmítl odeslání zprávy.'), 2000),
      updated_at = now()
  where id = p_delivery_id;
end;
$$;

create or replace function public.finish_power_outage_client_email_delivery_batch(
  p_batch_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Odesílací dávku může dokončit pouze serverový worker.';
  end if;

  update public.power_outage_client_email_state
  set worker_token = null,
      worker_expires_at = null,
      last_dispatched_at = now(),
      last_dispatch_completed_at = now(),
      updated_at = now()
  where singleton and worker_token = p_batch_token;
end;
$$;

create or replace function public.record_power_outage_client_email_resend_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_kind text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_delivery_id uuid;
  inserted_event_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Webhookovou událost může uložit pouze serverový endpoint.';
  end if;
  if nullif(trim(coalesce(p_provider_event_id, '')), '') is null
    or nullif(trim(coalesce(p_provider_message_id, '')), '') is null
  then
    raise exception 'Webhooková událost nemá povinné identifikátory.';
  end if;
  if p_event_kind not in (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'
  ) then
    raise exception 'Tento typ webhookové události není podporován.';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Webhookový payload musí být objekt.';
  end if;

  select delivery.id
  into target_delivery_id
  from public.power_outage_client_email_deliveries as delivery
  where delivery.provider = 'resend'
    and delivery.provider_message_id = trim(p_provider_message_id)
  limit 1;

  insert into public.power_outage_client_email_provider_events (
    delivery_id,
    provider,
    provider_event_id,
    provider_message_id,
    event_kind,
    payload,
    processed_at
  )
  values (
    target_delivery_id,
    'resend',
    trim(p_provider_event_id),
    trim(p_provider_message_id),
    p_event_kind,
    p_payload,
    now()
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  if target_delivery_id is not null then
    if p_event_kind = 'email.complained' then
      update public.power_outage_client_email_deliveries
      set delivery_status = 'complained', complained_at = coalesce(complained_at, now()), updated_at = now()
      where id = target_delivery_id;
    elsif p_event_kind = 'email.bounced' then
      update public.power_outage_client_email_deliveries
      set delivery_status = 'bounced', bounced_at = coalesce(bounced_at, now()), updated_at = now()
      where id = target_delivery_id and delivery_status <> 'complained';
    elsif p_event_kind = 'email.delivered' then
      update public.power_outage_client_email_deliveries
      set delivery_status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now()
      where id = target_delivery_id and delivery_status not in ('bounced', 'complained');
    elsif p_event_kind = 'email.sent' then
      update public.power_outage_client_email_deliveries
      set delivery_status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now()
      where id = target_delivery_id
        and delivery_status not in ('delivered', 'bounced', 'complained');
    elsif p_event_kind in ('email.failed', 'email.suppressed') then
      update public.power_outage_client_email_deliveries
      set delivery_status = 'failed',
          next_attempt_at = null,
          last_error_code = upper(replace(p_event_kind, '.', '_')),
          last_error_message = left(coalesce(
            p_payload #>> '{data,failed,reason}',
            p_payload #>> '{data,suppressed,message}',
            'Resend oznámil chybu doručení.'
          ), 2000),
          updated_at = now()
      where id = target_delivery_id
        and delivery_status not in ('delivered', 'bounced', 'complained');
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'deliveryId', target_delivery_id,
    'eventKind', p_event_kind
  );
end;
$$;

revoke all on function public.claim_power_outage_client_email_delivery_batch(integer)
  from public, anon, authenticated;
revoke all on function public.finish_power_outage_client_email_delivery_sent(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.finish_power_outage_client_email_delivery_failed(uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.finish_power_outage_client_email_delivery_batch(uuid)
  from public, anon, authenticated;
revoke all on function public.record_power_outage_client_email_resend_event(text,text,text,jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_power_outage_client_email_delivery_batch(integer) to service_role;
grant execute on function public.finish_power_outage_client_email_delivery_sent(uuid,uuid,text) to service_role;
grant execute on function public.finish_power_outage_client_email_delivery_failed(uuid,uuid,text,text,boolean) to service_role;
grant execute on function public.finish_power_outage_client_email_delivery_batch(uuid) to service_role;
grant execute on function public.record_power_outage_client_email_resend_event(text,text,text,jsonb) to service_role;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'power_outage_client_email_dispatch_every_three_minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'power_outage_client_email_dispatch_every_three_minutes',
    '1-59/3 * * * *',
    $job$select public.request_power_outages_endpoint('/api/power-outages/client-emails/send');$job$
  );
end
$$;

notify pgrst, 'reload schema';

commit;

select 'COLUMN' as check_type, 'worker lease fields' as object_name,
  count(*) = 4 as is_correct
from information_schema.columns
where table_schema = 'public'
  and table_name = 'power_outage_client_email_state'
  and column_name in ('worker_token', 'worker_expires_at', 'last_dispatch_started_at', 'last_dispatch_completed_at')
union all
select 'FUNCTION', 'claim safe email delivery batch',
  to_regprocedure('public.claim_power_outage_client_email_delivery_batch(integer)') is not null
union all
select 'FUNCTION', 'finish sent email delivery',
  to_regprocedure('public.finish_power_outage_client_email_delivery_sent(uuid,uuid,text)') is not null
union all
select 'FUNCTION', 'finish failed email delivery with backoff',
  to_regprocedure('public.finish_power_outage_client_email_delivery_failed(uuid,uuid,text,text,boolean)') is not null
union all
select 'FUNCTION', 'record idempotent Resend webhook event',
  to_regprocedure('public.record_power_outage_client_email_resend_event(text,text,text,jsonb)') is not null
union all
select 'CRON', 'email dispatch worker every three minutes',
  exists (
    select 1 from cron.job
    where jobname = 'power_outage_client_email_dispatch_every_three_minutes'
      and schedule = '1-59/3 * * * *'
      and active
  )
union all
select 'GRANT', 'authenticated cannot claim or finish email delivery',
  not has_function_privilege('authenticated', 'public.claim_power_outage_client_email_delivery_batch(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_power_outage_client_email_delivery_sent(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_power_outage_client_email_delivery_failed(uuid,uuid,text,text,boolean)', 'execute')
union all
select 'SAFETY', 'email dispatch remains disabled after worker migration',
  exists (
    select 1 from public.power_outage_client_email_state
    where singleton and dispatch_enabled = false
  )
union all
select 'SAFETY', 'shadow deliveries can never be claimed',
  pg_get_functiondef(
    'public.claim_power_outage_client_email_delivery_batch(integer)'::regprocedure
  ) like '%delivery.mode_at_plan = runtime_record.runtime_mode%'
  and pg_get_functiondef(
    'public.claim_power_outage_client_email_delivery_batch(integer)'::regprocedure
  ) like '%settings.mode = delivery.mode_at_plan%'
union all
select 'SAFETY', 'no email was sent by migration',
  not exists (
    select 1 from public.power_outage_client_email_deliveries
    where delivery_status in ('sending', 'sent', 'delivered', 'bounced', 'complained')
  )
union all
select 'ISOLATION', 'email worker cron is independent from outage loading',
  exists (
    select 1 from cron.job
    where jobname = 'power_outage_client_email_dispatch_every_three_minutes'
      and command like '%/client-emails/send%'
  )
order by check_type, object_name;
