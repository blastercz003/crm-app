begin;

alter table public.jobs
  add column if not exists pohotovost boolean not null default false;

comment on column public.jobs.pohotovost is
  'Zakázka je evidována jako pohotovost. Nelze kombinovat s marným výjezdem.';

-- Bezpečnost pro případ opakovaného spuštění nebo ručního zásahu do dat:
-- marný výjezd má přednost a oba příznaky nikdy nesmějí zůstat aktivní.
update public.jobs
set pohotovost = false
where marny_vyjezd is true
  and pohotovost is true;

-- Jednorázové zpětné označení zakázek, které mají v poznámce samostatné
-- slovo „POHOTOVOST“ (bez ohledu na velikost písmen) a nejsou marným výjezdem.
update public.jobs
set pohotovost = true
where coalesce(marny_vyjezd, false) = false
  and pohotovost is distinct from true
  and coalesce(info_note, '') ~* E'\\mPOHOTOVOST\\M';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_marny_vyjezd_pohotovost_exclusive'
      and conrelid = 'public.jobs'::regclass
  ) then
    alter table public.jobs
      add constraint jobs_marny_vyjezd_pohotovost_exclusive
      check (not (marny_vyjezd is true and pohotovost is true))
      not valid;
  end if;
end
$$;

alter table public.jobs
  validate constraint jobs_marny_vyjezd_pohotovost_exclusive;

commit;

-- Kontrolní výstup po migraci.
select
  job_number,
  marny_vyjezd,
  pohotovost,
  info_note
from public.jobs
where pohotovost is true
order by job_number;
