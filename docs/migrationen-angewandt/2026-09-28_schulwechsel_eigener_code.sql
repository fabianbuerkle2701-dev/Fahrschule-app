-- 2026-09-28 · Schulwechsel: eigenen Übergabecode nicht selbst einlösen · v2.51.1 (Pre-Push-Review)
-- Bisher prüften wechsel_vorschau/wechsel_einloesen nur "gleiche Fahrschule". Ein Fahrlehrer ohne
-- Fahrschule (von_school null) konnte seinen eigenen Code einlösen und hatte den Schüler dann
-- doppelt (Sonderfahrten doppelt gezählt: eigene drivenLessons + uebernahme).
do $mig$
declare fn text; def text; alt text := $a$  select name into v_name from schools where id = w.von_school;$a$;
  neu text := $n$  if w.von_user = auth.uid() or exists (select 1 from students s where s.id = w.student_id
       and (s.owner = auth.uid() or auth.uid() = any(coalesce(s.shared_with, '{}'::uuid[])))) then
    raise exception 'Diesen Schüler hast du schon - den Code gibt der Schüler seiner neuen Fahrschule';
  end if;
  select name into v_name from schools where id = w.von_school;$n$;
begin
  foreach fn in array array['public.wechsel_vorschau(text)', 'public.wechsel_einloesen(text)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    if position(alt in def) = 0 then raise exception 'Anker fehlt in %', fn; end if;
    if position('Diesen Schüler hast du schon' in def) > 0 then continue; end if;
    execute replace(def, alt, neu);
  end loop;
end $mig$;
