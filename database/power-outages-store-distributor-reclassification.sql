begin;

-- Již ověřené adresy s dosud nerozpoznaným označením distributora znovu
-- zařadíme na konec existující omezené fronty. Samotná migrace nevytváří
-- žádné požadavky na ČEZ ani EG.D a nemění frekvenci plánovače.
update public.power_outage_store_registry
set needs_refresh = true,
    metadata = metadata || jsonb_build_object(
      'distributorRecheckReason', 'egd-name-normalization-v2',
      'distributorRecheckQueuedAt', now()
    ),
    updated_at = now()
where is_active
  and not needs_refresh
  and distributor = 'unknown'
  and verification_status in ('verified', 'probable')
  and ruian_address_id is not null;

commit;

select 'STATE' as check_type,
  'unknown verified stores queued for distributor recheck' as object_name,
  not exists (
    select 1
    from public.power_outage_store_registry
    where is_active
      and not needs_refresh
      and distributor = 'unknown'
      and verification_status in ('verified', 'probable')
      and ruian_address_id is not null
  ) as is_correct;
