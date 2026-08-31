begin;

create or replace function public.prepare_power_outage_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.archive_at := new.ends_at + interval '24 hours';
  if tg_op = 'INSERT' and new.last_seen_at < new.first_seen_at then
    new.first_seen_at := new.last_seen_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

commit;

select
  'FUNCTION' as check_type,
  'prepare_power_outage_row clamps first_seen_at on insert' as object_name,
  pg_get_functiondef('public.prepare_power_outage_row()'::regprocedure)
    like '%new.first_seen_at := new.last_seen_at%' as is_correct;
