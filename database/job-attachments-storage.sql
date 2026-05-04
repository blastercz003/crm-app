insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-attachments',
  'job-attachments',
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

drop policy if exists "Admins can read job attachments files" on storage.objects;
create policy "Admins can read job attachments files"
  on storage.objects
  for select
  using (
    bucket_id = 'job-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can upload job attachments files" on storage.objects;
create policy "Admins can upload job attachments files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'job-attachments'
    and split_part(name, '/', 1) = 'job'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can update job attachments files" on storage.objects;
create policy "Admins can update job attachments files"
  on storage.objects
  for update
  using (
    bucket_id = 'job-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  )
  with check (
    bucket_id = 'job-attachments'
    and split_part(name, '/', 1) = 'job'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );

drop policy if exists "Admins can delete job attachments files" on storage.objects;
create policy "Admins can delete job attachments files"
  on storage.objects
  for delete
  using (
    bucket_id = 'job-attachments'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'admin'
    )
  );
