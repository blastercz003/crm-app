begin;

do $$
begin
  if exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'normalize_addresses'
      and lock_token is not null
      and lock_expires_at > now()
  ) then
    raise exception 'Normalizace adres právě běží. Počkejte na její dokončení a spusťte migraci znovu.';
  end if;
end;
$$;

-- Verze 1 rozpadala nesvázané seznamy čísel distributora na samostatné
-- adresní dotazy. Externí dohledávání firem ještě nebylo spuštěno, proto je
-- bezpečné pilotní cíle odstranit a znovu vytvořit opraveným normalizátorem.
delete from public.complete_power_outage_address_targets
where case
  when coalesce(metadata ->> 'normalizerVersion', '') ~ '^[0-9]+$'
    then (metadata ->> 'normalizerVersion')::integer
  else 0
end < 2;

update public.complete_power_outage_addresses
set normalization_version = 0,
    normalized_at = null
where normalization_version < 2;

update public.complete_power_outage_task_state
set last_status = 'idle',
    last_processed_count = 0,
    consecutive_failure_count = 0,
    last_error_code = null,
    last_error_message = null,
    cursor = '{}'::jsonb,
    lock_token = null,
    lock_expires_at = null
where task_key = 'normalize_addresses';

commit;

select 'RESET' as check_type,
  'version 1 address targets removed' as object_name,
  not exists (
    select 1
    from public.complete_power_outage_address_targets
    where case
      when coalesce(metadata ->> 'normalizerVersion', '') ~ '^[0-9]+$'
        then (metadata ->> 'normalizerVersion')::integer
      else 0
    end < 2
  ) as is_correct
union all
select 'QUEUE', 'all addresses ready for normalizer v2',
  not exists (
    select 1
    from public.complete_power_outage_addresses
    where normalization_version > 0 and normalization_version < 2
  )
union all
select 'STATE', 'normalize_addresses task unlocked',
  exists (
    select 1
    from public.complete_power_outage_task_state
    where task_key = 'normalize_addresses'
      and last_status = 'idle'
      and lock_token is null
      and lock_expires_at is null
  )
order by check_type, object_name;
