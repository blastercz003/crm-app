begin;

do $$
begin
  if to_regclass('public.complete_power_outage_action_workspace_state') is null
    or to_regclass('public.complete_power_outage_work_item_links') is null
    or to_regprocedure('public.get_complete_power_outage_action_workspace_v1(uuid)') is null
  then
    raise exception 'Nejprve nasadte datovy zaklad pracovniho centra Spravy komunikace.';
  end if;
end
$$;

update public.complete_power_outage_action_workspace_state
set ui_enabled = true,
    metadata = metadata || jsonb_build_object(
      'stage', 'ui-shell',
      'layout', 'compact-timeline-with-side-panels',
      'newWorkItemMutationsEnabled', false,
      'directEmailEnabled', false,
      'externalRequestsEnabled', false
    ),
    updated_at = now()
where singleton;

do $$
begin
  if not exists (
    select 1
    from public.complete_power_outage_action_workspace_state state
    where state.singleton
      and state.ui_enabled
      and state.metadata ->> 'stage' = 'ui-shell'
      and state.metadata ->> 'newWorkItemMutationsEnabled' = 'false'
      and state.metadata ->> 'directEmailEnabled' = 'false'
      and state.metadata ->> 'externalRequestsEnabled' = 'false'
  ) then
    raise exception 'Bezpecne zapnuti rozhrani pracovniho centra se nepodarilo.';
  end if;
end
$$;

commit;
