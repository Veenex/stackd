-- Stackd – Social-Erweiterung: Reviews, Likes, Kommentare
-- In Supabase: SQL Editor -> New query -> einfügen -> Run.

-- 1) Öffentliche Review pro Sammlungseintrag
alter table public.items add column if not exists review text;

-- 2) Likes auf Aktivitäten (fremde/eigene Sammlungseinträge)
create table if not exists public.activity_likes (
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
alter table public.activity_likes enable row level security;
drop policy if exists "alikes read all" on public.activity_likes;
create policy "alikes read all" on public.activity_likes for select using (true);
drop policy if exists "alikes insert own" on public.activity_likes;
create policy "alikes insert own" on public.activity_likes for insert with check (auth.uid() = user_id);
drop policy if exists "alikes delete own" on public.activity_likes;
create policy "alikes delete own" on public.activity_likes for delete using (auth.uid() = user_id);

-- 3) Kommentare auf Aktivitäten
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.items(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists comments_item_idx on public.comments(item_id, created_at);
alter table public.comments enable row level security;
drop policy if exists "comments read all" on public.comments;
create policy "comments read all" on public.comments for select using (true);
drop policy if exists "comments insert own" on public.comments;
create policy "comments insert own" on public.comments for insert with check (auth.uid() = user_id);
drop policy if exists "comments delete own" on public.comments;
create policy "comments delete own" on public.comments for delete using (auth.uid() = user_id);
