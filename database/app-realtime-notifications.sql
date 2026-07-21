create or replace function public.publish_notification_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  if tg_op = 'INSERT' then
    recipient_ids := array[new.recipient_user_id];
  elsif tg_op = 'DELETE' then
    recipient_ids := array[old.recipient_user_id];
  else
    recipient_ids := array[old.recipient_user_id, new.recipient_user_id];
  end if;

  perform public.publish_app_data_change('notifications', recipient_ids);

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.publish_notification_app_change() from public;
revoke all on function public.publish_notification_app_change() from anon;
revoke all on function public.publish_notification_app_change() from authenticated;

drop trigger if exists notifications_publish_app_change
  on public.notifications;
create trigger notifications_publish_app_change
after insert or update or delete on public.notifications
for each row execute function public.publish_notification_app_change();

comment on function public.publish_notification_app_change() is
  'Publishes a minimal private app refresh signal to affected notification recipients.';
