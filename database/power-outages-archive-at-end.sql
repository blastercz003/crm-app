begin;

alter table public.power_outages
  drop constraint if exists power_outages_period_check;

create or replace function public.prepare_power_outage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.archive_at := new.ends_at;

  -- Pokud distributor později posune konec odstávky do budoucnosti,
  -- záznam se musí bezpečně vrátit mezi aktuální.
  if new.ends_at > now() then
    new.archived_at := null;
  end if;

  if tg_op = 'INSERT' and new.last_seen_at < new.first_seen_at then
    new.first_seen_at := new.last_seen_at;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

update public.power_outages
set archive_at = ends_at,
    archived_at = case
      when ends_at > now() then null
      else coalesce(archived_at, now())
    end,
    source_status = case
      when ends_at <= now() and source_status in ('scheduled', 'active') then 'completed'
      else source_status
    end;

alter table public.power_outages
  add constraint power_outages_period_check
  check (ends_at > starts_at and archive_at = ends_at);

comment on column public.power_outages.archive_at is
  'Termín způsobilosti k přesunu do archivu; odpovídá ends_at.';

comment on column public.power_outages.archived_at is
  'Okamžik skutečného přesunu záznamu do archivu při prvním hodinovém běhu po ends_at.';

commit;

select 'CONSTRAINT' as check_type,
  'power_outages_period_check uses ends_at' as object_name,
  pg_get_constraintdef(oid) like '%archive_at = ends_at%' as is_correct
from pg_constraint
where conrelid = 'public.power_outages'::regclass
  and conname = 'power_outages_period_check'
union all
select 'FUNCTION',
  'prepare_power_outage_row uses ends_at',
  pg_get_functiondef('public.prepare_power_outage_row()'::regprocedure)
    like '%new.archive_at := new.ends_at;%'
union all
select 'FUNCTION',
  'prepare_power_outage_row reopens future outage',
  pg_get_functiondef('public.prepare_power_outage_row()'::regprocedure)
    like '%new.archived_at := null;%'
union all
select 'STATE',
  'no ended outage remains current after migration',
  not exists (
    select 1
    from public.power_outages
    where ends_at <= now()
      and archived_at is null
  )
union all
select 'CRON',
  'power_outages_archive_hourly unchanged',
  exists (
    select 1
    from cron.job
    where jobname = 'power_outages_archive_hourly'
      and schedule = '32 * * * *'
      and active
  )
order by check_type, object_name;
