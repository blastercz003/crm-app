begin;

do $$
declare
  function_definition text;
  spaced_gate text := 'having min(coalesce(match.resolved_at, match.first_matched_at)) >= rule.activated_at';
  compact_gate text := 'having min(coalesce(match.resolved_at,match.first_matched_at)) >= rule.activated_at';
  replacement_gate text := 'having outage.created_at >= rule.activated_at';
  old_gate_count integer;
  new_gate_count integer;
begin
  if to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is null then
    raise exception 'Chybí produkční plánovač klientských e-mailů MARKETY.';
  end if;

  function_definition := pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  );

  select
    (length(function_definition) - length(replace(function_definition, spaced_gate, '')))
      / length(spaced_gate)
    + (length(function_definition) - length(replace(function_definition, compact_gate, '')))
      / length(compact_gate)
  into old_gate_count;

  select
    (length(function_definition) - length(replace(function_definition, replacement_gate, '')))
      / length(replacement_gate)
  into new_gate_count;

  if new_gate_count = 4 and old_gate_count = 0 then
    return;
  end if;
  if old_gate_count <> 4 or new_gate_count <> 0 then
    raise exception
      'Definice plánovače neodpovídá očekávané verzi (staré brány %, nové brány %).',
      old_gate_count,
      new_gate_count;
  end if;

  function_definition := replace(function_definition, spaced_gate, replacement_gate);
  function_definition := replace(function_definition, compact_gate, replacement_gate);

  select
    (length(function_definition) - length(replace(function_definition, replacement_gate, '')))
      / length(replacement_gate)
  into new_gate_count;
  if new_gate_count <> 4
    or function_definition like '%' || spaced_gate || '%'
    or function_definition like '%' || compact_gate || '%'
  then
    raise exception 'Zpřísnění aktivační hranice e-mailů nebylo úplné.';
  end if;

  execute function_definition;
end
$$;

-- Neodeslaná ostrá zpráva ke starší odstávce nesmí zůstat převzitelná.
-- Historie se nemaže; položka zůstane auditovatelná jako cancelled.
update public.power_outage_client_email_deliveries as delivery
set delivery_status = 'cancelled',
    processing_token = null,
    processing_expires_at = null,
    next_attempt_at = null,
    last_error_code = 'CLIENT_EMAIL_PRE_ACTIVATION_OUTAGE',
    last_error_message = 'Zpráva byla zrušena, protože odstávka existovala před aktivací pravidla.',
    updated_at = now()
from public.power_outage_client_email_rules as rule,
     public.power_outages as outage
where rule.id = delivery.rule_id
  and outage.id = delivery.outage_id
  and delivery.mode_at_plan = 'live'
  and delivery.delivery_status in ('planned', 'queued', 'failed')
  and outage.created_at < rule.activated_at;

revoke all on function public.plan_power_outage_client_email_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.plan_power_outage_client_email_candidates(integer)
  to service_role;

notify pgrst, 'reload schema';
commit;

select
  'FUNCTION' as check_type,
  'email planner requires post-activation outage' as object_name,
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
  ) / length('having outage.created_at >= rule.activated_at') = 4 as is_correct

union all

select
  'SAFETY',
  'no unsent pre-activation live email remains',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries as delivery
    join public.power_outage_client_email_rules as rule
      on rule.id = delivery.rule_id
    join public.power_outages as outage
      on outage.id = delivery.outage_id
    where delivery.mode_at_plan = 'live'
      and delivery.delivery_status in ('planned', 'queued', 'failed', 'sending')
      and outage.created_at < rule.activated_at
  )

union all

select
  'SAFETY',
  'no pre-activation live email was sent',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries as delivery
    join public.power_outage_client_email_rules as rule
      on rule.id = delivery.rule_id
    join public.power_outages as outage
      on outage.id = delivery.outage_id
    where delivery.mode_at_plan = 'live'
      and delivery.delivery_status in ('sent', 'delivered', 'bounced', 'complained')
      and outage.created_at < rule.activated_at
  )

union all

select
  'STATE',
  'four live MARKET clients remain enabled',
  count(*) = 4 and count(*) filter (where mode = 'live') = 4
from public.power_outage_client_email_settings

union all

select
  'ISOLATION',
  'email activation repair stays in MARKET scope',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%complete_power_outage%'

order by check_type, object_name;
