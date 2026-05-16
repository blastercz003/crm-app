create extension if not exists "pgcrypto";

create table if not exists public.snake_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  anonymous_player_id text,
  display_name text not null,
  score integer not null check (score >= 0),
  level integer not null check (level >= 1),
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard', 'expert')),
  duration_ms integer not null check (duration_ms >= 0),
  food_eaten integer not null check (food_eaten >= 0),
  theme_name text,
  created_at timestamptz not null default now(),
  metadata jsonb,
  check (user_id is not null or anonymous_player_id is not null)
);

create index if not exists snake_scores_score_desc_idx
  on public.snake_scores (score desc);

create index if not exists snake_scores_difficulty_score_desc_idx
  on public.snake_scores (difficulty, score desc);

create index if not exists snake_scores_created_at_idx
  on public.snake_scores (created_at desc);

create index if not exists snake_scores_user_id_idx
  on public.snake_scores (user_id);

create index if not exists snake_scores_anonymous_player_id_idx
  on public.snake_scores (anonymous_player_id);

alter table public.snake_scores enable row level security;

drop policy if exists "Users can read snake scores" on public.snake_scores;
create policy "Users can read snake scores"
  on public.snake_scores
  for select
  using (true);

drop policy if exists "Users can insert own snake scores" on public.snake_scores;
create policy "Users can insert own snake scores"
  on public.snake_scores
  for insert
  with check (
    (auth.uid() is not null and user_id = auth.uid() and anonymous_player_id is null)
    or
    (auth.uid() is null and user_id is null and anonymous_player_id is not null)
  );
