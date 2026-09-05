begin;

do $$
declare
  function_definition text;
begin
  if to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is null then
    raise exception 'Chybí plánovač kandidátů klientských e-mailů.';
  end if;

  function_definition := pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  );

  if function_definition like E'%\n  created_delivery_id uuid;%' then
    return;
  end if;
  if function_definition not like E'%\n  delivery_id uuid;%'
    or function_definition not like '%returning id into delivery_id;%'
    or function_definition not like '%if delivery_id is null then%'
    or function_definition not like E'%\n    delivery_id := null;%'
    or function_definition not like E'%select\n      delivery_id,\n      match.id,%'
  then
    raise exception 'Definice plánovače neodpovídá očekávané bezpečné verzi.';
  end if;

  function_definition := replace(
    function_definition,
    'delivery_id uuid;',
    'created_delivery_id uuid;'
  );
  function_definition := replace(
    function_definition,
    'returning id into delivery_id;',
    'returning id into created_delivery_id;'
  );
  function_definition := replace(
    function_definition,
    'if delivery_id is null then',
    'if created_delivery_id is null then'
  );
  function_definition := replace(
    function_definition,
    E'select\n      delivery_id,\n      match.id,',
    E'select\n      created_delivery_id,\n      match.id,'
  );
  function_definition := replace(
    function_definition,
    'delivery_id := null;',
    'created_delivery_id := null;'
  );

  if function_definition like E'%\n  delivery_id uuid;%'
    or function_definition like '%returning id into delivery_id;%'
    or function_definition like '%if delivery_id is null then%'
    or function_definition like E'%\n    delivery_id := null;%'
    or function_definition not like E'%\n  created_delivery_id uuid;%'
    or function_definition not like E'%select\n      created_delivery_id,\n      match.id,%'
  then
    raise exception 'Bezpečné přejmenování lokální proměnné nebylo úplné.';
  end if;

  execute function_definition;
end
$$;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type,
  'candidate planner delivery id ambiguity fixed' as object_name,
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) like E'%\n  created_delivery_id uuid;%'
  and pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not like E'%\n  delivery_id uuid;%' as is_correct
union all
select 'SAFETY', 'TEST dispatch returned to disabled after failed activation',
  exists (
    select 1
    from public.power_outage_client_email_state
    where singleton
      and runtime_mode in ('disabled', 'shadow')
      and dispatch_enabled = false
  )
union all
select 'SAFETY', 'no email entered sending state',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
    where mode_at_plan = 'test'
      and delivery_status in ('sending', 'sent', 'delivered', 'bounced', 'complained')
  )
union all
select 'ISOLATION', 'repair does not reference COMPLETE outage tables',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%complete_power_outage%'
order by check_type, object_name;
