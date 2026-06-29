create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "unaccent";

alter table public.profiles
  add column if not exists can_edit_connection_point_folders boolean not null default false;

create table if not exists public.connection_point_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  search_text text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connection_point_folders_name_length_check
    check (char_length(btrim(name)) between 1 and 255)
);

alter table public.connection_point_folders
  add column if not exists search_text text not null default '';

create unique index if not exists connection_point_folders_name_unique_idx
  on public.connection_point_folders (
    lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
  );

create index if not exists connection_point_folders_created_at_idx
  on public.connection_point_folders (created_at desc);

create index if not exists connection_point_folders_created_by_idx
  on public.connection_point_folders (created_by, created_at desc);

create or replace function public.build_connection_point_folder_search_text(
  p_name text,
  p_comments text
)
returns text
language sql
stable
as $$
  select trim(
    regexp_replace(
      lower(
        unaccent(
          concat_ws(
            ' ',
            coalesce(p_name, ''),
            coalesce(p_comments, '')
          )
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  )
$$;

create or replace function public.refresh_connection_point_folder_search_text(
  p_folder_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folder_name text;
  v_comments text;
begin
  if p_folder_id is null then
    return;
  end if;

  select name
    into v_folder_name
  from public.connection_point_folders
  where id = p_folder_id;

  if v_folder_name is null then
    return;
  end if;

  select string_agg(body, ' ' order by created_at asc)
    into v_comments
  from public.connection_point_folder_comments
  where folder_id = p_folder_id;

  update public.connection_point_folders
  set search_text = public.build_connection_point_folder_search_text(v_folder_name, v_comments)
  where id = p_folder_id;
end;
$$;

create or replace function public.sync_connection_point_folder_search_text()
returns trigger
language plpgsql
as $$
declare
  v_comments text;
begin
  select string_agg(body, ' ' order by created_at asc)
    into v_comments
  from public.connection_point_folder_comments
  where folder_id = new.id;

  new.search_text := public.build_connection_point_folder_search_text(new.name, v_comments);
  return new;
end;
$$;

create or replace function public.handle_connection_point_folder_comment_search_text()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_connection_point_folder_search_text(
    case
      when tg_op = 'DELETE' then old.folder_id
      else new.folder_id
    end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

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

drop trigger if exists connection_point_folders_sync_search_text on public.connection_point_folders;
create trigger connection_point_folders_sync_search_text
before insert or update of name on public.connection_point_folders
for each row
execute function public.sync_connection_point_folder_search_text();

drop trigger if exists connection_point_folder_comments_refresh_search_text on public.connection_point_folder_comments;
create trigger connection_point_folder_comments_refresh_search_text
after insert or update of body or delete on public.connection_point_folder_comments
for each row
execute function public.handle_connection_point_folder_comment_search_text();

update public.connection_point_folders as folders
set search_text = public.build_connection_point_folder_search_text(
  folders.name,
  comments.comment_bodies
)
from (
  select
    folder_id,
    string_agg(body, ' ' order by created_at asc) as comment_bodies
  from public.connection_point_folder_comments
  group by folder_id
) as comments
where folders.id = comments.folder_id;

update public.connection_point_folders
set search_text = public.build_connection_point_folder_search_text(name, null)
where coalesce(search_text, '') = '';

create index if not exists connection_point_folders_search_text_trgm_idx
  on public.connection_point_folders using gin (search_text gin_trgm_ops);

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
