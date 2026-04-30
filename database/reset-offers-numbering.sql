begin;

truncate table
  public.offer_service_items,
  public.offer_items,
  public.offers
restart identity cascade;

delete from public.offer_number_sequences;

insert into public.offer_number_sequences (year, last_number, updated_at)
values (extract(year from now())::integer, 499, now())
on conflict (year)
do update set
  last_number = 499,
  updated_at = now();

commit;
