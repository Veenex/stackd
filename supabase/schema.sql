-- Stackd – Datenbank-Schema (Supabase / Postgres)
-- In Supabase: SQL Editor -> New query -> alles einfügen -> Run.
-- Idempotent geschrieben (kann bei Bedarf erneut ausgeführt werden).

create extension if not exists pgcrypto;

-- =========================================================
-- PROFILES (öffentlich lesbar – Profile/Username sichtbar)
-- =========================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null,
  display_name text,
  bio          text,
  location     text,
  website      text,
  avatar_url   text,
  banner_url   text,
  favorites    jsonb not null default '[]'::jsonb,
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Username eindeutig (case-insensitive)
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read all" on public.profiles
  for select using (true);

drop policy if exists "profiles insert own" on public.profiles;
create policy "profiles insert own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- =========================================================
-- ITEMS (Sammlung + Wishlist) – öffentlich lesbar (Letterboxd-Stil)
-- =========================================================
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  list       text not null check (list in ('collection','wishlist')),
  artist     text,
  title      text,
  year       text,
  label      text,
  format     text,
  barcode    text,
  cover_url  text,
  note       text,
  rating     numeric(2,1) not null default 0 check (rating >= 0 and rating <= 5),
  liked      boolean not null default false,
  price      numeric not null default 0,
  source     text,
  source_id  text,
  master_id  bigint,
  added_at   timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists items_user_list_idx on public.items (user_id, list);
create index if not exists items_added_idx on public.items (added_at desc);

alter table public.items enable row level security;

drop policy if exists "items read all" on public.items;
create policy "items read all" on public.items
  for select using (true);

drop policy if exists "items insert own" on public.items;
create policy "items insert own" on public.items
  for insert with check (auth.uid() = user_id);

drop policy if exists "items update own" on public.items;
create policy "items update own" on public.items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "items delete own" on public.items;
create policy "items delete own" on public.items
  for delete using (auth.uid() = user_id);

-- =========================================================
-- PLAYLISTS (+ Items) – öffentlich lesbar, nur Besitzer schreibt
-- =========================================================
create table if not exists public.playlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.playlists enable row level security;

drop policy if exists "playlists read all" on public.playlists;
create policy "playlists read all" on public.playlists
  for select using (true);

drop policy if exists "playlists write own" on public.playlists;
create policy "playlists write own" on public.playlists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.playlist_items (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, item_id)
);

alter table public.playlist_items enable row level security;

drop policy if exists "playlist_items read all" on public.playlist_items;
create policy "playlist_items read all" on public.playlist_items
  for select using (true);

drop policy if exists "playlist_items write own" on public.playlist_items;
create policy "playlist_items write own" on public.playlist_items
  for all
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.playlists p
                      where p.id = playlist_id and p.user_id = auth.uid()));

-- =========================================================
-- FOLLOWS – macht „New from friends" möglich
-- =========================================================
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  followee_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

drop policy if exists "follows read all" on public.follows;
create policy "follows read all" on public.follows
  for select using (true);

drop policy if exists "follows insert own" on public.follows;
create policy "follows insert own" on public.follows
  for insert with check (auth.uid() = follower_id);

drop policy if exists "follows delete own" on public.follows;
create policy "follows delete own" on public.follows
  for delete using (auth.uid() = follower_id);

-- =========================================================
-- Auto-Profil bei Registrierung (Username kommt aus signUp-Metadaten)
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
