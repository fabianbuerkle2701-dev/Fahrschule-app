-- Offene Migration (NICHT eingespielt) - 2026-09-27, zu v2.26.0
-- Schüler-App zeigt "Unterlagen für die Prüfung" (Sehtest, Erste Hilfe, Passfoto, Antrag).
-- public_student_overview liefert dafür im student-Objekt zusätzlich
--   'unterlagen': {sehtest, erstehilfe, passfoto, antrag}  (nur true/false, keine Daten/Dateien)
-- Rein additiv: ältere App-Versionen ignorieren den Schlüssel, die neue App blendet die Karte
-- ohne ihn einfach aus. Bewusst ohne ::boolean-Cast (ein leerer String würde die ganze Anmeldung
-- abbrechen, siehe fix_theorie_boolean_cast) - Vergleich mit 'true'.
do $mig$
declare
  alt text;
  neu text;
begin
  alt := pg_get_functiondef('public.public_student_overview(text,text,text)'::regprocedure);
  if position('''unterlagen''' in alt) > 0 then
    raise notice 'unterlagen schon vorhanden - nichts zu tun';
    return;
  end if;
  neu := replace(alt,
    $a$'wunschliste', coalesce(v_row.data->'wunschliste','{}'::jsonb)$a$,
    $b$'wunschliste', coalesce(v_row.data->'wunschliste','{}'::jsonb),
      'unterlagen', jsonb_build_object(
        'sehtest',    coalesce((v_row.data->'licenseSteps'->'sehtest'->>'done') = 'true', false),
        'erstehilfe', coalesce((v_row.data->'licenseSteps'->'erstehilfe'->>'done') = 'true', false),
        'passfoto',   coalesce((v_row.data->'licenseSteps'->'passfoto'->>'done') = 'true', false),
        'antrag',     coalesce((v_row.data->'licenseSteps'->'antrag'->>'done') = 'true', false))$b$);
  if neu = alt then
    raise exception 'Ankerstelle nicht gefunden - Funktion wurde inzwischen geändert, Migration nicht angewandt';
  end if;
  execute neu;
end
$mig$;
