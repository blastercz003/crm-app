-- Kategorie notifikací pro připomínky aktivit a soukromých Lístečků.

begin;

alter table public.notifications
  drop constraint if exists notifications_category_check;

alter table public.notifications
  add constraint notifications_category_check
  check (
    category in (
      'assets',
      'tasks',
      'meetings',
      'offers',
      'jobs',
      'activities',
      'system'
    )
  );

comment on column public.notifications.category is
  'Kategorie notifikace. activities zahrnuje připomínky ručních aktivit a soukromých Lístečků.';

commit;
