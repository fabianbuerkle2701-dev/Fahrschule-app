-- 2026-09-28 · Papierkorb 30 Tage (Produktplan #41) · v2.58.0
-- Gelöschte Schüler (ohne Rechnungen; mit Rechnungen wird ohnehin archiviert), abgelehnte
-- Online-Anmeldungen und Interessenten landen hier als Kopie der Karteikarte und lassen sich 30 Tage
-- lang wiederherstellen. Danach entfernt ein täglicher pg_cron-Lauf sie endgültig.
-- NICHT betroffen: die gesetzliche Löschung nach § 31 FahrlG (student_data_delete) - die entfernt
-- Felder am bestehenden Datensatz und legt bewusst nichts in den Papierkorb.
-- Hochgeladene Dokumente sind beim Löschen schon aus dem Speicher entfernt und kommen nicht zurück
-- (steht so auch im Lösch-Dialog).
create table if not exists public.papierkorb (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  art text not null check (art in ('schueler', 'interessent')),
  ref_id uuid,
  name text not null default '',
  daten jsonb not null,
  extra jsonb not null default '{}'::jsonb,
  geloescht_am timestamptz not null default now()
);
create index if not exists papierkorb_owner_idx on public.papierkorb(owner, geloescht_am desc);
alter table public.papierkorb enable row level security;
drop policy if exists papierkorb_select on public.papierkorb;
drop policy if exists papierkorb_insert on public.papierkorb;
drop policy if exists papierkorb_delete on public.papierkorb;
create policy papierkorb_select on public.papierkorb for select to authenticated using (owner = (select auth.uid()));
create policy papierkorb_insert on public.papierkorb for insert to authenticated with check (owner = (select auth.uid()));
create policy papierkorb_delete on public.papierkorb for delete to authenticated using (owner = (select auth.uid()));
-- Kein update: ein Eintrag wird wiederhergestellt (gelöscht) oder läuft ab, geändert wird er nie.
revoke all on public.papierkorb from anon;
grant select, insert, delete on public.papierkorb to authenticated;

-- Demo-Konto: wie überall keine Schreibzugriffe
drop policy if exists papierkorb_demo_sperre on public.papierkorb;
create policy papierkorb_demo_sperre on public.papierkorb as restrictive for insert to authenticated with check (not _ist_demo());

-- Täglich 03:15 UTC: alles älter als 30 Tage endgültig entfernen
do $cron$ begin
  if exists (select 1 from cron.job where jobname = 'papierkorb-leeren') then
    perform cron.unschedule('papierkorb-leeren');
  end if;
  perform cron.schedule('papierkorb-leeren', '15 3 * * *', $job$delete from public.papierkorb where geloescht_am < now() - interval '30 days'$job$);
end $cron$;
