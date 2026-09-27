-- Offene Migration (NICHT eingespielt) - 2026-09-27, zu v2.22.1
-- Vorgabe Fabian: "Terminanfragen dürfen sich nicht überschneiden."
-- Seit dem Abschluss-Audit (K-H1, v2.12.0) blockierten offene Anfragen ANDERER Absender einen Slot
-- nicht mehr (Schutz gegen Spam-Anfragen ohne PIN, die jeden Slot sperren könnten). Folge: zwei
-- Schüler konnten dieselbe Zeit anfragen. Ab hier zählt wieder JEDE überlappende Zeile (bestätigt,
-- offen, eigene und fremde Anfragen) als OVERLAP. Die übrigen Spam-Grenzen bleiben: 10 offene
-- Anfragen pro Name und Tag, 40 schulweit ohne PIN, höchstens 240 Minuten je Anfrage.
-- v_konflikt_anfragen ist danach immer 0 (eine Sofortbuchung über eine fremde Anfrage hinweg kann es
-- nicht mehr geben, weil die schon vorher mit OVERLAP scheitert).
-- Nur die Konfliktabfrage wird ersetzt; alles andere bleibt Wort für Wort, Rechte bleiben erhalten.
do $mig$
declare
  alt text;
  neu text;
begin
  alt := pg_get_functiondef('public.public_book_or_propose_appointment(text,timestamptz,timestamptz,text,text,text,text)'::regprocedure);
  neu := regexp_replace(alt,
    'select count\(\*\) filter \(where not \(a\.status = ''pending''.*?into v_conflicts, v_konflikt_anfragen',
    E'-- 2026-09-27: jede Überlappung zählt, auch fremde offene Anfragen (Vorgabe Fabian).\n  select count(*), 0\n    into v_conflicts, v_konflikt_anfragen');
  if neu = alt then
    raise exception 'Konfliktabfrage nicht gefunden - Funktion wurde inzwischen geändert, Migration nicht angewandt';
  end if;
  execute neu;
end
$mig$;
