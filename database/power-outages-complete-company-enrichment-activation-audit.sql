with latest_activation as (
  select *
  from public.complete_power_outage_company_enrichment_activations
  where activation_status = 'complete'
  order by activated_at desc
  limit 1
), current_icos as (
  select distinct company.ico
  from public.complete_power_outage_companies company
  join public.complete_power_outage_addresses address_row on address_row.id = company.outage_address_id
  join public.complete_power_outages outage on outage.id = address_row.outage_id
  where company.ico ~ '^[0-9]{8}$'
    and company.candidate_status in ('confirmed', 'needs_review')
    and company.business_relevance_status = 'eligible'
    and outage.ends_at >= now()
    and outage.source_status in ('scheduled', 'active')
)
select 'CRON' as check_type,
  'controlled ARES RES enrichment every minute' as object_name,
  exists (
    select 1 from cron.job
    where jobname = 'power_outages_complete_company_enrichment_every_minute'
      and schedule = '* * * * *'
      and command like '%request_complete_power_outage_company_enrichment(20)%'
      and active
  ) as is_correct
union all
select 'DATA', 'activation manifest is completely represented in queue',
  exists (
    select 1 from latest_activation
    where represented_queue_count = unique_ico_count
  )
  and not exists (
    select 1
    from public.complete_power_outage_company_enrichment_activation_items item
    join latest_activation activation on activation.id = item.activation_id
    left join public.complete_power_outage_company_enrichment_queue queue_row on queue_row.ico = item.ico
    where queue_row.ico is null
  )
union all
select 'DATA', 'all current visible COMPLETE companies with ICO are queued',
  not exists (
    select 1 from current_icos current_row
    left join public.complete_power_outage_company_enrichment_queue queue_row on queue_row.ico = current_row.ico
    where queue_row.ico is null
  )
union all
select 'FUNCTION', 'controlled ARES RES enrichment activation',
  to_regprocedure('public.activate_complete_power_outage_company_enrichment()') is not null
union all
select 'FUNCTION', 'dedicated ARES RES cron bridge',
  to_regprocedure('public.request_complete_power_outage_company_enrichment(integer)') is not null
union all
select 'FUNCTION', 'safe ARES RES enrichment pause',
  to_regprocedure('public.pause_complete_power_outage_company_enrichment()') is not null
union all
select 'GRANT', 'authenticated cannot activate or schedule ARES RES enrichment',
  not has_function_privilege('authenticated', 'public.activate_complete_power_outage_company_enrichment()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.pause_complete_power_outage_company_enrichment()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.enqueue_current_complete_power_outage_company_enrichment()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.request_complete_power_outage_company_enrichment(integer)', 'EXECUTE')
union all
select 'ISOLATION', 'ARES RES activation stays in COMPLETE scope',
  position('public.power_outages' in pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure)) = 0
  and position('public.stores' in pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure)) = 0
union all
select 'RLS', 'ARES RES activation manifests have RLS',
  (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_company_enrichment_activations'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.complete_power_outage_company_enrichment_activation_items'::regclass)
union all
select 'LOGIC', 'current and new COMPLETE companies are automatically enqueued',
  exists (
    select 1 from pg_trigger
    where tgname = 'cpo_companies_enqueue_res_enrichment' and not tgisinternal
  )
  and to_regprocedure('public.enqueue_current_complete_power_outage_company_enrichment()') is not null
union all
select 'LOGIC', 'backfill uses equal priority without distributor weighting',
  not exists (
    select 1 from public.complete_power_outage_company_enrichment_queue where priority <> 100
  )
union all
select 'SAFETY', 'ARES RES uses shared provider quota',
  to_regprocedure('public.claim_complete_power_outage_provider_quota(text,integer,integer)') is not null
union all
select 'SAFETY', 'activation does not mutate COMPLETE source records',
  position('update public.complete_power_outage_companies' in lower(pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure))) = 0
  and position('delete from public.complete_power_outage_companies' in lower(pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure))) = 0
  and position('update public.complete_power_outages' in lower(pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure))) = 0
  and position('delete from public.complete_power_outages' in lower(pg_get_functiondef('public.activate_complete_power_outage_company_enrichment()'::regprocedure))) = 0
union all
select 'SAFETY', 'scoring and AI selection remain disabled',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and not scoring_enabled and not ui_enabled
  )
union all
select 'STATE', 'ARES RES enrichment is active',
  exists (
    select 1 from public.complete_power_outage_commercial_selection_state
    where singleton and res_enrichment_enabled
  )
union all
select 'TABLE', 'immutable ARES RES activation manifest',
  to_regclass('public.complete_power_outage_company_enrichment_activations') is not null
  and to_regclass('public.complete_power_outage_company_enrichment_activation_items') is not null
  and exists (
    select 1 from pg_trigger
    where tgname = 'cpo_company_enrichment_activation_immutable' and not tgisinternal
  )
order by check_type, object_name;
