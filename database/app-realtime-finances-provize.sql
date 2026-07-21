create or replace function public.publish_finance_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_ids uuid[];
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin';

  perform public.publish_app_data_change('finances', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.publish_provize_owner_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_sales_owners text[];
  recipient_ids uuid[];
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    affected_sales_owners := array[upper(trim(new.sales_owner::text))];
  elsif tg_op = 'DELETE' then
    affected_sales_owners := array[upper(trim(old.sales_owner::text))];
  else
    affected_sales_owners := array[
      upper(trim(old.sales_owner::text)),
      upper(trim(new.sales_owner::text))
    ];
  end if;

  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or (
       profiles.can_view_provize = true
       and upper(trim(coalesce(profiles.name, ''))) = any(affected_sales_owners)
     );

  perform public.publish_app_data_change('provize', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.publish_provize_adjustment_app_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_batch_ids uuid[];
  affected_sales_owners text[];
  recipient_ids uuid[];
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'updated_at') = (to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    affected_batch_ids := array[new.batch_id];
  elsif tg_op = 'DELETE' then
    affected_batch_ids := array[old.batch_id];
  else
    affected_batch_ids := array[old.batch_id, new.batch_id];
  end if;

  select coalesce(
    array_agg(distinct upper(trim(batches.sales_owner::text))),
    array[]::text[]
  )
  into affected_sales_owners
  from public.provize_payout_batches as batches
  where batches.id = any(affected_batch_ids);

  select coalesce(array_agg(profiles.id), array[]::uuid[])
  into recipient_ids
  from public.profiles
  where profiles.role = 'admin'
     or (
       profiles.can_view_provize = true
       and upper(trim(coalesce(profiles.name, ''))) = any(affected_sales_owners)
     );

  perform public.publish_app_data_change('provize', recipient_ids);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.publish_finance_app_change()
  from public, anon, authenticated;
revoke all on function public.publish_provize_owner_app_change()
  from public, anon, authenticated;
revoke all on function public.publish_provize_adjustment_app_change()
  from public, anon, authenticated;

drop trigger if exists job_finances_publish_app_change on public.job_finances;
create trigger job_finances_publish_app_change
after insert or update or delete on public.job_finances
for each row execute function public.publish_finance_app_change();

drop trigger if exists job_finance_cost_items_publish_app_change
  on public.job_finance_cost_items;
create trigger job_finance_cost_items_publish_app_change
after insert or update or delete on public.job_finance_cost_items
for each row execute function public.publish_finance_app_change();

drop trigger if exists job_attachments_publish_finance_app_change
  on public.job_attachments;
create trigger job_attachments_publish_finance_app_change
after insert or update or delete on public.job_attachments
for each row execute function public.publish_finance_app_change();

drop trigger if exists job_pp_requirements_publish_finance_app_change
  on public.job_pp_requirements;
create trigger job_pp_requirements_publish_finance_app_change
after insert or update or delete on public.job_pp_requirements
for each row execute function public.publish_finance_app_change();

drop trigger if exists provize_records_publish_app_change
  on public.provize_records;
create trigger provize_records_publish_app_change
after insert or update or delete on public.provize_records
for each row execute function public.publish_provize_owner_app_change();

drop trigger if exists provize_payout_batches_publish_app_change
  on public.provize_payout_batches;
create trigger provize_payout_batches_publish_app_change
after insert or update or delete on public.provize_payout_batches
for each row execute function public.publish_provize_owner_app_change();

drop trigger if exists provize_payout_batch_items_publish_app_change
  on public.provize_payout_batch_items;
create trigger provize_payout_batch_items_publish_app_change
after insert or update or delete on public.provize_payout_batch_items
for each row execute function public.publish_provize_owner_app_change();

drop trigger if exists provize_payout_adjustments_publish_app_change
  on public.provize_payout_adjustments;
create trigger provize_payout_adjustments_publish_app_change
after insert or update or delete on public.provize_payout_adjustments
for each row execute function public.publish_provize_adjustment_app_change();

comment on function public.publish_finance_app_change() is
  'Publishes finance refresh signals to administrators.';
comment on function public.publish_provize_owner_app_change() is
  'Publishes commission refresh signals to administrators and the affected salesperson.';
comment on function public.publish_provize_adjustment_app_change() is
  'Publishes commission refresh signals when payout adjustments change.';
