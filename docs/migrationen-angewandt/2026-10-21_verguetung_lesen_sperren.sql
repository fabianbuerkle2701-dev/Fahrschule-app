-- Prüfbefund 21.10.2026 (Sicherheitsprüfung Autopilot): profiles.verguetung war für jedes Konto derselben
-- Fahrschule lesbar – die Regel „eigenes profil oder gleiche fahrschule lesen“ lässt alle Zeilen der Schule durch,
-- Spaltenrechte gab es keine. Büro und Fahrlehrer konnten so per REST die Vergütung der Kollegen lesen.
--
-- Jetzt: Lesen der Spalte nur noch über die Server-Funktionen (school_verguetung_list, school_teacher_month …,
-- alle SECURITY DEFINER). Alle anderen Spalten bleiben lesbar wie bisher. Die App liest Profile nur mit
-- ausdrücklichen Spalten (kein select * – geprüft in index.html, Autopilot und Functions).
--
-- ACHTUNG für spätere Migrationen: Neue Spalten in profiles sind für angemeldete Konten erst lesbar, wenn sie
-- ausdrücklich freigegeben werden:  grant select (neue_spalte) on public.profiles to anon, authenticated;

do $$
declare spalten text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into spalten
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles' and column_name <> 'verguetung';
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to anon, authenticated', spalten);
end $$;

-- Neue Profile bringen keine Vergütung mit (Ändern sperrte der Wächter schon seit dem Audit vom 02.10.)
do $$
declare
  d text;
  anker text := $a$  if TG_OP = 'UPDATE' and new.verguetung is distinct from old.verguetung and not is_trusted_write then
    new.verguetung := old.verguetung;
  end if;$a$;
begin
  d := pg_get_functiondef('public._guard_profile_privilege_flags'::regproc);
  if position(anker in d) = 0 then raise exception 'Anker im Wächter nicht gefunden'; end if;
  if position('TG_OP = ''INSERT'' and new.verguetung' in d) > 0 then return; end if;
  -- Die Spalte ist NOT NULL mit Vorgabe '{}' („keine Vergütung festgelegt“) – darauf zurücksetzen, nicht auf null
  d := replace(d, anker, anker || $n$
  -- Neue Profile bringen keine Vergütung mit (Prüfung 21.10.2026); setzen darf sie nur school_verguetung_set
  if TG_OP = 'INSERT' and new.verguetung is distinct from '{}'::jsonb and not is_trusted_write then
    new.verguetung := '{}'::jsonb;
  end if;$n$);
  execute d;
end $$;

notify pgrst, 'reload schema';
