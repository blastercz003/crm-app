create or replace function public.publish_job_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or profiles.can_view_jobs = true;

  perform public.publish_app_data_change('jobs', recipient_ids);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.publish_job_app_change() from public;
revoke all on function public.publish_job_app_change() from anon;
revoke all on function public.publish_job_app_change() from authenticated;

drop trigger if exists jobs_publish_app_change on public.jobs;
create trigger jobs_publish_app_change
after insert or update or delete on public.jobs
for each row execute function public.publish_job_app_change();

comment on function public.publish_job_app_change() is
  'Publishes a minimal private Jobs refresh signal to users with Jobs access.';
