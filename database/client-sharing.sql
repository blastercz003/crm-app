create extension if not exists "pgcrypto";

alter table public.clients
  enable row level security;

create table if not exists public.client_access (
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);

create index if not exists client_access_client_id_idx
  on public.client_access (client_id, created_at desc);

create index if not exists client_access_user_id_idx
  on public.client_access (user_id, created_at desc);

alter table public.client_access
  enable row level security;

create or replace function public.current_user_is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
$$;

create or replace function public.current_user_can_manage_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.current_user_is_admin()
    or exists (
      select 1
      from public.clients
      where clients.id = p_client_id
        and clients.created_by = auth.uid()
    )
$$;

create or replace function public.current_user_can_view_client(p_client_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    public.current_user_can_manage_client(p_client_id)
    or exists (
      select 1
      from public.client_access
      where client_access.client_id = p_client_id
        and client_access.user_id = auth.uid()
    )
$$;

revoke all on function public.current_user_is_admin() from public;
revoke all on function public.current_user_is_admin() from anon;
grant execute on function public.current_user_is_admin() to authenticated;

revoke all on function public.current_user_can_manage_client(uuid) from public;
revoke all on function public.current_user_can_manage_client(uuid) from anon;
grant execute on function public.current_user_can_manage_client(uuid) to authenticated;

revoke all on function public.current_user_can_view_client(uuid) from public;
revoke all on function public.current_user_can_view_client(uuid) from anon;
grant execute on function public.current_user_can_view_client(uuid) to authenticated;

create or replace function public.set_client_visibility(
  p_client_id uuid,
  p_owner_user_id uuid,
  p_shared_user_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_is_admin boolean;
begin
  select exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
  into current_user_is_admin;

  if not current_user_is_admin then
    raise exception 'Přístup ke klientovi může měnit pouze administrátor.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where profiles.id = p_owner_user_id
  ) then
    raise exception 'Vybraný majitel klienta neexistuje.';
  end if;

  update public.clients
  set created_by = p_owner_user_id
  where id = p_client_id;

  if not found then
    raise exception 'Klient nebyl nalezen.';
  end if;

  delete from public.client_access
  where client_id = p_client_id;

  insert into public.client_access (client_id, user_id)
  select p_client_id, shared.user_id
  from (
    select distinct unnest(coalesce(p_shared_user_ids, '{}'::uuid[])) as user_id
  ) as shared
  where shared.user_id is not null
    and shared.user_id <> p_owner_user_id
    and exists (
      select 1
      from public.profiles
      where profiles.id = shared.user_id
    );
end;
$$;

revoke all on function public.set_client_visibility(uuid, uuid, uuid[]) from public;
revoke all on function public.set_client_visibility(uuid, uuid, uuid[]) from anon;
grant execute on function public.set_client_visibility(uuid, uuid, uuid[]) to authenticated;

drop policy if exists "Users can read accessible clients and admins all clients" on public.clients;
create policy "Users can read accessible clients and admins all clients"
  on public.clients
  for select
  using (
    public.current_user_can_view_client(id)
  );

drop policy if exists "Users can create their own clients and admins all clients" on public.clients;
create policy "Users can create their own clients and admins all clients"
  on public.clients
  for insert
  with check (
    created_by = auth.uid()
    and auth.uid() is not null
  );

drop policy if exists "Users can update their own clients and admins all clients" on public.clients;
create policy "Users can update their own clients and admins all clients"
  on public.clients
  for update
  using (
    public.current_user_can_manage_client(id)
  )
  with check (
    public.current_user_can_manage_client(id)
  );

drop policy if exists "Admins can delete any client" on public.clients;
create policy "Admins can delete any client"
  on public.clients
  for delete
  using (public.current_user_is_admin());

drop policy if exists "Admins can read client access rows" on public.client_access;
create policy "Admins can read client access rows"
  on public.client_access
  for select
  using (public.current_user_is_admin());

drop policy if exists "Admins can manage client access rows" on public.client_access;
create policy "Admins can manage client access rows"
  on public.client_access
  for insert
  with check (public.current_user_is_admin());

drop policy if exists "Admins can update client access rows" on public.client_access;
create policy "Admins can update client access rows"
  on public.client_access
  for update
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());

drop policy if exists "Admins can delete client access rows" on public.client_access;
create policy "Admins can delete client access rows"
  on public.client_access
  for delete
  using (public.current_user_is_admin());

alter table public.client_contacts
  enable row level security;

drop policy if exists "Users can read contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can read contacts for their clients and admins all contacts"
  on public.client_contacts
  for select
  using (
    public.current_user_can_view_client(client_id)
  );

drop policy if exists "Users can create contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can create contacts for their clients and admins all contacts"
  on public.client_contacts
  for insert
  with check (
    created_by = auth.uid()
    and public.current_user_can_manage_client(client_id)
  );

drop policy if exists "Users can update contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can update contacts for their clients and admins all contacts"
  on public.client_contacts
  for update
  using (
    public.current_user_can_manage_client(client_id)
  )
  with check (
    public.current_user_can_manage_client(client_id)
  );

drop policy if exists "Users can delete contacts for their clients and admins all contacts" on public.client_contacts;
create policy "Users can delete contacts for their clients and admins all contacts"
  on public.client_contacts
  for delete
  using (
    public.current_user_can_manage_client(client_id)
  );
