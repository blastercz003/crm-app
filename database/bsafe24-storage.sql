insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bsafe24-files',
  'bsafe24-files',
  false,
  10485760,
  array['application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read bsafe24 files bucket" on storage.objects;
create policy "Users can read bsafe24 files bucket"
  on storage.objects
  for select
  using (
    bucket_id = 'bsafe24-files'
    and exists (
      select 1
      from public.bsafe24_files
      join public.bsafe24_contracts
        on public.bsafe24_contracts.id = public.bsafe24_files.contract_id
      where public.bsafe24_files.storage_path = name
        and public.current_user_can_read_bsafe24_contract(public.bsafe24_contracts.sales_owner)
    )
  );

drop policy if exists "Admins can upload bsafe24 files bucket" on storage.objects;
create policy "Admins can upload bsafe24 files bucket"
  on storage.objects
  for insert
  with check (
    bucket_id = 'bsafe24-files'
    and split_part(name, '/', 1) = 'contract'
    and public.current_user_is_admin()
  );

drop policy if exists "Admins can update bsafe24 files bucket" on storage.objects;
create policy "Admins can update bsafe24 files bucket"
  on storage.objects
  for update
  using (
    bucket_id = 'bsafe24-files'
    and public.current_user_is_admin()
  )
  with check (
    bucket_id = 'bsafe24-files'
    and split_part(name, '/', 1) = 'contract'
    and public.current_user_is_admin()
  );

drop policy if exists "Admins can delete bsafe24 files bucket" on storage.objects;
create policy "Admins can delete bsafe24 files bucket"
  on storage.objects
  for delete
  using (
    bucket_id = 'bsafe24-files'
    and public.current_user_is_admin()
  );
