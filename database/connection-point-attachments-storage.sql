insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'connection-point-attachments',
  'connection-point-attachments',
  false,
  5242880,
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

drop policy if exists "Users with connection points access can read connection point attachment files" on storage.objects;
create policy "Users with connection points access can read connection point attachment files"
  on storage.objects
  for select
  using (
    bucket_id = 'connection-point-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.role = 'TECHNIK'
          or profiles.can_view_connection_points = true
        )
    )
  );

drop policy if exists "Users with connection points access can upload connection point attachment files" on storage.objects;
create policy "Users with connection points access can upload connection point attachment files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'connection-point-attachments'
    and split_part(name, '/', 1) = 'connection-point'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.role = 'TECHNIK'
          or profiles.can_view_connection_points = true
        )
    )
  );

drop policy if exists "Users with connection points access can update connection point attachment files" on storage.objects;
create policy "Users with connection points access can update connection point attachment files"
  on storage.objects
  for update
  using (
    bucket_id = 'connection-point-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.role = 'TECHNIK'
          or profiles.can_view_connection_points = true
        )
    )
  )
  with check (
    bucket_id = 'connection-point-attachments'
    and split_part(name, '/', 1) = 'connection-point'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.role = 'TECHNIK'
          or profiles.can_view_connection_points = true
        )
    )
  );

drop policy if exists "Admins can delete connection point attachment files" on storage.objects;
create policy "Admins can delete connection point attachment files"
  on storage.objects
  for delete
  using (
    bucket_id = 'connection-point-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
