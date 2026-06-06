-- Stackd – Tagebuch / Hör-Log
-- In Supabase: SQL Editor -> New query -> einfügen -> Run.
create table if not exists public.plays (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  item_id    uuid not null references public.items(id) on delete cascade,
  played_on  date not null default current_date,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists plays_item_idx on public.plays(item_id);
create index if not exists plays_user_idx on public.plays(user_id, played_on desc);
alter table public.plays enable row level security;
drop policy if exists "plays read all" on public.plays;
create policy "plays read all" on public.plays for select using (true);
drop policy if exists "plays insert own" on public.plays;
create policy "plays insert own" on public.plays for insert with check (auth.uid() = user_id);
drop policy if exists "plays delete own" on public.plays;
create policy "plays delete own" on public.plays for delete using (auth.uid() = user_id);
