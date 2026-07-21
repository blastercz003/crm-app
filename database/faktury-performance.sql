create or replace function public.get_faktury_monthly_overview()
returns table (
  overview_year integer,
  overview_month integer,
  sale_amount numeric,
  profit_amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(year from coalesce(j.end_at, j.start_at) at time zone 'UTC')::integer,
    extract(month from coalesce(j.end_at, j.start_at) at time zone 'UTC')::integer,
    coalesce(sum(
      case
        when jf.sale_amount is not null and jf.cost_amount is not null
          then jf.sale_amount
        else 0
      end
    ), 0)::numeric,
    coalesce(sum(
      case
        when jf.sale_amount is not null and jf.cost_amount is not null
          then jf.sale_amount - jf.cost_amount
        else 0
      end
    ), 0)::numeric
  from public.job_finances jf
  inner join public.jobs j on j.id = jf.job_id
  group by 1, 2
  order by 1 desc, 2 asc;
$$;

revoke all on function public.get_faktury_monthly_overview() from public;
grant execute on function public.get_faktury_monthly_overview() to authenticated;
