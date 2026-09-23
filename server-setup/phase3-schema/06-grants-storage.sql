-- Teil 6/N: Abweichende Grants + Storage-Buckets + Storage-Policies
-- Alle 28 Tabellen bekommen vom self-hosted Stack per Default bereits volle
-- anon/authenticated/service_role-Rechte (Supabase-Standard, ueber ALTER DEFAULT PRIVILEGES).
-- Die folgenden 5 Throttle-Tabellen weichen davon bewusst ab (nur service_role, kein anon/authenticated):
REVOKE ALL ON public.ki_usage FROM anon, authenticated;
REVOKE ALL ON public.payer_lookup_throttle FROM anon, authenticated;
REVOKE ALL ON public.public_chat_usage FROM anon, authenticated;
REVOKE ALL ON public.public_enroll_usage FROM anon, authenticated;
REVOKE ALL ON public.student_login_throttle FROM anon, authenticated;

-- Storage-Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types, avif_autodetection)
VALUES
  ('staff-files', 'staff-files', false, null, null, false),
  ('student-files', 'student-files', false, null, null, false),
  -- Audit-Fund S2 (22.9.2026, live behoben 23.9.2026): beide waren public:true und umgingen damit
  -- die eigene RLS-Policy komplett ueber den unauthentifizierten /storage/v1/object/public/-
  -- Endpunkt. Zugriff laeuft jetzt ausschliesslich ueber signierte URLs (siehe Client-Code
  -- theoryFileSignedUrl/publicVideoSignedUrl und netlify/functions/public-video-url.js).
  ('theory-files', 'theory-files', false, null, null, false),
  ('videos', 'videos', false, 314572800, null, false)
ON CONFLICT (id) DO NOTHING;

-- Storage-Policies auf storage.objects
CREATE POLICY staff_files_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING ((bucket_id = 'staff-files'::text) AND ((EXISTS ( SELECT 1
   FROM profiles me,
    profiles owner
  WHERE ((me.id = auth.uid()) AND (me.school_admin = true) AND ((owner.id)::text = (storage.foldername(objects.name))[1]) AND (owner.school_id = me.school_id)))) OR (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));

CREATE POLICY staff_files_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((bucket_id = 'staff-files'::text) AND ((EXISTS ( SELECT 1
   FROM profiles me,
    profiles owner
  WHERE ((me.id = auth.uid()) AND (me.school_admin = true) AND ((owner.id)::text = (storage.foldername(objects.name))[1]) AND (owner.school_id = me.school_id)))) OR (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));

CREATE POLICY staff_files_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'staff-files'::text) AND (((storage.foldername(name))[1] = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM profiles me,
    profiles owner
  WHERE ((me.id = auth.uid()) AND (me.school_admin = true) AND ((owner.id)::text = (storage.foldername(objects.name))[1]) AND (owner.school_id = me.school_id)))) OR (auth.uid() = '96530a9f-28ae-4ac6-9cfa-26de392ecf05'::uuid)));

-- Audit 2026-09 (F-M9): Pfad ist "<hochladende uid>/<student_id>/<datei>". Hochladen nur in den
-- eigenen Ordner, Lesen/Löschen aber über den Schüler im zweiten Pfadteil (Besitzer oder
-- mitfreigegeben) - dieselbe Bedingung wie die student_files-Tabellen-Policies.
CREATE POLICY student_files_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated
  USING (bucket_id = 'student-files' AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id::text = (storage.foldername(objects.name))[2]
      AND (s.owner = auth.uid() OR auth.uid() = ANY (s.shared_with))
  ));

CREATE POLICY student_files_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'student-files'
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id::text = (storage.foldername(objects.name))[2]
        AND (s.owner = auth.uid() OR auth.uid() = ANY (s.shared_with))
    ));

CREATE POLICY student_files_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'student-files' AND EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id::text = (storage.foldername(objects.name))[2]
      AND (s.owner = auth.uid() OR auth.uid() = ANY (s.shared_with))
  ));

-- Wie auf Cloud (live): nur in den eigenen Ordner hochladen. Zusammen mit
-- theory_resources_insert_own (file_path im eigenen Ordner) kann niemand eine fremde Datei an
-- einen eigenen Beitrag hängen (Audit 2026-09, L-H1).
CREATE POLICY theory_files_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'theory-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

-- Audit-Fund S2: die urspruengliche Policy liess nur den eigenen Ordner zu, obwohl
-- theory_resources_select (Tabellen-RLS) freigegebene Beitraege (status='approved') bereits
-- app-weit fuer jeden eingeloggten Nutzer sichtbar macht - ohne diese Korrektur waere die Datei
-- eines freigegebenen Beitrags fuer alle ausser dem urspruenglich Hochladenden unerreichbar
-- geblieben, sobald der Bucket auf privat gestellt wird. Spiegelt jetzt exakt dieselbe Bedingung
-- wie die Tabellen-Policy, per Join ueber file_path.
CREATE POLICY theory_files_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'theory-files' AND EXISTS (
    SELECT 1 FROM theory_resources r
    WHERE r.file_path = objects.name
      AND (r.status = 'approved' OR r.proposed_by = auth.uid() OR (r.status = 'pending' AND _can_review_theory_resource(r.proposed_by)))
  ));

CREATE POLICY videos_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public
  USING ((bucket_id = 'videos'::text) AND (EXISTS ( SELECT 1
   FROM videos v
  WHERE ((v.storage_path = objects.name) AND ((v.owner = auth.uid()) OR ((v.school_id IS NOT NULL) AND (v.school_id = ( SELECT profiles.school_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))))));

CREATE POLICY videos_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'videos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

-- Audit-Fund S2: die urspruengliche Policy liess nur den eigenen Ordner zu, obwohl
-- videos_storage_delete (oben) und die App-UI ("schulweit sichtbar fuer alle Fahrlehrer deiner
-- Fahrschule") bereits fuer Besitzer ODER dieselbe Schule gedacht waren. Jetzt an dieselbe
-- Bedingung wie videos_storage_delete angeglichen. Oeffentlicher (anon) Zugriff ueber die
-- Buchungsseite laeuft bewusst NICHT ueber eine Storage-Policy (RLS kennt keinen Buchungscode),
-- sondern ueber netlify/functions/public-video-url.js mit Service-Role-Key nach serverseitiger
-- Pruefung via public_videos().
CREATE POLICY videos_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING (bucket_id = 'videos' AND EXISTS (
    SELECT 1 FROM videos v
    WHERE v.storage_path = objects.name
      AND (v.owner = auth.uid() OR (v.school_id IS NOT NULL AND v.school_id = (
        SELECT profiles.school_id FROM profiles WHERE profiles.id = auth.uid()
      )))
  ));
