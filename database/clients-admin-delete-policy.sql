do $$
declare
  policy_name text;
begin
  for policy_name in
    select pol.polname
    from pg_policy pol
    join pg_class cls on cls.oid = pol.polrelid
    join pg_namespace nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'public'
      and cls.relname = 'clients'
      and pol.polcmd = 'd'
  loop
    execute format('drop policy if exists %I on public.clients', policy_name);
  end loop;
end $$;

create policy "Admins can delete any client"
  on public.clients
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
