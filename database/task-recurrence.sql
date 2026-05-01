alter table public.tasks
  add column if not exists repeat_interval text;

alter table public.tasks
  drop constraint if exists tasks_repeat_interval_check;

alter table public.tasks
  add constraint tasks_repeat_interval_check
  check (repeat_interval is null or repeat_interval in ('daily', 'weekly', 'monthly'));

create index if not exists tasks_repeat_interval_idx
  on public.tasks (repeat_interval, status, due_date)
  where repeat_interval is not null;
