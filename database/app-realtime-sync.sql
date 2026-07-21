create table if not exists public.app_sync_versions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope),
  constraint app_sync_versions_scope_format_check
    check (scope ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint app_sync_versions_version_positive_check
    check (version > 0)
);

create index if not exists app_sync_versions_user_updated_idx
  on public.app_sync_versions (user_id, updated_at desc);

alter table public.app_sync_versions enable row level security;

drop policy if exists "Users can read their own app sync versions"
  on public.app_sync_versions;
create policy "Users can read their own app sync versions"
  on public.app_sync_versions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.app_sync_versions from anon, authenticated;
grant select on table public.app_sync_versions to authenticated;

create or replace function public.publish_app_data_change(
  p_scope text,
  p_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  next_version bigint;
  recipient_count integer := 0;
begin
  if p_scope is null or p_scope !~ '^[a-z][a-z0-9_]{0,63}$' then
    raise exception 'Invalid app sync scope.';
  end if;

  if p_user_ids is null or cardinality(p_user_ids) = 0 then
    return 0;
  end if;

  for target_user_id in
    select distinct candidate_user_id
    from unnest(p_user_ids) as candidates(candidate_user_id)
    where candidate_user_id is not null
  loop
    insert into public.app_sync_versions as versions (
      user_id,
      scope,
      version,
      updated_at
    )
    values (
      target_user_id,
      p_scope,
      1,
      clock_timestamp()
    )
    on conflict (user_id, scope)
    do update set
      version = versions.version + 1,
      updated_at = clock_timestamp()
    returning version into next_version;

    perform realtime.send(
      jsonb_build_object(
        'scope', p_scope,
        'version', next_version
      ),
      'data_changed',
      'app:user:' || target_user_id::text,
      true
    );

    recipient_count := recipient_count + 1;
  end loop;

  return recipient_count;
end;
$$;

revoke all on function public.publish_app_data_change(text, uuid[]) from public;
revoke all on function public.publish_app_data_change(text, uuid[]) from anon;
revoke all on function public.publish_app_data_change(text, uuid[]) from authenticated;

alter table realtime.messages enable row level security;

drop policy if exists "Users can receive their own app sync broadcasts"
  on realtime.messages;
create policy "Users can receive their own app sync broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'app:user:' || (select auth.uid())::text
  );

comment on table public.app_sync_versions is
  'Per-user section revisions used to recover safely after missed Realtime broadcasts.';

comment on function public.publish_app_data_change(text, uuid[]) is
  'Server-only helper that bumps per-user revisions and emits minimal private Realtime events.';
