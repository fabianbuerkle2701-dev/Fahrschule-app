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
  ('theory-files', 'theory-files', true, null, null, false),
  ('videos', 'videos', true, 314572800, null, false)
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

CREATE POLICY student_files_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public
  USING ((bucket_id = 'student-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

CREATE POLICY student_files_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'student-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

CREATE POLICY student_files_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO public
  USING ((bucket_id = 'student-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

CREATE POLICY theory_files_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'theory-files'::text);

CREATE POLICY theory_files_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'theory-files'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

CREATE POLICY videos_storage_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public
  USING ((bucket_id = 'videos'::text) AND (EXISTS ( SELECT 1
   FROM videos v
  WHERE ((v.storage_path = objects.name) AND ((v.owner = auth.uid()) OR ((v.school_id IS NOT NULL) AND (v.school_id = ( SELECT profiles.school_id
           FROM profiles
          WHERE (profiles.id = auth.uid())))))))));

CREATE POLICY videos_storage_insert ON storage.objects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((bucket_id = 'videos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));

CREATE POLICY videos_storage_select ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'videos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
