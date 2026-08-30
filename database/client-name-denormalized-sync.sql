begin;

create or replace function public.sync_client_name_to_operational_records()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;

  update public.jobs
  set company_name = new.name
  where client_id = new.id
    and company_name is distinct from new.name;

  update public.tasks
  set company_name = new.name
  where client_id = new.id
    and company_name is distinct from new.name;

  update public.meetings
  set company_name = new.name
  where client_id = new.id
    and company_name is distinct from new.name;

  return new;
end;
$$;

revoke all on function public.sync_client_name_to_operational_records() from public;
revoke all on function public.sync_client_name_to_operational_records() from anon;
revoke all on function public.sync_client_name_to_operational_records() from authenticated;

drop trigger if exists clients_sync_name_to_operational_records on public.clients;
create trigger clients_sync_name_to_operational_records
after update of name on public.clients
for each row
when (old.name is distinct from new.name)
execute function public.sync_client_name_to_operational_records();

update public.jobs as job
set company_name = client.name
from public.clients as client
where job.client_id = client.id
  and job.company_name is distinct from client.name;

update public.tasks as task
set company_name = client.name
from public.clients as client
where task.client_id = client.id
  and task.company_name is distinct from client.name;

update public.meetings as meeting
set company_name = client.name
from public.clients as client
where meeting.client_id = client.id
  and meeting.company_name is distinct from client.name;

commit;

select
  'FUNCTION' as check_type,
  'sync_client_name_to_operational_records' as object_name,
  to_regprocedure('public.sync_client_name_to_operational_records()') is not null as is_correct
union all
select
  'TRIGGER',
  'clients_sync_name_to_operational_records',
  exists (
    select 1
    from information_schema.triggers
    where trigger_schema = 'public'
      and event_object_table = 'clients'
      and trigger_name = 'clients_sync_name_to_operational_records'
  )
union all
select
  'DATA',
  'jobs client names synchronized',
  not exists (
    select 1
    from public.jobs as job
    join public.clients as client on client.id = job.client_id
    where job.company_name is distinct from client.name
  )
union all
select
  'DATA',
  'tasks client names synchronized',
  not exists (
    select 1
    from public.tasks as task
    join public.clients as client on client.id = task.client_id
    where task.company_name is distinct from client.name
  )
union all
select
  'DATA',
  'meetings client names synchronized',
  not exists (
    select 1
    from public.meetings as meeting
    join public.clients as client on client.id = meeting.client_id
    where meeting.company_name is distinct from client.name
  );
