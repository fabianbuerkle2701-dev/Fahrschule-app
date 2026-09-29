-- 2026-09-29 · Review v2.67.2 · public_student_theorie liefert nur Gruppen-Theoriestunden
-- Vorher: jeder TH-Termin - auch einer mit Schüler (ziel = persönliches Ziel der Stunde, abholort
-- oft die Wohnadresse) oder mit Sonstiges-Kennzeichen - ging an alle Schüler der Fahrschule.
-- Live-Stand beim Einspielen: keine TH-Termine mit Schüler, 2 mit §SONST§.
-- Rollback-Test: Gruppe sichtbar, persönlicher TH-Termin und §SONST§ nicht; anon-Recht unverändert.
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.public_student_theorie(text,text,text)'::regprocedure);
  if position('a.student_id is null' in alt) > 0 then raise notice 'schon angewandt'; return; end if;
  neu := replace(alt, 'where a.art = ''TH'' and a.status = ''confirmed''',
                      'where a.art = ''TH'' and a.status = ''confirmed'' and a.student_id is null and coalesce(a.note, '''') not like ''§SONST§%''');
  if neu = alt then raise exception 'Anker fehlt'; end if;
  execute neu;
end $mig$;
