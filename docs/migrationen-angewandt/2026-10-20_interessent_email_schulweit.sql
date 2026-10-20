-- KI-Verwaltung · Posteingang (v2.126.0): Interessenten haben jetzt eine E-Mail-Adresse (die KI legt
-- Anfragen aus dem Posteingang damit an). Die schulweiten Funktionen für Admin und Büro kennen das
-- Feld bisher nicht: school_interessenten liefert es mit, school_interessent_speichern nimmt es an.
-- Gezielte Änderung der bestehenden Definitionen (nur das eine Feld), jede Ersetzung wird geprüft.
do $mig$
declare d text; vorher text;
begin
  d := pg_get_functiondef('public.school_interessent_speichern(uuid,uuid,uuid,jsonb)'::regprocedure);
  vorher := d;
  d := replace(d, '''quelle'', ''absagegrund''];', '''quelle'', ''absagegrund'', ''email''];');
  d := replace(d, 'insert into interessenten(owner, vorname, name, tel, klasse, notiz, status, follow_up_am, quelle, absagegrund)',
                  'insert into interessenten(owner, vorname, name, tel, klasse, notiz, status, follow_up_am, quelle, absagegrund, email)');
  d := replace(d, 'then v_neu->>''absagegrund'' end)', 'then v_neu->>''absagegrund'' end, lower(v_neu->>''email''))');
  d := replace(d, 'absagegrund = case when v_neu ? ''absagegrund'' then v_neu->>''absagegrund'' else absagegrund end,',
                  'absagegrund = case when v_neu ? ''absagegrund'' then v_neu->>''absagegrund'' else absagegrund end,' || chr(10)
                  || '    email = case when v_neu ? ''email'' then lower(v_neu->>''email'') else email end,');
  if (length(d) - length(vorher)) <> (length(', ''email''') + length(', email') + length(', lower(v_neu->>''email'')') + length(chr(10) || '    email = case when v_neu ? ''email'' then lower(v_neu->>''email'') else email end,')) then
    raise exception 'school_interessent_speichern: nicht alle Stellen gefunden';
  end if;
  execute d;

  d := pg_get_functiondef('public.school_interessenten(uuid)'::regprocedure);
  vorher := d;
  d := replace(d, '''quelle'', i.quelle,', '''quelle'', i.quelle, ''email'', i.email,');
  if d = vorher then raise exception 'school_interessenten: Stelle nicht gefunden'; end if;
  execute d;
end $mig$;
