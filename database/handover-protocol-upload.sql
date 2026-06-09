alter table public.profiles
  add column if not exists can_view_handover_protocol_upload boolean not null default false;

drop policy if exists "Technicians can read handover protocol attachments" on public.job_attachments;
create policy "Technicians can read handover protocol attachments"
  on public.job_attachments
  for select
  using (
    category = 'predavaci_protokol'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'TECHNIK'
          or profiles.can_view_handover_protocol_upload = true
        )
    )
    and exists (
      select 1
      from public.job_technicians
      where job_technicians.job_id = job_attachments.job_id
        and job_technicians.technician_id = auth.uid()
    )
  );

drop policy if exists "Technicians can create handover protocol attachments" on public.job_attachments;
create policy "Technicians can create handover protocol attachments"
  on public.job_attachments
  for insert
  with check (
    category = 'predavaci_protokol'
    and uploaded_by = auth.uid()
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'TECHNIK'
          or profiles.can_view_handover_protocol_upload = true
        )
    )
    and exists (
      select 1
      from public.job_technicians
      where job_technicians.job_id = job_attachments.job_id
        and job_technicians.technician_id = auth.uid()
    )
  );

drop policy if exists "Technicians can read handover protocol files" on storage.objects;
create policy "Technicians can read handover protocol files"
  on storage.objects
  for select
  using (
    bucket_id = 'job-attachments'
    and split_part(name, '/', 1) = 'job'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'TECHNIK'
          or profiles.can_view_handover_protocol_upload = true
        )
    )
    and exists (
      select 1
      from public.job_technicians
      where job_technicians.job_id::text = split_part(name, '/', 2)
        and job_technicians.technician_id = auth.uid()
    )
  );

drop policy if exists "Technicians can upload handover protocol files" on storage.objects;
create policy "Technicians can upload handover protocol files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'job-attachments'
    and split_part(name, '/', 1) = 'job'
    and exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'TECHNIK'
          or profiles.can_view_handover_protocol_upload = true
        )
    )
    and exists (
      select 1
      from public.job_technicians
      where job_technicians.job_id::text = split_part(name, '/', 2)
        and job_technicians.technician_id = auth.uid()
    )
  );
