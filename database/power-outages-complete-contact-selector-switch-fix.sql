begin;

-- Oprava prepnuti zdrojoveho AI SELECT filtru po aktivaci local-first toku.
-- Zmena filtru je dovolena jen pri pozastavenem runtime, nevykona zadny HTTP
-- ani Brave pozadavek a po zachyceni nove davky ponecha vsechny workery vypnute.
do $$
begin
  if to_regprocedure('public.capture_complete_power_outage_contact_discovery_batch(text)') is null
    or to_regclass('public.complete_power_outage_contact_discovery_state') is null
    or to_regclass('public.complete_power_outage_contact_discovery_selectors') is null then
    raise exception 'Chybi zavislosti pro bezpecne prepnuti filtru kontaktu.';
  end if;
end
$$;

create or replace function public.prepare_complete_power_outage_contact_selector_v1(
  requested_selector_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $$
declare
  capture_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'admin'
  ) then
    raise exception 'Vyber kontaktu muze menit pouze administrator.';
  end if;

  if requested_selector_key is null
    or not exists (
      select 1
      from public.complete_power_outage_contact_discovery_selectors selector
      where selector.selector_key = requested_selector_key
        and selector.lifecycle_status = 'active'
    ) then
    raise exception 'Pozadovany vyber kontaktu neni aktivni.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('complete-contact-selector-switch-v1')
  );

  perform 1
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton
  for update;

  if not found then
    raise exception 'Chybi stav dohledavani kontaktu.';
  end if;

  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
      and (
        state_row.runtime_enabled
        or state_row.brave_fallback_enabled
        or state_row.local_discovery_v2_shadow_enabled
        or state_row.website_verification_v2_enabled
        or state_row.contact_extraction_shadow_enabled
      )
  ) then
    raise exception 'Pred zmenou vyberu nejdrive pozastavte dohledavani kontaktu.';
  end if;

  -- Tyto dva prepinace patri samostatne e-mailove fazi. Nejsou zde meneny.
  if exists (
    select 1
    from public.complete_power_outage_contact_discovery_state state_row
    where state_row.singleton
      and (state_row.email_planning_enabled or state_row.email_dispatch_enabled)
  ) then
    raise exception 'Vyber kontaktu nelze menit behem aktivni e-mailove faze.';
  end if;

  -- Historicky discovery_enabled zustava true i pri pozastavenem runtime kvuli
  -- dostupnosti admin UI. Pro kontrolovane zachyceni jej uvnitr transakce
  -- docasne vypneme spolecne se vsemi pracovnimi prepinaci.
  update public.complete_power_outage_contact_discovery_state
  set discovery_enabled = false,
      ui_enabled = false,
      website_lookup_enabled = false,
      website_verification_v2_enabled = false,
      local_discovery_v2_shadow_enabled = false,
      contact_extraction_shadow_enabled = false,
      contact_extraction_enabled = false,
      updated_at = now()
  where singleton;

  capture_result := public.capture_complete_power_outage_contact_discovery_batch(
    requested_selector_key
  );

  -- Zachovame admin UI dostupne, ale runtime i vsechny workery zustavaji
  -- pozastavene. Samostatne e-mailove prepinace zustaly beze zmeny.
  update public.complete_power_outage_contact_discovery_state
  set runtime_enabled = false,
      brave_fallback_enabled = false,
      discovery_enabled = true,
      ui_enabled = true,
      website_lookup_enabled = false,
      website_verification_v2_enabled = false,
      local_discovery_v2_shadow_enabled = false,
      contact_extraction_shadow_enabled = false,
      contact_extraction_enabled = false,
      last_activity_at = now(),
      last_error_code = null,
      last_error_message = null,
      metadata = metadata || jsonb_build_object(
        'selectorSwitchContract', 'complete-contact-selector-switch-v1',
        'lastSelectorPreparedFromUiAt', now(),
        'lastSelectorPreparedFromUiBy', auth.uid(),
        'preparedSelectorKey', requested_selector_key,
        'paidWebsiteLookupRequested', false,
        'externalRequestCount', 0,
        'runtimeRemainsPaused', true,
        'emailSendingChanged', false
      ),
      updated_at = now()
  where singleton;

  return capture_result || jsonb_build_object(
    'selectorKey', requested_selector_key,
    'runtimeEnabled', false,
    'workersEnabled', false,
    'paidWebsiteLookupRequested', false,
    'externalRequestCount', 0,
    'emailSendingChanged', false
  );
end;
$$;

revoke all on function public.prepare_complete_power_outage_contact_selector_v1(text)
  from public, anon;
grant execute on function public.prepare_complete_power_outage_contact_selector_v1(text)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

with function_contract as (
  select pg_get_functiondef(
    'public.prepare_complete_power_outage_contact_selector_v1(text)'::regprocedure
  ) as definition
), audit as (
  select
    'FUNCTION'::text as check_type,
    'safe paused selector switch exists'::text as object_name,
    to_regprocedure(
      'public.prepare_complete_power_outage_contact_selector_v1(text)'
    ) is not null as is_correct

  union all
  select 'GRANT', 'selector switch remains administrator guarded',
    definition ilike '%profile.role = ''admin''%'
      and has_function_privilege(
        'authenticated',
        'public.prepare_complete_power_outage_contact_selector_v1(text)',
        'EXECUTE'
      )
      and not has_function_privilege(
        'anon',
        'public.prepare_complete_power_outage_contact_selector_v1(text)',
        'EXECUTE'
      )
  from function_contract

  union all
  select 'LOGIC', 'selector switch requires paused contact runtime',
    definition ilike '%state_row.runtime_enabled%'
      and definition ilike '%Pred zmenou vyberu nejdrive pozastavte%'
  from function_contract

  union all
  select 'LOGIC', 'selector switch captures the selected dynamic AI SELECT target set',
    definition ilike '%capture_complete_power_outage_contact_discovery_batch%'
      and definition ilike '%requested_selector_key%'
  from function_contract

  union all
  select 'LOGIC', 'selector switch leaves contact workers paused',
    definition ilike '%runtime_enabled = false%'
      and definition ilike '%local_discovery_v2_shadow_enabled = false%'
      and definition ilike '%website_verification_v2_enabled = false%'
      and definition ilike '%contact_extraction_shadow_enabled = false%'
  from function_contract

  union all
  select 'LOGIC', 'selector switch preserves the admin UI activation constraint',
    definition ilike '%discovery_enabled = false%ui_enabled = false%'
      and definition ilike '%discovery_enabled = true%ui_enabled = true%'
  from function_contract

  union all
  select 'SAFETY', 'selector switch performs no HTTP or Brave request',
    definition not ilike '%http_post%'
      and definition not ilike '%request_complete_power_outage_contact_discovery_website_v2%'
      and definition ilike '%paidWebsiteLookupRequested'', false%'
  from function_contract

  union all
  select 'SAFETY', 'selector switch does not change email planning or dispatch',
    definition not ilike '%email_planning_enabled =%'
      and definition not ilike '%email_dispatch_enabled =%'
      and definition ilike '%emailSendingChanged'', false%'
  from function_contract

  union all
  select 'STATE', 'contact discovery remains paused before first use',
    not state_row.runtime_enabled
      and not state_row.brave_fallback_enabled
      and not state_row.local_discovery_v2_shadow_enabled
      and not state_row.website_verification_v2_enabled
      and not state_row.contact_extraction_shadow_enabled
  from public.complete_power_outage_contact_discovery_state state_row
  where state_row.singleton
)
select check_type, object_name, is_correct
from audit
order by check_type, object_name;
