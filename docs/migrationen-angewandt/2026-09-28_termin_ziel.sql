-- 2026-09-28 · "Ziel der Stunde" am Termin (Rückmeldung Fabian: beim Termin-Eintragen fehlt ein Feld dafür) · v2.47.0
-- Additiv: ältere App-Versionen schreiben die Spalte nicht und lesen sie nicht. RLS der Tabelle gilt unverändert.
alter table public.appointments add column if not exists ziel text;
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_ziel_laenge') then
    alter table public.appointments add constraint appointments_ziel_laenge check (ziel is null or char_length(ziel) <= 300);
  end if;
end $mig$;
