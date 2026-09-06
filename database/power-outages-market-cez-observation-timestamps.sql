begin;

do $$
begin
  if to_regclass('public.power_outage_cez_market_address_observations') is null then
    raise exception 'Nejdříve spusťte databázový základ ČEZ MARKETY v1 + v2.';
  end if;
end
$$;

-- observed_at vzniká na začátku aplikačního požadavku a může být o několik
-- sekund starší než databázový default first_seen_at. Nové řádky proto používají
-- jako první výskyt nejstarší z obou hodnot. Stávající data se nemění.
create or replace function public.normalize_power_outage_cez_market_observation_timestamps()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.last_seen_at < new.first_seen_at then
    new.first_seen_at := new.last_seen_at;
  end if;
  return new;
end;
$$;

drop trigger if exists po_cez_market_address_observations_normalize_timestamps
  on public.power_outage_cez_market_address_observations;
create trigger po_cez_market_address_observations_normalize_timestamps
before insert or update on public.power_outage_cez_market_address_observations
for each row execute function public.normalize_power_outage_cez_market_observation_timestamps();

revoke all on function public.normalize_power_outage_cez_market_observation_timestamps()
  from public, anon, authenticated;

commit;

select 'CONSTRAINT' as check_type, 'CEZ MARKET observation timestamp order remains enforced' as object_name,
  exists (
    select 1
    from pg_constraint
    where conname = 'po_cez_market_address_observations_seen_check'
      and conrelid = 'public.power_outage_cez_market_address_observations'::regclass
  ) as is_correct
union all
select 'FUNCTION', 'CEZ MARKET observation timestamp normalization',
  to_regprocedure('public.normalize_power_outage_cez_market_observation_timestamps()') is not null
union all
select 'GRANT', 'authenticated cannot normalize CEZ MARKET observation timestamps',
  not has_function_privilege(
    'authenticated',
    'public.normalize_power_outage_cez_market_observation_timestamps()',
    'EXECUTE'
  )
union all
select 'ISOLATION', 'timestamp repair does not reference COMPLETE outage tables',
  position('complete_power_outage' in lower(pg_get_functiondef(
    'public.normalize_power_outage_cez_market_observation_timestamps()'::regprocedure
  ))) = 0
union all
select 'SAFETY', 'timestamp repair does not mutate production outage records',
  position('power_outages' in lower(pg_get_functiondef(
    'public.normalize_power_outage_cez_market_observation_timestamps()'::regprocedure
  ))) = 0
union all
select 'STATE', 'CEZ MARKET remains v1 only during timestamp repair',
  coalesce((select operating_mode = 'v1_only' and activation_ready is false
    from public.power_outage_cez_market_collector_state where singleton), false)
union all
select 'TRIGGER', 'CEZ MARKET address observations normalize timestamps',
  exists (
    select 1
    from pg_trigger
    where tgname = 'po_cez_market_address_observations_normalize_timestamps'
      and not tgisinternal
  )
order by check_type, object_name;
