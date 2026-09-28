-- 2026-09-28 · Abholort am Termin (Rückmeldung Fabian: "Abholort soll es auch als Feld geben") · v2.49.0
-- Additiv wie appointments.ziel; ältere App-Versionen schreiben/lesen die Spalte nicht.
alter table public.appointments add column if not exists abholort text;
do $mig$ begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_abholort_laenge') then
    alter table public.appointments add constraint appointments_abholort_laenge check (abholort is null or char_length(abholort) <= 200);
  end if;
end $mig$;
