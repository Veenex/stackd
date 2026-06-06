-- Stackd – Listen/Playlists: Beschreibung
-- In Supabase: SQL Editor -> New query -> einfügen -> Run.
alter table public.playlists add column if not exists description text;
