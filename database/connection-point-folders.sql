create extension if not exists "pgcrypto";

alter table public.profiles
  add column if not exists can_edit_connection_point_folders boolean not null default false;

create table if not exists public.connection_point_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_point_folders_name_length_check
    check (char_length(btrim(name)) between 1 and 255)
);

create unique index if not exists connection_point_folders_name_unique_idx
  on public.connection_point_folders (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  );

create index if not exists connection_point_folders_created_at_idx
  on public.connection_point_folders (created_at desc);

create index if not exists connection_point_folders_created_by_idx
  on public.connection_point_folders (created_by, created_at desc);

create table if not exists public.connection_point_folder_uploads (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.connection_point_folders(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists connection_point_folder_uploads_id_folder_id_idx
  on public.connection_point_folder_uploads (id, folder_id);

create index if not exists connection_point_folder_uploads_folder_id_created_at_idx
  on public.connection_point_folder_uploads (folder_id, created_at desc);

create index if not exists connection_point_folder_uploads_uploaded_by_created_at_idx
  on public.connection_point_folder_uploads (uploaded_by, created_at desc);

create table if not exists public.connection_point_folder_photos (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.connection_point_folders(id) on delete cascade,
  upload_id uuid not null,
  file_name text not null,
  display_name text not null,
  storage_bucket text not null default 'connection-point-attachments',
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0 and file_size_bytes <= 5242880),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (upload_id, folder_id)
    references public.connection_point_folder_uploads(id, folder_id)
    on delete cascade
);

create index if not exists connection_point_folder_photos_folder_id_created_at_idx
  on public.connection_point_folder_photos (folder_id, created_at desc);

create index if not exists connection_point_folder_photos_upload_id_created_at_idx
  on public.connection_point_folder_photos (upload_id, created_at asc);

create index if not exists connection_point_folder_photos_uploaded_by_created_at_idx
  on public.connection_point_folder_photos (uploaded_by, created_at desc);

create table if not exists public.connection_point_folder_comments (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.connection_point_folders(id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  edited_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint connection_point_folder_comments_body_length_check
    check (char_length(btrim(body)) > 0 and char_length(body) <= 5000)
);

create index if not exists connection_point_folder_comments_folder_id_created_at_idx
  on public.connection_point_folder_comments (folder_id, created_at desc);

create index if not exists connection_point_folder_comments_created_by_created_at_idx
  on public.connection_point_folder_comments (created_by, created_at desc);

create index if not exists connection_point_folder_comments_edited_at_idx
  on public.connection_point_folder_comments (edited_at desc);

alter table public.connection_point_folders enable row level security;
alter table public.connection_point_folder_uploads enable row level security;
alter table public.connection_point_folder_photos enable row level security;
alter table public.connection_point_folder_comments enable row level security;

drop policy if exists "Users with connection points access can read connection point folders" on public.connection_point_folders;
create policy "Users with connection points access can read connection point folders"
  on public.connection_point_folders
  for select
  using (
    exists (
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

drop policy if exists "Users with connection points access can create connection point folders" on public.connection_point_folders;
create policy "Users with connection points access can create connection point folders"
  on public.connection_point_folders
  for insert
  with check (
    created_by = auth.uid()
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

drop policy if exists "Users with folder edit access can update connection point folders" on public.connection_point_folders;
create policy "Users with folder edit access can update connection point folders"
  on public.connection_point_folders
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );

drop policy if exists "Users with folder edit access can delete connection point folders" on public.connection_point_folders;
create policy "Users with folder edit access can delete connection point folders"
  on public.connection_point_folders
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );

drop policy if exists "Users with connection points access can read folder uploads" on public.connection_point_folder_uploads;
create policy "Users with connection points access can read folder uploads"
  on public.connection_point_folder_uploads
  for select
  using (
    exists (
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

drop policy if exists "Users with connection points access can create folder uploads" on public.connection_point_folder_uploads;
create policy "Users with connection points access can create folder uploads"
  on public.connection_point_folder_uploads
  for insert
  with check (
    uploaded_by = auth.uid()
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

drop policy if exists "Users with folder edit access can delete folder uploads" on public.connection_point_folder_uploads;
create policy "Users with folder edit access can delete folder uploads"
  on public.connection_point_folder_uploads
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );

drop policy if exists "Users with connection points access can read folder photos" on public.connection_point_folder_photos;
create policy "Users with connection points access can read folder photos"
  on public.connection_point_folder_photos
  for select
  using (
    exists (
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

drop policy if exists "Users with connection points access can create folder photos" on public.connection_point_folder_photos;
create policy "Users with connection points access can create folder photos"
  on public.connection_point_folder_photos
  for insert
  with check (
    uploaded_by = auth.uid()
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

drop policy if exists "Users with folder edit access can delete folder photos" on public.connection_point_folder_photos;
create policy "Users with folder edit access can delete folder photos"
  on public.connection_point_folder_photos
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );

drop policy if exists "Users with connection points access can read folder comments" on public.connection_point_folder_comments;
create policy "Users with connection points access can read folder comments"
  on public.connection_point_folder_comments
  for select
  using (
    exists (
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

drop policy if exists "Users with connection points access can create folder comments" on public.connection_point_folder_comments;
create policy "Users with connection points access can create folder comments"
  on public.connection_point_folder_comments
  for insert
  with check (
    created_by = auth.uid()
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

drop policy if exists "Users with folder edit access can update folder comments" on public.connection_point_folder_comments;
create policy "Users with folder edit access can update folder comments"
  on public.connection_point_folder_comments
  for update
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  )
  with check (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );

drop policy if exists "Users with folder edit access can delete folder comments" on public.connection_point_folder_comments;
create policy "Users with folder edit access can delete folder comments"
  on public.connection_point_folder_comments
  for delete
  using (
    exists (
      select 1
      from public.profiles
      where profiles.id = auth.uid()
        and (
          profiles.role = 'admin'
          or profiles.can_edit_connection_point_folders = true
        )
    )
  );
