create or replace function public.publish_offer_child_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_offer_ids uuid[];
  recipient_ids uuid[];
  admin_ids uuid[];
begin
  if tg_op = 'INSERT' then
    affected_offer_ids := array[new.offer_id];
  elsif tg_op = 'DELETE' then
    affected_offer_ids := array[old.offer_id];
  else
    affected_offer_ids := array[old.offer_id, new.offer_id];
  end if;

  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into admin_ids
  from public.profiles
  where profiles.role = 'admin';

  select coalesce(array_agg(offers.created_by), array[]::uuid[])
  into recipient_ids
  from public.offers
  where offers.id = any(affected_offer_ids);

  perform public.publish_app_data_change('offers', recipient_ids || admin_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.publish_offer_child_app_change()
  from public, anon, authenticated;

drop trigger if exists offer_items_publish_app_change on public.offer_items;
create trigger offer_items_publish_app_change
after insert or update or delete on public.offer_items
for each row execute function public.publish_offer_child_app_change();

drop trigger if exists offer_service_items_publish_app_change
  on public.offer_service_items;
create trigger offer_service_items_publish_app_change
after insert or update or delete on public.offer_service_items
for each row execute function public.publish_offer_child_app_change();

comment on function public.publish_offer_child_app_change() is
  'Publishes offer refresh signals when offer items or service items change.';
