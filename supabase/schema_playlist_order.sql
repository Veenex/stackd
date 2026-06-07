-- Stackd/Discend – sortierbare/ranked Listen: Reihenfolge pro Playlist speichern.
alter table public.playlist_items add column if not exists position int not null default 0;
