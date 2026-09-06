begin;

-- Běžná aktivace zůstává striktně nereaktivní: staré odstávky se samy
-- nerozesílají. Ruční potvrzení shody po aktivaci pravidla je ale vědomá nová
-- událost administrátora a pro pravidlo NOVÁ ODSTÁVKA se smí naplánovat.
do $$
declare
  function_definition text;
  old_gate text := 'having outage.created_at >= rule.activated_at';
  new_gate text := $gate$having (
        outage.created_at >= rule.activated_at
        or bool_or(match.resolved_at >= rule.activated_at)
      )$gate$;
  old_gate_count integer;
  new_gate_count integer;
  first_gate_position integer;
begin
  if to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is null then
    raise exception 'Chybí produkční plánovač klientských e-mailů MARKETY.';
  end if;

  function_definition := pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  );

  select (length(function_definition) - length(replace(function_definition, old_gate, '')))
    / length(old_gate)
  into old_gate_count;

  select (length(function_definition) - length(replace(function_definition, new_gate, '')))
    / length(new_gate)
  into new_gate_count;

  if old_gate_count = 3 and new_gate_count = 1 then
    return;
  end if;
  if old_gate_count <> 4 or new_gate_count <> 0 then
    raise exception
      'Definice plánovače neodpovídá očekávané verzi (původní brány %, ruční brány %).',
      old_gate_count,
      new_gate_count;
  end if;

  first_gate_position := strpos(function_definition, old_gate);
  if first_gate_position = 0 then
    raise exception 'Aktivační podmínku nové odstávky se nepodařilo najít.';
  end if;

  function_definition := overlay(
    function_definition
    placing new_gate
    from first_gate_position
    for length(old_gate)
  );

  if strpos(function_definition, new_gate) = 0 then
    raise exception 'Aktivační podmínku ručního potvrzení se nepodařilo bezpečně doplnit.';
  end if;

  execute function_definition;
end
$$;

revoke all on function public.plan_power_outage_client_email_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.plan_power_outage_client_email_candidates(integer)
  to service_role;

notify pgrst, 'reload schema';
commit;

select 'FUNCTION' as check_type, 'manual confirmation plans new outage email' as object_name,
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) like '%or bool_or(match.resolved_at >= rule.activated_at)%' as is_correct
union all
select 'LOGIC', 'ordinary old outages remain non-retroactive',
  (
    length(pg_get_functiondef(
      'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
    ))
    - length(replace(
      pg_get_functiondef(
        'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
      ),
      'having outage.created_at >= rule.activated_at',
      ''
    ))
  ) / length('having outage.created_at >= rule.activated_at') = 3
union all
select 'GRANT', 'authenticated cannot plan client emails',
  not has_function_privilege(
    'authenticated',
    'public.plan_power_outage_client_email_candidates(integer)',
    'execute'
  )
union all
select 'ISOLATION', 'manual confirmation email stays in MARKET scope',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%complete_power_outage%'
union all
select 'SAFETY', 'email dispatch remains live', exists (
  select 1 from public.power_outage_client_email_state
  where singleton and runtime_mode = 'live' and dispatch_enabled
)
order by check_type, object_name;
