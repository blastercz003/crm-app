begin;

do $$
begin
  if to_regclass('public.complete_power_outage_cez_staged_addresses') is null
    or to_regprocedure('public.request_complete_power_outage_cez_staged_address_normalization(integer)') is null
  then
    raise exception 'Nejdříve spusťte migraci stagingové normalizace adres ČEZ.';
  end if;
end
$$;

-- Opakovatelná technická chyba musí mít přednost před dosud nezpracovanou
-- položkou. Jinak opravné tlačítko sice založí dávku, ale ta může zpracovat
-- osm jiných pending adres a původní chyba zůstane v monitoringu.
create or replace function public.claim_complete_power_outage_cez_staged_address_batch(
  requested_limit integer default 8
)
returns table (
  id uuid,
  outage_external_id text,
  municipality text,
  municipality_code text,
  town_part text,
  street text,
  house_number text,
  orientation_number text,
  raw_address text,
  metadata jsonb,
  normalization_attempt_count integer,
  normalization_lock_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_limit integer := least(8, greatest(1, coalesce(requested_limit, 8)));
  batch_token uuid := gen_random_uuid();
begin
  update public.complete_power_outage_cez_staged_addresses address
  set normalization_status = 'error',
      normalization_next_attempt_at = now(),
      normalization_error_code = 'CEZ_RUIAN_VALIDATION_LOCK_EXPIRED',
      normalization_error_message =
        'Předchozí validace RÚIAN nebyla dokončena v bezpečnostním limitu.',
      normalization_lock_token = null,
      normalization_lock_expires_at = null
  where address.normalization_status = 'processing'
    and address.normalization_lock_expires_at <= now();

  return query
  with candidates as (
    select address.id
    from public.complete_power_outage_cez_staged_addresses address
    where address.normalization_version < 3
      and address.normalization_status in ('pending', 'error')
      and (
        address.normalization_next_attempt_at is null
        or address.normalization_next_attempt_at <= now()
      )
    order by
      case address.normalization_status when 'error' then 0 else 1 end,
      address.municipality_code nulls last,
      address.id
    for update skip locked
    limit safe_limit
  ), claimed as (
    update public.complete_power_outage_cez_staged_addresses address
    set normalization_status = 'processing',
        normalization_attempt_count = address.normalization_attempt_count + 1,
        normalization_lock_token = batch_token,
        normalization_lock_expires_at = now() + interval '10 minutes',
        normalization_error_code = null,
        normalization_error_message = null
    from candidates
    where address.id = candidates.id
    returning address.*
  )
  select
    claimed.id,
    claimed.outage_external_id,
    claimed.municipality,
    claimed.municipality_code,
    claimed.town_part,
    claimed.street,
    claimed.house_number,
    claimed.orientation_number,
    claimed.raw_address,
    claimed.metadata,
    claimed.normalization_attempt_count,
    claimed.normalization_lock_token
  from claimed
  order by claimed.municipality_code nulls last, claimed.id;
end;
$$;

revoke all on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  from public, anon, authenticated;
grant execute on function public.claim_complete_power_outage_cez_staged_address_batch(integer)
  to service_role;

create or replace function public.recover_complete_power_outage_cez_staged_normalization_transient_errors()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_count integer := 0;
  request_id bigint;
begin
  update public.complete_power_outage_cez_staged_addresses address
  set normalization_status = 'error',
      normalization_attempt_count = 0,
      normalization_next_attempt_at = null,
      normalization_error_code = null,
      normalization_error_message = null,
      normalization_lock_token = null,
      normalization_lock_expires_at = null
  where address.normalization_status = 'error'
     or (
       address.normalization_status = 'needs_review'
       and address.normalization_error_code = 'CEZ_STAGED_NORMALIZATION_RETRIES_EXHAUSTED'
       and coalesce(address.normalization_error_message, '') ~* (
         'Index adres RÚIAN odpověděl HTTP (429|5[0-9][0-9])'
         || '|RÚIAN odpověděl HTTP (429|5[0-9][0-9])'
         || '|fetch failed|network|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN'
       )
     );
  get diagnostics affected_count = row_count;

  if affected_count = 0 then
    return jsonb_build_object(
      'status', 'not_needed',
      'stage', 'normalization',
      'affectedCount', 0,
      'message', 'Nebyla nalezena žádná opakovatelná technická chyba normalizace.'
    );
  end if;

  request_id := public.request_complete_power_outage_cez_staged_address_normalization(8);
  return jsonb_build_object(
    'status', 'started',
    'stage', 'normalization',
    'affectedCount', affected_count,
    'requestId', request_id,
    'message', affected_count::text || ' technicky zablokovaných adres bylo bezpečně vráceno do fronty.'
  );
end;
$$;

revoke all on function public.recover_complete_power_outage_cez_staged_normalization_transient_errors()
  from public, anon, authenticated;
grant execute on function public.recover_complete_power_outage_cez_staged_normalization_transient_errors()
  to service_role;

-- Jednorázově opravíme pouze položky, jejichž ruční kontrola vznikla
-- vyčerpáním pokusů kvůli prokazatelně dočasné síťové/HTTP chybě.
update public.complete_power_outage_cez_staged_addresses address
set normalization_status = 'error',
    normalization_attempt_count = 0,
    normalization_next_attempt_at = null,
    normalization_error_code = null,
    normalization_error_message = null,
    normalization_lock_token = null,
    normalization_lock_expires_at = null
where address.normalization_status = 'needs_review'
  and address.normalization_error_code = 'CEZ_STAGED_NORMALIZATION_RETRIES_EXHAUSTED'
  and coalesce(address.normalization_error_message, '') ~* (
    'Index adres RÚIAN odpověděl HTTP (429|5[0-9][0-9])'
    || '|RÚIAN odpověděl HTTP (429|5[0-9][0-9])'
    || '|fetch failed|network|timed? ?out|timeout|ECONN|ENOTFOUND|EAI_AGAIN'
  );

commit;
