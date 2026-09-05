begin;

do $$
begin
  if to_regclass('public.power_outage_client_email_deliveries') is null then
    raise exception 'Nejdříve musí být nasazen databázový základ klientských e-mailů.';
  end if;
  if to_regclass('public.power_outage_job_client_mappings') is null then
    raise exception 'Chybí vazba řetězců MARKETY na klienty.';
  end if;
end
$$;

-- Pro každý klientský typ události existuje právě jedna aktuálně zapnutá verze.
create unique index if not exists power_outage_client_email_rules_one_enabled_event_uidx
  on public.power_outage_client_email_rules (client_id, event_kind)
  where enabled = true;

-- Připravíme výchozí pravidla, ale žádné z nich migrace nezapne.
insert into public.power_outage_client_email_rules (
  client_id,
  name,
  event_kind,
  enabled,
  condition_schema_version,
  conditions,
  version,
  activated_at
)
select
  settings.client_id,
  event.name,
  event.event_kind,
  false,
  1,
  '{}'::jsonb,
  1,
  null
from public.power_outage_client_email_settings as settings
cross join (
  values
    ('Nová potvrzená odstávka', 'new_outage'),
    ('Změna termínu', 'schedule_changed'),
    ('Zrušení odstávky', 'cancelled'),
    ('Připomenutí před začátkem', 'reminder_24h')
) as event(name, event_kind)
on conflict (client_id, event_kind, name, version) do nothing;

create or replace function public.plan_power_outage_client_email_candidates(
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_record record;
  candidate record;
  created_delivery_id uuid;
  recipient_snapshot jsonb;
  store_snapshot jsonb;
  planned_count integer := 0;
  skipped_count integer := 0;
  processed_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Plánování klientských e-mailů je dostupné pouze serverovému workeru.';
  end if;

  if p_limit < 1 or p_limit > 1000 then
    raise exception 'Velikost dávky musí být mezi 1 a 1000.';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('power_outage_client_email_candidate_planner', 0)
  ) then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_running',
      'plannedCount', 0
    );
  end if;

  select runtime_mode, dispatch_enabled
  into runtime_record
  from public.power_outage_client_email_state
  where singleton;

  if runtime_record.runtime_mode is null then
    raise exception 'Globální stav klientských e-mailů není dostupný.';
  end if;

  if runtime_record.runtime_mode = 'disabled' then
    return jsonb_build_object(
      'ok', true,
      'status', 'disabled',
      'plannedCount', 0,
      'processedCount', 0,
      'skippedCount', 0,
      'sendingAttempted', false
    );
  end if;

  for candidate in
    with new_candidates as (
      select
        settings.client_id,
        settings.mode as mode_at_plan,
        rule.id as rule_id,
        outage.id as outage_id,
        latest_version.id as outage_version_id,
        'new_outage'::text as event_kind,
        min(coalesce(match.resolved_at, match.first_matched_at)) as event_at,
        outage.source,
        outage.external_id,
        outage.title,
        outage.starts_at,
        outage.ends_at,
        concat(
          'market-client-email:', settings.client_id::text,
          ':new_outage:', outage.id::text
        ) as dedupe_key
      from public.power_outage_client_email_settings as settings
      join public.power_outage_client_email_rules as rule
        on rule.client_id = settings.client_id
       and rule.event_kind = 'new_outage'
       and rule.enabled
       and rule.activated_at is not null
      join public.power_outage_job_client_mappings as mapping
        on mapping.client_id = settings.client_id
      join public.power_outage_store_matches as match
        on upper(trim(match.store_chain_name)) = mapping.chain_name
       and match.match_status = 'confirmed'
      join public.power_outages as outage
        on outage.id = match.outage_id
       and outage.archived_at is null
       and outage.source_status not in ('completed', 'cancelled')
      left join lateral (
        select version.id
        from public.power_outage_versions as version
        where version.outage_id = outage.id
        order by version.version_number desc
        limit 1
      ) as latest_version on true
      where settings.mode <> 'disabled'
        and coalesce(match.resolved_at, match.first_matched_at) >= rule.activated_at
      group by
        settings.client_id,
        settings.mode,
        rule.id,
        outage.id,
        latest_version.id
    ),
    changed_candidates as (
      select
        settings.client_id,
        settings.mode as mode_at_plan,
        rule.id as rule_id,
        outage.id as outage_id,
        version.id as outage_version_id,
        rule.event_kind,
        version.created_at as event_at,
        outage.source,
        outage.external_id,
        outage.title,
        outage.starts_at,
        outage.ends_at,
        concat(
          'market-client-email:', settings.client_id::text,
          ':', rule.event_kind, ':', outage.id::text, ':', version.id::text
        ) as dedupe_key
      from public.power_outage_client_email_settings as settings
      join public.power_outage_client_email_rules as rule
        on rule.client_id = settings.client_id
       and rule.event_kind in ('schedule_changed', 'cancelled')
       and rule.enabled
       and rule.activated_at is not null
      join public.power_outage_job_client_mappings as mapping
        on mapping.client_id = settings.client_id
      join public.power_outage_store_matches as match
        on upper(trim(match.store_chain_name)) = mapping.chain_name
       and match.match_status = 'confirmed'
      join public.power_outages as outage
        on outage.id = match.outage_id
       and outage.archived_at is null
      join public.power_outage_versions as version
        on version.outage_id = outage.id
       and version.created_at >= rule.activated_at
       and (
         (rule.event_kind = 'cancelled' and version.change_reasons @> array['cancelled']::text[])
         or (
           rule.event_kind = 'schedule_changed'
           and version.change_reasons @> array['schedule_changed']::text[]
           and not (version.change_reasons @> array['cancelled']::text[])
         )
       )
      where settings.mode <> 'disabled'
      group by
        settings.client_id,
        settings.mode,
        rule.id,
        rule.event_kind,
        outage.id,
        version.id,
        version.created_at
    ),
    candidates as (
      select * from new_candidates
      union all
      select * from changed_candidates
    )
    select candidates.*
    from candidates
    where not exists (
      select 1
      from public.power_outage_client_email_deliveries as delivery
      where delivery.dedupe_key = candidates.dedupe_key
    )
    order by candidates.event_at, candidates.client_id, candidates.outage_id
    limit p_limit
  loop
    processed_count := processed_count + 1;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'kind', recipient.recipient_kind,
          'name', recipient.name,
          'email', recipient.email
        )
        order by recipient.recipient_kind, recipient.email
      ),
      '[]'::jsonb
    )
    into recipient_snapshot
    from public.power_outage_client_email_recipients as recipient
    where recipient.client_id = candidate.client_id
      and recipient.is_active;

    if not exists (
      select 1
      from public.power_outage_client_email_recipients as recipient
      where recipient.client_id = candidate.client_id
        and recipient.is_active
        and recipient.recipient_kind = 'to'
    ) then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'matchId', match.id,
          'storeId', match.store_id,
          'chainName', match.store_chain_name,
          'storeNumber', match.store_number,
          'city', match.store_city,
          'address', match.store_address
        )
        order by match.store_city, match.store_number
      ),
      '[]'::jsonb
    )
    into store_snapshot
    from public.power_outage_store_matches as match
    join public.power_outage_job_client_mappings as mapping
      on mapping.chain_name = upper(trim(match.store_chain_name))
     and mapping.client_id = candidate.client_id
    where match.outage_id = candidate.outage_id
      and match.match_status = 'confirmed';

    insert into public.power_outage_client_email_deliveries (
      client_id,
      rule_id,
      outage_id,
      outage_version_id,
      event_kind,
      mode_at_plan,
      dedupe_key,
      delivery_status,
      recipient_snapshot,
      store_snapshot,
      subject_snapshot,
      text_snapshot,
      metadata
    )
    values (
      candidate.client_id,
      candidate.rule_id,
      candidate.outage_id,
      candidate.outage_version_id,
      candidate.event_kind,
      candidate.mode_at_plan,
      candidate.dedupe_key,
      'planned',
      recipient_snapshot,
      store_snapshot,
      case candidate.event_kind
        when 'new_outage' then 'Nová potvrzená odstávka'
        when 'schedule_changed' then 'Změna termínu odstávky'
        when 'cancelled' then 'Zrušení plánované odstávky'
      end,
      format(
        '%s · %s · %s až %s',
        coalesce(nullif(trim(candidate.title), ''), 'Plánovaná odstávka elektřiny'),
        upper(candidate.source),
        candidate.starts_at at time zone 'Europe/Prague',
        candidate.ends_at at time zone 'Europe/Prague'
      ),
      jsonb_build_object(
        'contract', 'market-client-email-candidate-v1',
        'source', candidate.source,
        'externalId', candidate.external_id,
        'eventAt', candidate.event_at,
        'sendingAttempted', false
      )
    )
    on conflict (dedupe_key) do nothing
    returning id into created_delivery_id;

    if created_delivery_id is null then
      continue;
    end if;

    insert into public.power_outage_client_email_delivery_matches (
      delivery_id,
      match_id,
      store_id,
      store_chain_name,
      store_number,
      store_city,
      store_address
    )
    select
      created_delivery_id,
      match.id,
      match.store_id,
      match.store_chain_name,
      match.store_number,
      match.store_city,
      match.store_address
    from public.power_outage_store_matches as match
    join public.power_outage_job_client_mappings as mapping
      on mapping.chain_name = upper(trim(match.store_chain_name))
     and mapping.client_id = candidate.client_id
    where match.outage_id = candidate.outage_id
      and match.match_status = 'confirmed'
    on conflict (delivery_id, match_id) where match_id is not null do nothing;

    planned_count := planned_count + 1;
    created_delivery_id := null;
  end loop;

  -- Dokud je kandidát pouze naplánovaný, držíme jeho příjemce a společný seznam
  -- prodejen aktuální. Pozdější potvrzení další prodejny tak nevytvoří druhý e-mail.
  update public.power_outage_client_email_deliveries as delivery
  set recipient_snapshot = coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'kind', recipient.recipient_kind,
            'name', recipient.name,
            'email', recipient.email
          )
          order by recipient.recipient_kind, recipient.email
        )
        from public.power_outage_client_email_recipients as recipient
        where recipient.client_id = delivery.client_id
          and recipient.is_active
      ), '[]'::jsonb),
      store_snapshot = coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'matchId', match.id,
            'storeId', match.store_id,
            'chainName', match.store_chain_name,
            'storeNumber', match.store_number,
            'city', match.store_city,
            'address', match.store_address
          )
          order by match.store_city, match.store_number
        )
        from public.power_outage_store_matches as match
        join public.power_outage_job_client_mappings as mapping
          on mapping.chain_name = upper(trim(match.store_chain_name))
         and mapping.client_id = delivery.client_id
        where match.outage_id = delivery.outage_id
          and match.match_status = 'confirmed'
      ), '[]'::jsonb),
      updated_at = now()
  where delivery.delivery_status = 'planned';

  insert into public.power_outage_client_email_delivery_matches (
    delivery_id,
    match_id,
    store_id,
    store_chain_name,
    store_number,
    store_city,
    store_address
  )
  select
    delivery.id,
    match.id,
    match.store_id,
    match.store_chain_name,
    match.store_number,
    match.store_city,
    match.store_address
  from public.power_outage_client_email_deliveries as delivery
  join public.power_outage_store_matches as match
    on match.outage_id = delivery.outage_id
   and match.match_status = 'confirmed'
  join public.power_outage_job_client_mappings as mapping
    on mapping.chain_name = upper(trim(match.store_chain_name))
   and mapping.client_id = delivery.client_id
  where delivery.delivery_status = 'planned'
  on conflict (delivery_id, match_id) where match_id is not null do nothing;

  update public.power_outage_client_email_state
  set last_planned_at = now(),
      last_error_code = null,
      last_error_message = null,
      updated_at = now()
  where singleton;

  return jsonb_build_object(
    'ok', true,
    'status', runtime_record.runtime_mode,
    'processedCount', processed_count,
    'plannedCount', planned_count,
    'skippedCount', skipped_count,
    'sendingAttempted', false
  );
exception
  when others then
    update public.power_outage_client_email_state
    set last_error_code = 'CLIENT_EMAIL_CANDIDATE_PLAN_FAILED',
        last_error_message = sqlerrm,
        updated_at = now()
    where singleton;
    return jsonb_build_object(
      'ok', false,
      'status', coalesce(runtime_record.runtime_mode, 'disabled'),
      'errorCode', 'CLIENT_EMAIL_CANDIDATE_PLAN_FAILED',
      'errorMessage', sqlerrm,
      'plannedCount', 0,
      'sendingAttempted', false
    );
end;
$$;

revoke all on function public.plan_power_outage_client_email_candidates(integer)
  from public, anon, authenticated;
grant execute on function public.plan_power_outage_client_email_candidates(integer)
  to service_role;

notify pgrst, 'reload schema';

commit;

select 'FUNCTION' as check_type, 'plan client email candidates' as object_name,
  to_regprocedure('public.plan_power_outage_client_email_candidates(integer)') is not null as is_correct
union all
select 'DATA', 'four disabled rule templates per MARKET client',
  not exists (
    select 1
    from public.power_outage_client_email_settings as settings
    where (
      select count(*)
      from public.power_outage_client_email_rules as rule
      where rule.client_id = settings.client_id
        and rule.version = 1
        and rule.event_kind in ('new_outage', 'schedule_changed', 'cancelled', 'reminder_24h')
    ) <> 4
  )
union all
select 'SAFETY', 'all client email rules remain disabled',
  not exists (
    select 1
    from public.power_outage_client_email_rules
    where enabled
  )
union all
select 'SAFETY', 'client email dispatch remains disabled',
  exists (
    select 1
    from public.power_outage_client_email_state
    where singleton
      and runtime_mode = 'disabled'
      and dispatch_enabled = false
  )
union all
select 'SAFETY', 'planner cannot send email',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%net.http%'
  and pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%resend%'
union all
select 'SAFETY', 'no client email delivery was created by migration',
  not exists (
    select 1
    from public.power_outage_client_email_deliveries
  )
union all
select 'SAFETY', 'no client email cron exists',
  not exists (
    select 1
    from cron.job
    where jobname ilike '%client%email%'
       or command ilike '%client_email%'
  )
union all
select 'SCOPE', 'planner uses confirmed store matches',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) like '%match.match_status = ''confirmed''%'
union all
select 'SCOPE', 'planner groups by MARKET client and outage',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) like '%settings.client_id%outage.id%'
union all
select 'ISOLATION', 'planner does not reference COMPLETE outage tables',
  pg_get_functiondef(
    'public.plan_power_outage_client_email_candidates(integer)'::regprocedure
  ) not ilike '%complete_power_outage%'
order by check_type, object_name;
