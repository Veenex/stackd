-- Stackd/Discend – Sammlungswert-Verlauf: ein Schnappschuss pro Nutzer und Tag.
create table if not exists value_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  snap_date date not null,
  value numeric not null default 0,
  primary key (user_id, snap_date)
);

alter table value_history enable row level security;

-- Öffentlich lesbar (Verlauf kann später auch auf Freundesprofilen erscheinen).
drop policy if exists "value_history read all" on value_history;
create policy "value_history read all" on value_history
  for select using (true);

-- Nur der Besitzer darf eigene Einträge schreiben/aktualisieren.
drop policy if exists "value_history insert own" on value_history;
create policy "value_history insert own" on value_history
  for insert with check (auth.uid() = user_id);

drop policy if exists "value_history update own" on value_history;
create policy "value_history update own" on value_history
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
