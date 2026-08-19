-- Interessenten-Warteliste (Leads vor der eigentlichen Einschreibung).
-- Bitte einmalig im Supabase SQL-Editor deines Projekts ausführen.
--
-- Bewusst eine eigene Tabelle statt eines Flags auf "students": ein Interessent ist noch
-- kein Schüler (kein ADK-Fortschritt, keine Fahrstunden, keine Rechnungen), und alle
-- bestehenden Auswertungen (Statistik, "lange nicht gefahren", Schülerliste) würden ihn sonst
-- fälschlich mitzählen, wenn er einfach in "students" mit einem Flag läge.
--
-- Die App läuft auch OHNE diese Tabelle weiter (die Interessenten-Seite zeigt dann nur einen
-- Hinweis, dass diese SQL-Datei noch ausgeführt werden muss) - kein Absturz, kein Blocker für
-- alles andere.

create table if not exists interessenten (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references profiles(id) on delete cascade,
  vorname text,
  name text,
  tel text,
  klasse text,
  notiz text,
  status text not null default 'offen', -- offen | kontaktiert | angemeldet | abgesagt
  follow_up_am date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table interessenten enable row level security;

drop policy if exists "eigene interessenten lesen" on interessenten;
drop policy if exists "eigene interessenten anlegen" on interessenten;
drop policy if exists "eigene interessenten aendern" on interessenten;
drop policy if exists "eigene interessenten loeschen" on interessenten;

create policy "eigene interessenten lesen" on interessenten for select using (owner = auth.uid());
create policy "eigene interessenten anlegen" on interessenten for insert with check (owner = auth.uid());
create policy "eigene interessenten aendern" on interessenten for update using (owner = auth.uid());
create policy "eigene interessenten loeschen" on interessenten for delete using (owner = auth.uid());
