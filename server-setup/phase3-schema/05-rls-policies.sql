-- Teil 5/N: Row Level Security aktivieren + alle Policies

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings lesen alle eingeloggten" ON public.app_settings AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings nur zentraler admin schreiben" ON public.app_settings AS PERMISSIVE FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)) WITH CHECK ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid));

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "appt aendern" ON public.appointments AS PERMISSIVE FOR UPDATE TO public USING ((owner = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "appt anlegen" ON public.appointments AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "appt eigene sehen" ON public.appointments AS PERMISSIVE FOR SELECT TO public USING ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "appt loeschen" ON public.appointments AS PERMISSIVE FOR DELETE TO public USING ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY demo_ro_no_delete ON public.appointments AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.appointments AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.appointments AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_member_all ON public.bookings AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.school_id = bookings.school_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.school_id = bookings.school_id)))));
CREATE POLICY demo_ro_no_delete ON public.bookings AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.bookings AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.bookings AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.calendar_feeds AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.calendar_feeds AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.calendar_feeds AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigenen feed aendern" ON public.calendar_feeds AS PERMISSIVE FOR UPDATE TO public USING ((owner = auth.uid()));
CREATE POLICY "eigenen feed anlegen" ON public.calendar_feeds AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = auth.uid()));
CREATE POLICY "eigenen feed lesen" ON public.calendar_feeds AS PERMISSIVE FOR SELECT TO public USING ((owner = auth.uid()));
CREATE POLICY "eigenen feed loeschen" ON public.calendar_feeds AS PERMISSIVE FOR DELETE TO public USING ((owner = auth.uid()));

ALTER TABLE public.deletion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deletion_log eigene schule sehen" ON public.deletion_log AS PERMISSIVE FOR SELECT TO public USING ((school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.device_tokens AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.device_tokens AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.device_tokens AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigene tokens aendern" ON public.device_tokens AS PERMISSIVE FOR UPDATE TO public USING ((owner = auth.uid()));
CREATE POLICY "eigene tokens anlegen" ON public.device_tokens AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = auth.uid()));
CREATE POLICY "eigene tokens lesen" ON public.device_tokens AS PERMISSIVE FOR SELECT TO public USING ((owner = auth.uid()));
CREATE POLICY "eigene tokens loeschen" ON public.device_tokens AS PERMISSIVE FOR DELETE TO public USING ((owner = auth.uid()));

ALTER TABLE public.document_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.document_counters AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.document_counters AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.document_counters AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));

ALTER TABLE public.exam_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.exam_slots AS RESTRICTIVE FOR DELETE TO public USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.exam_slots AS RESTRICTIVE FOR INSERT TO public WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.exam_slots AS RESTRICTIVE FOR UPDATE TO public USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "exam_slots aendern" ON public.exam_slots AS PERMISSIVE FOR UPDATE TO public USING ((owner = ( SELECT auth.uid() AS uid))) WITH CHECK ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "exam_slots anlegen" ON public.exam_slots AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "exam_slots eigene sehen" ON public.exam_slots AS PERMISSIVE FOR SELECT TO public USING ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "exam_slots loeschen" ON public.exam_slots AS PERMISSIVE FOR DELETE TO public USING ((owner = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.interessenten ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.interessenten AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.interessenten AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.interessenten AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigene interessenten aendern" ON public.interessenten AS PERMISSIVE FOR UPDATE TO public USING ((owner = auth.uid()));
CREATE POLICY "eigene interessenten anlegen" ON public.interessenten AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = auth.uid()));
CREATE POLICY "eigene interessenten lesen" ON public.interessenten AS PERMISSIVE FOR SELECT TO public USING ((owner = auth.uid()));
CREATE POLICY "eigene interessenten loeschen" ON public.interessenten AS PERMISSIVE FOR DELETE TO public USING ((owner = auth.uid()));

ALTER TABLE public.ki_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.lesson_reflections ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.lesson_reflections AS RESTRICTIVE FOR DELETE TO public USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "lesson_reflections eigene sehen" ON public.lesson_reflections AS PERMISSIVE FOR SELECT TO public USING ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "lesson_reflections loeschen" ON public.lesson_reflections AS PERMISSIVE FOR DELETE TO public USING ((owner = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.payer_lookup_throttle ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "central admin updates profiles" ON public.profiles AS PERMISSIVE FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid) OR (id = ( SELECT auth.uid() AS uid))));
CREATE POLICY demo_ro_no_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigenes profil anlegen" ON public.profiles AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
CREATE POLICY "eigenes profil oder gleiche fahrschule lesen" ON public.profiles AS PERMISSIVE FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR ((school_id IS NOT NULL) AND (school_id = my_school_id()))));

ALTER TABLE public.public_chat_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.public_enroll_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.route_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.route_templates AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.route_templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.route_templates AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY rt_delete ON public.route_templates AS PERMISSIVE FOR DELETE TO public USING (((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid) OR (proposed_by = ( SELECT auth.uid() AS uid))));
CREATE POLICY rt_insert ON public.route_templates AS PERMISSIVE FOR INSERT TO public WITH CHECK (((proposed_by = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text)));
CREATE POLICY rt_select ON public.route_templates AS PERMISSIVE FOR SELECT TO public USING (((status = 'approved'::text) OR (proposed_by = ( SELECT auth.uid() AS uid)) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));
CREATE POLICY rt_update ON public.route_templates AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)) WITH CHECK ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid));

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.schools AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.schools AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.schools AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigene schule oder zentraler admin lesen" ON public.schools AS PERMISSIVE FOR SELECT TO authenticated USING (((id = my_school_id()) OR (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));
CREATE POLICY "school admins update own school" ON public.schools AS PERMISSIVE FOR UPDATE TO public USING (((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.school_id = schools.id) AND (p.school_admin = true))))));
CREATE POLICY "schools admin delete" ON public.schools AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid));
CREATE POLICY "schools admin update" ON public.schools AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid));
CREATE POLICY "schools anlegen" ON public.schools AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.role() AS role) = 'authenticated'::text));

ALTER TABLE public.staff_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.staff_files AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.staff_files AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.staff_files AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY staff_files_delete ON public.staff_files AS PERMISSIVE FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me.school_admin = true) AND (me.school_id = staff_files.school_id)))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));
CREATE POLICY staff_files_insert ON public.staff_files AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me.school_admin = true) AND (me.school_id = staff_files.school_id)))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));
CREATE POLICY staff_files_select ON public.staff_files AS PERMISSIVE FOR SELECT TO authenticated USING (((instructor_uid = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me.school_admin = true) AND (me.school_id = staff_files.school_id)))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));

ALTER TABLE public.student_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.student_files AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.student_files AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.student_files AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
-- Audit 2026-09 (F-M9): Sichtbarkeit hängt an students.owner/shared_with statt am Hochladenden -
-- sonst sehen mitfreigegebene Kollegen und ein neuer Besitzer (school_assign_student) die
-- Dokumente nicht, der alte Besitzer behält dagegen Zugriff.
CREATE POLICY "schuelerdateien anlegen" ON public.student_files AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    owner = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM students s WHERE s.id = student_files.student_id
                AND (s.owner = (SELECT auth.uid()) OR (SELECT auth.uid()) = ANY (s.shared_with)))
  );
CREATE POLICY "schuelerdateien lesen" ON public.student_files AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM students s WHERE s.id = student_files.student_id
                 AND (s.owner = (SELECT auth.uid()) OR (SELECT auth.uid()) = ANY (s.shared_with))));
CREATE POLICY "schuelerdateien loeschen" ON public.student_files AS PERMISSIVE FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM students s WHERE s.id = student_files.student_id
                 AND (s.owner = (SELECT auth.uid()) OR (SELECT auth.uid()) = ANY (s.shared_with))));

ALTER TABLE public.student_login_throttle ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anlegen nur eigene" ON public.students AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = owner));
CREATE POLICY "bearbeiten eigene oder geteilte" ON public.students AS PERMISSIVE FOR UPDATE TO public USING (((( SELECT auth.uid() AS uid) = owner) OR (( SELECT auth.uid() AS uid) = ANY (shared_with)))) WITH CHECK (((( SELECT auth.uid() AS uid) = owner) OR (( SELECT auth.uid() AS uid) = ANY (shared_with))));
CREATE POLICY demo_ro_no_delete ON public.students AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.students AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.students AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "loeschen nur eigene" ON public.students AS PERMISSIVE FOR DELETE TO public USING ((( SELECT auth.uid() AS uid) = owner));
CREATE POLICY "students admin select" ON public.students AS PERMISSIVE FOR SELECT TO public USING (((owner = ( SELECT auth.uid() AS uid)) OR ((shared_with IS NOT NULL) AND (( SELECT auth.uid() AS uid) = ANY (shared_with))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.templates AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.templates AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.templates AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "vorlage admin lesen" ON public.templates AS PERMISSIVE FOR SELECT TO public USING (((( SELECT auth.uid() AS uid) = owner) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));
CREATE POLICY "vorlage eigene aendern" ON public.templates AS PERMISSIVE FOR UPDATE TO public USING ((( SELECT auth.uid() AS uid) = owner));
CREATE POLICY "vorlage eigene anlegen" ON public.templates AS PERMISSIVE FOR INSERT TO public WITH CHECK ((( SELECT auth.uid() AS uid) = owner));
CREATE POLICY "vorlage eigene lesen" ON public.templates AS PERMISSIVE FOR SELECT TO public USING ((( SELECT auth.uid() AS uid) = owner));

ALTER TABLE public.theory_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.theory_attendance AS RESTRICTIVE FOR DELETE TO public USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.theory_attendance AS RESTRICTIVE FOR INSERT TO public WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "theory_attendance anlegen" ON public.theory_attendance AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "theory_attendance eigene sehen" ON public.theory_attendance AS PERMISSIVE FOR SELECT TO public USING ((owner = ( SELECT auth.uid() AS uid)));
CREATE POLICY "theory_attendance loeschen" ON public.theory_attendance AS PERMISSIVE FOR DELETE TO public USING ((owner = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.theory_questions ENABLE ROW LEVEL SECURITY;
-- Audit 2026-09 (L-H2): vorher landete jede per REST angelegte Frage (auch quelle='vkbl' oder mit
-- fremder image_url) plattformweit bei allen Schülern aller Fahrschulen. Jetzt: nur eigene
-- Übungsfragen, sichtbar für die eigene Fahrschule (public_theory_questions filtert genauso).
CREATE POLICY theory_questions_insert_sample_only ON public.theory_questions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    is_sample = true
    AND created_by = (SELECT auth.uid())
    AND quelle IS NULL AND amtl_nr IS NULL AND image_url IS NULL
  );
CREATE POLICY theory_questions_select_authenticated ON public.theory_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    active = true
    AND (
      created_by IS NULL
      OR created_by = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM profiles p
                 WHERE p.id = theory_questions.created_by
                   AND p.school_id IS NOT NULL
                   AND p.school_id = (SELECT me.school_id FROM profiles me WHERE me.id = (SELECT auth.uid())))
    )
  );

ALTER TABLE public.theory_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.theory_resources AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.theory_resources AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.theory_resources AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY theory_resources_delete ON public.theory_resources AS PERMISSIVE FOR DELETE TO authenticated USING (((proposed_by = ( SELECT auth.uid() AS uid)) OR (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid) OR _can_review_theory_resource(proposed_by)));
-- Audit 2026-09 (L-H1): status war frei wählbar (Selbstfreischaltung per 'approved'), file_path
-- durfte auf fremde Dateien zeigen (theory_files_storage_select gibt sie dann frei).
CREATE POLICY theory_resources_insert_own ON public.theory_resources AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    proposed_by = (SELECT auth.uid())
    AND status = 'pending'
    AND (file_path IS NULL OR split_part(file_path, '/', 1) = (SELECT auth.uid())::text)
  );
CREATE POLICY theory_resources_select ON public.theory_resources AS PERMISSIVE FOR SELECT TO authenticated USING (((status = 'approved'::text) OR (proposed_by = ( SELECT auth.uid() AS uid)) OR ((status = 'pending'::text) AND _can_review_theory_resource(proposed_by))));
CREATE POLICY theory_resources_update_admin ON public.theory_resources AS PERMISSIVE FOR UPDATE TO authenticated USING (_can_review_theory_resource(proposed_by)) WITH CHECK (_can_review_theory_resource(proposed_by));

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.videos AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.videos AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.videos AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY videos_delete ON public.videos AS PERMISSIVE FOR DELETE TO public USING (((owner = ( SELECT auth.uid() AS uid)) OR ((school_id IS NOT NULL) AND (school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))))));
-- Audit 2026-09 (L-H1): storage_path muss im eigenen Ordner liegen und school_id die eigene Schule
-- sein - sonst ließ sich per fremdem Pfad eine fremde Videodatei lesen/löschen (videos_storage_*
-- prüfen nur, ob eine eigene videos-Zeile auf den Pfad zeigt) bzw. in fremde Bibliotheken schieben.
CREATE POLICY videos_insert ON public.videos AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (
    owner = (SELECT auth.uid())
    AND split_part(storage_path, '/', 1) = (SELECT auth.uid())::text
    AND (school_id IS NULL OR school_id = (SELECT profiles.school_id FROM profiles WHERE profiles.id = (SELECT auth.uid())))
  );
CREATE POLICY videos_select ON public.videos AS PERMISSIVE FOR SELECT TO public USING (((owner = ( SELECT auth.uid() AS uid)) OR ((school_id IS NOT NULL) AND (school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))))));

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.vouchers AS RESTRICTIVE FOR DELETE TO public USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.vouchers AS RESTRICTIVE FOR INSERT TO public WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "vouchers anlegen" ON public.vouchers AS PERMISSIVE FOR INSERT TO public WITH CHECK (((school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me.school_admin = true) AND (me.school_id = vouchers.school_id)))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid))));
CREATE POLICY "vouchers eigene schule sehen" ON public.vouchers AS PERMISSIVE FOR SELECT TO public USING ((school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY "vouchers loeschen" ON public.vouchers AS PERMISSIVE FOR DELETE TO public USING (((school_id = ( SELECT profiles.school_id
   FROM profiles
  WHERE (profiles.id = ( SELECT auth.uid() AS uid)))) AND ((EXISTS ( SELECT 1
   FROM profiles me
  WHERE ((me.id = ( SELECT auth.uid() AS uid)) AND (me.school_admin = true) AND (me.school_id = vouchers.school_id)))) OR (( SELECT auth.uid() AS uid) = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid))));

ALTER TABLE public.widget_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY demo_ro_no_delete ON public.widget_tokens AS RESTRICTIVE FOR DELETE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_insert ON public.widget_tokens AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY demo_ro_no_update ON public.widget_tokens AS RESTRICTIVE FOR UPDATE TO authenticated USING ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid)) WITH CHECK ((auth.uid() IS DISTINCT FROM '114d1f0a-9947-459d-8009-06282799ca44'::uuid));
CREATE POLICY "eigenen widget-token anlegen" ON public.widget_tokens AS PERMISSIVE FOR INSERT TO public WITH CHECK ((owner = auth.uid()));
CREATE POLICY "eigenen widget-token lesen" ON public.widget_tokens AS PERMISSIVE FOR SELECT TO public USING ((owner = auth.uid()));
CREATE POLICY "eigenen widget-token loeschen" ON public.widget_tokens AS PERMISSIVE FOR DELETE TO public USING ((owner = auth.uid()));

