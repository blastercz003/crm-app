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
  set normalization_status = 'pending',
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
set normalization_status = 'pending',
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
