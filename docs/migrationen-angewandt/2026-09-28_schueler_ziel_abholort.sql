-- 2026-09-28 · Schüler-App zeigt Ziel der Stunde und Abholort an den eigenen Terminen · v2.51.0
-- Nur die EIGENEN Termine des angemeldeten Schülers (dieselbe Abfrage wie bisher), zwei Felder mehr.
do $mig$
declare alt text; neu text;
begin
  alt := pg_get_functiondef('public.public_student_overview(text,text,text)'::regprocedure);
  if position('''abholort''' in alt) > 0 then raise notice 'schon angewandt'; return; end if;
  neu := replace(alt, '''end_at'', a.end_at, ''title'', a.title, ''status'', a.status, ''art'', a.art) order by a.start_at)',
                      '''end_at'', a.end_at, ''title'', a.title, ''status'', a.status, ''art'', a.art, ''ziel'', a.ziel, ''abholort'', a.abholort) order by a.start_at)');
  if neu = alt then raise exception 'Anker fehlt'; end if;
  execute neu;
end $mig$;
