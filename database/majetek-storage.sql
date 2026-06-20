insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asset-files',
  'asset-files',
  false,
  26214400,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admins can read asset files" on storage.objects;
create policy "Admins can read asset files"
  on storage.objects
  for select
  using (
    bucket_id = 'asset-files'
    and split_part(name, '/', 1) = 'majetek'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.majetek = true
    )
  );

drop policy if exists "Admins can upload asset files" on storage.objects;
create policy "Admins can upload asset files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'asset-files'
    and split_part(name, '/', 1) = 'majetek'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.majetek = true
    )
  );

drop policy if exists "Admins can update asset files" on storage.objects;
create policy "Admins can update asset files"
  on storage.objects
  for update
  using (
    bucket_id = 'asset-files'
    and split_part(name, '/', 1) = 'majetek'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.majetek = true
    )
  )
  with check (
    bucket_id = 'asset-files'
    and split_part(name, '/', 1) = 'majetek'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.majetek = true
    )
  );

drop policy if exists "Admins can delete asset files" on storage.objects;
create policy "Admins can delete asset files"
  on storage.objects
  for delete
  using (
    bucket_id = 'asset-files'
    and split_part(name, '/', 1) = 'majetek'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
        and profiles.majetek = true
    )
  );
