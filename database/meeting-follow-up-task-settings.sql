alter table public.meetings
  add column if not exists follow_up_task_priority text not null default 'medium',
  add column if not exists follow_up_task_due_date date;

alter table public.meetings
  drop constraint if exists meetings_follow_up_task_priority_check;

alter table public.meetings
  add constraint meetings_follow_up_task_priority_check
  check (follow_up_task_priority in ('low', 'medium', 'high'));

update public.tasks
set
  priority = coalesce(public.meetings.follow_up_task_priority, public.tasks.priority, 'medium'),
  due_date = coalesce(public.meetings.follow_up_task_due_date, public.tasks.due_date)
from public.meetings
where public.tasks.meeting_id = public.meetings.id
  and public.tasks.source = 'meeting';
