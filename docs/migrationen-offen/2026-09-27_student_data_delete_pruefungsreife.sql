-- Offene Migration (NICHT eingespielt) - 2026-09-27, zu v2.21.0
-- Befund: student_data_delete (§ 31-Löschung) entfernt examReadiness nicht, obwohl der Client
-- es lokal mit entfernt. Nach einer Löschung bliebe die festgestellte Prüfungsreife (mit Fahrlehrer,
-- Strecke, Bemerkung) auf dem Server stehen. v2.21.0 führt zusätzlich examReadinessVerlauf ein.
-- Stand 27.09.: 0 Schüler bisher gelöscht -> keine Altdaten betroffen, Fix muss nur vor der
-- ersten Löschung live sein. Einzige Änderung gegenüber der Live-Fassung: zwei Einträge in v_felder.
CREATE OR REPLACE FUNCTION public.student_data_delete(p_student_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_school uuid; v_row students%rowtype; v_name text; v_dateien int := 0;
  v_kat text[] := array['ADK-Staende','Streckenfahrten','Fahrstunden und Bewertungen','Pruefungen',
    'Begleitete Fahrten','Theorie-Uebungsstand','Notizen','Nachrichten','Profilbild','Kontaktdaten',
    'Zugangsdaten','Hochgeladene Dateien'];
  v_felder text[] := array['adkDates','adkLog','adkNotes','items','customCounts','strecken',
    'streckenLog','streckenNotes','routes','drivenLessons','lessons','manualHours','noShows','exams',
    'schaltkompetenzTests','examSims','examReadiness','examReadinessVerlauf','licenseSteps','begleitfahrten','begleitplan','begleitEinweisung',
    'elternTel','theorie','theoryProgress',
    'theoryMockExams','bemerkungen','lastNote','messages','avatarUrl','geb','tel','festnetz','sehhilfe',
    'kopfstuetze','lenkrad','pin','pinCustom','pinChanged','pins','referralCode','referredByCode',
    'referralRewardApplied','referrals','wunschliste',
    'dismissedAppts','termin','terminLabel','klasse','location_id'];
  f text; v_neu jsonb;
begin
  -- Audit 2026-09 (L-M5): ohne Anmeldung ist auth.uid() NULL - die Besitzprüfung unten ergab
  -- dann NULL statt false und ließ den Aufruf durch; gestoppt hat ihn nur zufällig das NOT NULL
  -- von deletion_log.deleted_by (nach dem Löschen, das dadurch mit zurückgerollt wurde).
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if _ist_demo() then
    raise exception 'Im Demo-Modus ist das Loeschen deaktiviert.';
  end if;
  select school_id into v_school from profiles where id = auth.uid();
  select * into v_row from students where id = p_student_id;
  if v_row.id is null then raise exception 'Schueler nicht gefunden'; end if;
  if v_row.owner <> auth.uid() and not (auth.uid() = any(coalesce(v_row.shared_with,'{}'::uuid[]))) then
    raise exception 'Kein Zugriff auf diesen Schueler';
  end if;
  v_name := btrim(coalesce(v_row.data->>'vorname','') || ' ' || coalesce(v_row.data->>'name',''));
  v_neu := v_row.data;
  foreach f in array v_felder loop v_neu := v_neu - f; end loop;
  v_neu := v_neu || jsonb_build_object('dataDeletedAt', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSOF'));
  update students set data = v_neu, updated_at = now() where id = p_student_id;
  delete from student_files where student_id = p_student_id;
  get diagnostics v_dateien = row_count;
  delete from theory_attendance where student_id = p_student_id;
  insert into deletion_log (school_id, deleted_by, student_id, student_name, kategorien, dateien_geloescht)
  values (v_school, auth.uid(), p_student_id, v_name, v_kat, v_dateien);
  return jsonb_build_object('ok', true, 'name', v_name, 'dateien', v_dateien, 'kategorien', to_jsonb(v_kat));
end;
$function$;
