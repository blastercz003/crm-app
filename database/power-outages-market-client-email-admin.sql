begin;

do $$
begin
  if to_regclass('public.power_outage_client_email_settings') is null then
    raise exception 'Nejdříve musí být nasazen databázový základ klientských e-mailů.';
  end if;
end
$$;

create or replace function public.save_power_outage_client_email_admin_configuration(
  p_client_id uuid,
  p_mode text,
  p_from_name text,
  p_from_email text,
  p_reply_to_email text,
  p_recipients jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_count integer;
  active_to_count integer;
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Tuto konfiguraci může měnit pouze administrátor.';
  end if;

  if p_mode not in ('disabled', 'shadow') then
    raise exception 'Režimy TEST a AKTIVNÍ budou dostupné až po bezpečném zapojení poskytovatele e-mailů.';
  end if;

  if not exists (
    select 1
    from public.power_outage_client_email_settings as settings
    where settings.client_id = p_client_id
  ) then
    raise exception 'Klient není součástí konfigurace e-mailových upozornění MARKETY.';
  end if;

  if jsonb_typeof(coalesce(p_recipients, '[]'::jsonb)) <> 'array' then
    raise exception 'Seznam příjemců musí být pole.';
  end if;

  select count(*)
  into recipient_count
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb));

  if recipient_count > 25 then
    raise exception 'Pro jednoho klienta lze nastavit nejvýše 25 příjemců.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as item(value)
    where coalesce(item.value ->> 'kind', '') not in ('to', 'cc')
       or nullif(trim(coalesce(item.value ->> 'email', '')), '') is null
       or trim(item.value ->> 'email') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'Každý příjemce musí mít platný e-mail a typ TO nebo CC.';
  end if;

  if exists (
    select 1
    from (
      select
        lower(trim(item.value ->> 'email')) as email,
        item.value ->> 'kind' as kind,
        count(*) as duplicate_count
      from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as item(value)
      group by lower(trim(item.value ->> 'email')), item.value ->> 'kind'
    ) as duplicates
    where duplicates.duplicate_count > 1
  ) then
    raise exception 'Stejný e-mail nelze ve stejné skupině příjemců zadat vícekrát.';
  end if;

  select count(*)
  into active_to_count
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as item(value)
  where item.value ->> 'kind' = 'to'
    and coalesce((item.value ->> 'isActive')::boolean, false);

  if p_mode = 'shadow' then
    if nullif(trim(coalesce(p_from_name, '')), '') is null
      or trim(coalesce(p_from_email, '')) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    then
      raise exception 'Pro stínový režim vyplňte jméno a platnou adresu odesílatele.';
    end if;
    if active_to_count = 0 then
      raise exception 'Pro stínový režim vyberte alespoň jednoho aktivního příjemce TO.';
    end if;
  end if;

  if nullif(trim(coalesce(p_reply_to_email, '')), '') is not null
    and trim(p_reply_to_email) !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  then
    raise exception 'Adresa Reply-To není platná.';
  end if;

  update public.power_outage_client_email_settings
  set mode = p_mode,
      from_name = nullif(trim(coalesce(p_from_name, '')), ''),
      from_email = case
        when nullif(trim(coalesce(p_from_email, '')), '') is null then null
        else lower(trim(p_from_email))
      end,
      reply_to_email = case
        when nullif(trim(coalesce(p_reply_to_email, '')), '') is null then null
        else lower(trim(p_reply_to_email))
      end,
      activated_at = null,
      updated_at = now()
  where client_id = p_client_id;

  delete from public.power_outage_client_email_recipients
  where client_id = p_client_id;

  insert into public.power_outage_client_email_recipients (
    client_id,
    recipient_kind,
    name,
    email,
    is_active
  )
  select
    p_client_id,
    item.value ->> 'kind',
    nullif(trim(coalesce(item.value ->> 'name', '')), ''),
    lower(trim(item.value ->> 'email')),
    coalesce((item.value ->> 'isActive')::boolean, false)
  from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb)) as item(value);

  return jsonb_build_object(
    'ok', true,
    'clientId', p_client_id,
    'mode', p_mode,
    'recipientCount', recipient_count,
    'activeToCount', active_to_count,
    'dispatchEnabled', false
  );
end;
$$;

revoke all on function public.save_power_outage_client_email_admin_configuration(
  uuid, text, text, text, text, jsonb
) from public, anon;
grant execute on function public.save_power_outage_client_email_admin_configuration(
  uuid, text, text, text, text, jsonb
) to authenticated, service_role;

create or replace function public.retry_power_outage_client_email_delivery(
  p_delivery_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Tuto operaci může provést pouze administrátor.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'queued',
      next_attempt_at = now(),
      processing_token = null,
      processing_expires_at = null,
      updated_at = now()
  where id = p_delivery_id
    and delivery_status = 'failed'
    and attempt_count < max_attempt_count;

  if not found then
    raise exception 'Zprávu nelze opakovat nebo již dosáhla limitu pokusů.';
  end if;
end;
$$;

revoke all on function public.retry_power_outage_client_email_delivery(uuid)
  from public, anon;
grant execute on function public.retry_power_outage_client_email_delivery(uuid)
  to authenticated, service_role;

create or replace function public.skip_power_outage_client_email_delivery(
  p_delivery_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.current_user_is_admin() then
    raise exception 'Tuto operaci může provést pouze administrátor.';
  end if;

  update public.power_outage_client_email_deliveries
  set delivery_status = 'skipped',
      skipped_at = now(),
      next_attempt_at = null,
      processing_token = null,
      processing_expires_at = null,
      updated_at = now()
  where id = p_delivery_id
    and delivery_status in ('planned', 'queued', 'failed');

  if not found then
    raise exception 'Zprávu v tomto stavu nelze přeskočit.';
  end if;
end;
$$;

revoke all on function public.skip_power_outage_client_email_delivery(uuid)
  from public, anon;
grant execute on function public.skip_power_outage_client_email_delivery(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, object_name,
  to_regprocedure(object_name) is not null as is_correct
from unnest(array[
  'public.save_power_outage_client_email_admin_configuration(uuid,text,text,text,text,jsonb)',
  'public.retry_power_outage_client_email_delivery(uuid)',
  'public.skip_power_outage_client_email_delivery(uuid)'
]) as object_name
union all
select 'SAFETY', 'admin configuration cannot enable TEST or ACTIVE',
  pg_get_functiondef(
    'public.save_power_outage_client_email_admin_configuration(uuid,text,text,text,text,jsonb)'::regprocedure
  ) like '%p_mode not in (''disabled'', ''shadow'')%'
union all
select 'SAFETY', 'client email dispatch remains disabled',
  exists (
    select 1
    from public.power_outage_client_email_state
    where singleton
      and runtime_mode = 'disabled'
      and dispatch_enabled = false
  )
union all
select 'SAFETY', 'no client email delivery was created',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
  )
union all
select 'SAFETY', 'no client email cron exists',
  not exists (
    select 1
    from cron.job
    where jobname ilike '%client%email%'
       or command ilike '%client_email%'
  )
union all
select 'SCOPE', 'configured clients remain MARKET clients only',
  not exists (
    select 1
    from public.power_outage_client_email_settings as settings
    where not exists (
      select 1
      from public.power_outage_job_client_mappings as mapping
      where mapping.client_id = settings.client_id
        and mapping.chain_name = settings.chain_name
    )
  )
order by check_type, object_name;
