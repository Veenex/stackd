-- Stackd – Zustand (Media/Sleeve) pro Sammlungseintrag
-- In Supabase: SQL Editor -> New query -> einfügen -> Run.
alter table public.items add column if not exists media_cond text;
alter table public.items add column if not exists sleeve_cond text;
